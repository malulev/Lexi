import { readFileSync } from 'node:fs';

import { parseEnv } from '../src/lib/config/env';

/**
 * Answers one question — will this deployment start? — without ever printing a
 * credential.
 *
 * It exists because `.env.local` is unreadable to the assistant by design, so
 * "did you fill it in correctly?" cannot be settled by looking. Every line this
 * writes is either a variable name or a fixed string; values are only ever
 * tested, never echoed. The zod messages it relays are static text for the same
 * reason.
 */

/**
 * The order Next.js loads these in, lowest precedence first. A value in
 * `.env.local` wins over the same name in `.env`, which is exactly the trap
 * this script exists to expose: a stale key left in `.env.local` silently
 * overrides a correct one in `.env`.
 */
const ENV_FILES = ['.env', '.env.local'] as const;

/**
 * A deliberately small dotenv reader. `KEY=value`, plus the double-quoted form
 * a multi-line PEM arrives in. Anything fancier belongs in a real parser, and
 * nothing here needs one.
 */
function readEnvFile(path: URL): Record<string, string> {
  const text = readFileSync(path, 'utf8');
  const values: Record<string, string> = {};

  const pattern = /^([A-Z0-9_]+)=(?:"([\s\S]*?)"|(.*))$/gm;
  for (const match of text.matchAll(pattern)) {
    const [, name, quoted, bare] = match;
    values[name!] = quoted ?? bare ?? '';
  }
  return values;
}

/** The PEM survives both spellings; losing the armour lines does not. */
function reportPrivateKeyShape(key: string | undefined): string | null {
  if (!key) return null;
  const unescaped = key.replace(/\\n/g, '\n');
  if (!unescaped.includes('-----BEGIN')) {
    return 'GITHUB_APP_PRIVATE_KEY: is missing its -----BEGIN line; the PEM header and footer must be kept';
  }
  if (!unescaped.includes('-----END')) {
    return 'GITHUB_APP_PRIVATE_KEY: is missing its -----END line';
  }
  if (!unescaped.trimEnd().includes('\n')) {
    return 'GITHUB_APP_PRIVATE_KEY: has no newlines; write them literally as \\n or wrap the value in double quotes';
  }
  return null;
}

function main(): void {
  const perFile = new Map<string, Record<string, string>>();
  for (const name of ENV_FILES) {
    try {
      perFile.set(name, readEnvFile(new URL(`../${name}`, import.meta.url)));
    } catch {
      // An absent file is not a fault; only an empty result across all of them is.
    }
  }

  if (perFile.size === 0) {
    console.error('No .env or .env.local found. Copy .env.example to .env.local and fill it in.');
    process.exit(1);
  }

  const raw: Record<string, string> = {};
  for (const values of perFile.values()) Object.assign(raw, values);

  // A name defined in more than one file is reported, because the losing copy
  // is invisible and the winning one is not the one most people are editing.
  const base = perFile.get('.env') ?? {};
  const shadowed = Object.keys(perFile.get('.env.local') ?? {}).filter((name) => name in base);
  if (shadowed.length > 0) {
    console.warn(`Defined in both .env and .env.local; .env.local wins: ${shadowed.join(', ')}`);
  }

  const faults: string[] = [];
  const found = Object.keys(raw).sort();

  // Names, never values. Knowing which keys the file actually defines is what
  // turns "expected string, received undefined" from a puzzle into a typo.
  const blank = found.filter((name) => raw[name]!.trim() === '');

  try {
    // Only the file is judged. Inheriting `process.env` here would let a
    // variable exported in the developer's shell mask one missing from the
    // file, and the deployment that matters reads the file.
    // Next augments ProcessEnv with a required NODE_ENV that has nothing to do
    // with this schema, so the file's own bag is widened to fit the signature.
    parseEnv(raw as unknown as NodeJS.ProcessEnv);
  } catch (cause) {
    faults.push(cause instanceof Error ? cause.message : String(cause));
  }

  if (faults.length > 0) {
    const where = [...perFile].map(([name, v]) => `${name} (${Object.keys(v).length})`).join(', ');
    faults.push(`Read ${where}. Names seen: ${found.join(', ') || '(none)'}`);
    if (blank.length > 0) faults.push(`Present but empty: ${blank.join(', ')}`);
  }

  const keyFault = reportPrivateKeyShape(raw.GITHUB_APP_PRIVATE_KEY);
  if (keyFault) faults.push(keyFault);

  if (faults.length > 0) {
    console.error(faults.join('\n'));
    process.exit(1);
  }

  const where = [...perFile].map(([name]) => name).join(' + ');
  console.log(`${where} parses. ${found.length} variables set; none printed.`);
}

main();

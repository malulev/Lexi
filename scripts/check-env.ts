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

const ENV_FILE = new URL('../.env.local', import.meta.url);

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
  let raw: Record<string, string>;
  try {
    raw = readEnvFile(ENV_FILE);
  } catch {
    console.error('.env.local does not exist. Copy .env.example to .env.local and fill it in.');
    process.exit(1);
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
    const noun = found.length === 1 ? 'variable' : 'variables';
    faults.push(`.env.local defines ${found.length} ${noun}: ${found.join(', ') || '(none)'}`);
    if (blank.length > 0) faults.push(`Present but empty: ${blank.join(', ')}`);
  }

  const keyFault = reportPrivateKeyShape(raw.GITHUB_APP_PRIVATE_KEY);
  if (keyFault) faults.push(keyFault);

  if (faults.length > 0) {
    console.error(faults.join('\n'));
    process.exit(1);
  }

  console.log(`.env.local parses. ${found.length} variables set; none printed.`);
}

main();

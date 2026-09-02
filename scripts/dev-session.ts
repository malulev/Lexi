import { writeFileSync } from 'node:fs';

import { SESSION_COOKIE } from '../src/lib/auth/session';
import { issueSession } from '../src/lib/auth/session';
import { loadEnvFromFiles } from './repo-env';

/**
 * Writes a curl cookie jar holding a signed session for a permitted address.
 *
 * Sign-in normally arrives by email, which is one more moving part than an
 * end-to-end check of the editing loop needs. This mints the same cookie the
 * magic link would, straight into a file, so the signed value never passes
 * through a terminal or a transcript.
 *
 *   npm run dev:session -- --out /tmp/jar.txt [--email someone@example.com]
 */
function readFlag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
}

function main(): void {
  const argv = process.argv.slice(2);
  const out = readFlag(argv, 'out');
  if (!out) {
    console.error('Usage: npm run dev:session -- --out <cookie-jar-path> [--email <address>]');
    process.exit(1);
  }

  const env = loadEnvFromFiles();
  const email = readFlag(argv, 'email') ?? env.allowedEmails[0]!;

  // Refusing here rather than minting an unusable cookie: the guard re-checks
  // the address on every request, so a cookie for an unlisted address would
  // fail later and look like a signing bug.
  if (!env.allowedEmails.includes(email.toLowerCase())) {
    console.error(`${email} is not in ALLOWED_EMAILS; it could not sign in anyway.`);
    process.exit(1);
  }

  const host = new URL(env.publicBaseUrl).hostname;
  const expiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

  // Netscape cookie-jar format, which is what `curl -b` reads.
  writeFileSync(
    out,
    `# Netscape HTTP Cookie File\n${host}\tFALSE\t/\tFALSE\t${expiry}\t${SESSION_COOKIE}\t${issueSession(email, env)}\n`,
    { mode: 0o600 },
  );

  console.log(`Wrote a session for ${email} to ${out} (value not printed).`);
}

main();

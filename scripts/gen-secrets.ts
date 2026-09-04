import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

/**
 * Mints the four values a deployment needs but nobody chooses: a session
 * signing secret, a webhook shared secret, and the developer console's password
 * hash and TOTP seed.
 *
 * It writes to stdout and nothing else. `.env.local` is deliberately outside
 * what an assistant session may read or write, so the output is piped there by
 * the operator — which also keeps every generated value out of any transcript.
 *
 *   npm run gen:secrets -- --password 'your console password' >> .env.local
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Escapes a value so a `.env` file gives it back unchanged.
 *
 * Next expands `$NAME` references when it loads a dotenv file, and quoting does
 * not stop it — a bare, single-quoted and double-quoted argon2 hash are mangled
 * identically. An argon2 hash is `$argon2id$v=19$m=...`, so every one of its
 * parameter markers reads as an undefined variable and vanishes, taking the
 * hash's meaning with it. The result still looks like a plausible secret, which
 * is how this survived a full end-to-end run: nothing verified the hash until
 * startup validation existed to notice.
 */
export function escapeForDotenv(value: string): string {
  return value.replace(/\$/g, '\\$');
}

/** RFC 4648 base32, unpadded — the alphabet every authenticator app expects. */
function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function readPassword(argv: string[]): string {
  const at = argv.indexOf('--password');
  const password = at === -1 ? undefined : argv[at + 1];
  if (!password) {
    console.error("Usage: npm run gen:secrets -- --password '<console password>' >> .env.local");
    process.exit(1);
  }
  return password;
}

async function main(): Promise<void> {
  const password = readPassword(process.argv.slice(2));

  // argon2id with the library's defaults; the parameters travel inside the
  // encoded hash, so verification never needs to be told them separately.
  const hash = await argon2.hash(password, { type: argon2.argon2id });

  // Escaped uniformly rather than only where a `$` happens to appear today: a
  // value that needs escaping and did not get it fails silently, and looks fine.
  const lines = [
    ['SESSION_SECRET', randomBytes(48).toString('base64url')],
    ['NETLIFY_WEBHOOK_SECRET', randomBytes(32).toString('base64url')],
    ['CONFIG_PASSWORD_HASH', hash],
    ['CONFIG_TOTP_SECRET', toBase32(randomBytes(20))],
  ].map(([name, value]) => `${name}=${escapeForDotenv(value!)}`);

  console.log(lines.join('\n'));
}

// Only when run as a script: the test suite imports `escapeForDotenv` from
// this file, and an import that exits the process is an import that fails
// every test after it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

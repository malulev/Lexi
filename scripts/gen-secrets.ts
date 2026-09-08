import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

/**
 * Mints the three values a deployment needs but nobody chooses: a session
 * signing secret, a webhook shared secret, and the authenticator seed every
 * client signs in with.
 *
 * It writes to stdout and nothing else. `.env` is deliberately outside what
 * an assistant session may read or write, so the output is piped there by the
 * operator — which also keeps every generated value out of any transcript.
 *
 *   npm run gen:secrets >> .env
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

export function mintSecrets(): string {
  // Escaped uniformly rather than only where a `$` happens to appear today: a
  // value that needs escaping and did not get it fails silently, and looks fine.
  return [
    ['SESSION_SECRET', randomBytes(48).toString('base64url')],
    ['NETLIFY_WEBHOOK_SECRET', randomBytes(32).toString('base64url')],
    ['TOTP_SECRET', toBase32(randomBytes(20))],
  ]
    .map(([name, value]) => `${name}=${escapeForDotenv(value!)}`)
    .join('\n');
}

function main(): void {
  console.log(mintSecrets());
}

// Only when run as a script: the test suite imports `escapeForDotenv` from
// this file, and an import that exits the process is an import that fails
// every test after it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

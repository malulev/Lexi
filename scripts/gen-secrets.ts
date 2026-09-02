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

  const lines = [
    `SESSION_SECRET=${randomBytes(48).toString('base64url')}`,
    `NETLIFY_WEBHOOK_SECRET=${randomBytes(32).toString('base64url')}`,
    `CONFIG_PASSWORD_HASH=${hash}`,
    `CONFIG_TOTP_SECRET=${toBase32(randomBytes(20))}`,
  ];

  console.log(lines.join('\n'));
}

void main();

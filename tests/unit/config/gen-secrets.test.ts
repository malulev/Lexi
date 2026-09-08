import { describe, expect, it } from 'vitest';

import { mintSecrets } from '../../../scripts/gen-secrets';

/**
 * Three values, nothing chosen by a person, and nothing a dotenv reader
 * could mangle: base64url and base32 carry no `$`, so the escaping that the
 * argon2 hash once needed has nothing left to do.
 */
describe('gen:secrets', () => {
  it('emits exactly the three deployment secrets', () => {
    const lines = mintSecrets().split('\n');
    expect(lines.map((line) => line.split('=')[0])).toEqual([
      'SESSION_SECRET',
      'NETLIFY_WEBHOOK_SECRET',
      'TOTP_SECRET',
    ]);
  });

  it('writes values a dotenv reader and an authenticator app both accept', () => {
    const values = Object.fromEntries(
      mintSecrets()
        .split('\n')
        .map((line) => line.split('=')),
    );
    expect(values.SESSION_SECRET).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(values.NETLIFY_WEBHOOK_SECRET).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values.TOTP_SECRET).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('is fresh every time', () => {
    expect(mintSecrets()).not.toBe(mintSecrets());
  });
});

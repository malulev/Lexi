import { describe, expect, it } from 'vitest';
import type { Env } from '@/types';
import {
  MAGIC_LINK_TTL_MS,
  issueMagicLinkToken,
  verifyMagicLinkToken,
} from '@/lib/auth/magic-link';

// Unit tests build their own Env rather than reading process.env, so this
// suite stays independent of src/lib/config (owned by another task).
function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    githubAppId: 'app-id',
    githubAppPrivateKey: 'private-key',
    githubInstallationId: 1,
    githubRepoOwner: 'client-org',
    githubRepoName: 'client-site',
    netlifyToken: 'netlify-token',
    netlifySiteId: 'netlify-site',
    netlifyWebhookSecret: 'netlify-webhook-secret',
    openrouterApiKey: 'openrouter-key',
    sessionSecret: 'a'.repeat(32),
    allowedEmails: ['jane@client.example', 'marketing@client.example'],
    configPasswordHash: 'argon2id$hash',
    configTotpSecret: 'BASE32SECRET',
    smtpUrl: 'smtps://user:pass@smtp.example.com:465',
    smtpFrom: 'webagent@client.example',
    publicBaseUrl: 'https://client.example',
    maxConcurrentRuns: 2,
    ...overrides,
  };
}

describe('issueMagicLinkToken', () => {
  it('issues a token for an address on the allow list', () => {
    const env = buildEnv();

    const token = issueMagicLinkToken('jane@client.example', env);

    expect(token).not.toBeNull();
    expect(typeof token).toBe('string');
  });

  it('returns null, and never throws, for an address absent from ALLOWED_EMAILS', () => {
    const env = buildEnv();

    expect(() => issueMagicLinkToken('stranger@other.example', env)).not.toThrow();
    expect(issueMagicLinkToken('stranger@other.example', env)).toBeNull();
  });

  it('matches an allowed address case-insensitively', () => {
    const env = buildEnv({ allowedEmails: ['jane@client.example'] });

    const token = issueMagicLinkToken('Jane@Client.example', env);

    expect(token).not.toBeNull();
  });
});

describe('verifyMagicLinkToken', () => {
  it('verifies a freshly issued token and recovers the signed-in address', () => {
    const env = buildEnv();
    const issuedAt = new Date('2026-09-02T10:00:00Z');

    const token = issueMagicLinkToken('jane@client.example', env, issuedAt);
    const result = verifyMagicLinkToken(token!, env, issuedAt);

    expect(result).toEqual({ email: 'jane@client.example' });
  });

  it('rejects a token once MAGIC_LINK_TTL_MS has elapsed', () => {
    const env = buildEnv();
    const issuedAt = new Date('2026-09-02T10:00:00Z');
    const token = issueMagicLinkToken('jane@client.example', env, issuedAt)!;

    const justBeforeExpiry = new Date(issuedAt.getTime() + MAGIC_LINK_TTL_MS - 1);
    const justAfterExpiry = new Date(issuedAt.getTime() + MAGIC_LINK_TTL_MS + 1);

    expect(verifyMagicLinkToken(token, env, justBeforeExpiry)).toEqual({
      email: 'jane@client.example',
    });
    expect(verifyMagicLinkToken(token, env, justAfterExpiry)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const env = buildEnv();
    const token = issueMagicLinkToken('jane@client.example', env)!;
    const [payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ email: 'attacker@other.example', iat: Date.now(), nonce: 'x' }),
    ).toString('base64url');

    expect(verifyMagicLinkToken(`${tamperedPayload}.${signature}`, env)).toBeNull();
    expect(verifyMagicLinkToken(`${payload}.deadbeef`, env)).toBeNull();
  });

  it('rejects a token signed with a different session secret', () => {
    const issuingEnv = buildEnv({ sessionSecret: 'a'.repeat(32) });
    const verifyingEnv = buildEnv({ sessionSecret: 'b'.repeat(32) });
    const token = issueMagicLinkToken('jane@client.example', issuingEnv)!;

    expect(verifyMagicLinkToken(token, verifyingEnv)).toBeNull();
  });

  it('rejects garbage input rather than throwing', () => {
    const env = buildEnv();

    expect(() => verifyMagicLinkToken('not-a-token', env)).not.toThrow();
    expect(verifyMagicLinkToken('not-a-token', env)).toBeNull();
    expect(verifyMagicLinkToken('', env)).toBeNull();
  });

  // There is no datastore to record that a token was already consumed
  // (constitution VII), so "single use" cannot mean "exactly once" here.
  // What magic-link.ts actually guarantees is a short validity window: the
  // same link keeps verifying to the same address for as long as the window
  // is open, and stops verifying the instant it closes. This test asserts
  // that real, narrower guarantee rather than a stronger one the code
  // cannot make.
  it('lets the same token verify more than once inside its window, bounded only by the TTL', () => {
    const env = buildEnv();
    const issuedAt = new Date('2026-09-02T10:00:00Z');
    const token = issueMagicLinkToken('jane@client.example', env, issuedAt)!;

    const firstUse = verifyMagicLinkToken(token, env, issuedAt);
    const secondUse = verifyMagicLinkToken(token, env, new Date(issuedAt.getTime() + 60_000));

    expect(firstUse).toEqual({ email: 'jane@client.example' });
    expect(secondUse).toEqual({ email: 'jane@client.example' });
  });
});

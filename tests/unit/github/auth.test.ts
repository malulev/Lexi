import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { createTokenMinter } from '@/lib/github/auth';
import type { Env } from '@/types';

// A real (throwaway) RSA key pair. GitHub App private keys are RSA, and
// `auth.ts` signs the App JWT for real with `node:crypto` — a fixture string
// like "-----BEGIN...fixture...-----" would fail signing, so the test needs a
// key OpenSSL actually accepts.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function decodeJwtPayload(jwt: string): { iat: number; exp: number; iss: string } {
  const [, payload] = jwt.split('.');
  return JSON.parse(Buffer.from(payload as string, 'base64url').toString('utf-8'));
}

function verifyJwtSignature(jwt: string): boolean {
  const [header, payload, signature] = jwt.split('.');
  return verifySignature(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    publicKey,
    Buffer.from(signature as string, 'base64url'),
  );
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    githubAppId: '123456',
    githubAppPrivateKey: privateKey,
    githubInstallationId: 7891011,
    githubRepoOwner: 'acme',
    githubRepoName: 'site',
    netlifyToken: 'nfp_fixture',
    netlifySiteId: 'site_fixture',
    netlifyWebhookSecret: 'whsec_fixture',
    openrouterApiKey: 'sk-or-fixture',
    sessionSecret: 'fixture-session-secret-at-least-32-chars',
    allowedEmails: ['jane@client.example'],
    configPasswordHash: '$argon2id$v=19$m=65536,t=3,p=4$fixture$fixture',
    configTotpSecret: 'JBSWY3DPEHPK3PXP',
    smtpUrl: 'smtp://localhost:1025',
    smtpFrom: 'webagent@client.example',
    publicBaseUrl: 'http://localhost:3000',
    ...overrides,
  };
}

const HOUR_MS = 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

describe('createTokenMinter', () => {
  it('signs an App JWT with iss set to the App id and iat backdated for clock skew', async () => {
    const env = makeEnv();
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    let capturedJwt = '';
    const mintToken = vi.fn(async (jwt: string) => {
      capturedJwt = jwt;
      return { token: 'installation-token-1', expiresAt: new Date(t0.getTime() + HOUR_MS) };
    });

    const minter = createTokenMinter(env, { now: () => t0, mintToken });
    await minter.getToken();

    expect(verifyJwtSignature(capturedJwt)).toBe(true);
    const payload = decodeJwtPayload(capturedJwt);
    expect(payload.iss).toBe(env.githubAppId);
    // Backdated ~60s: a real, documented GitHub requirement tolerating clock drift.
    expect(payload.iat).toBe(Math.floor(t0.getTime() / 1000) - 60);
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(10 * 60);
  });

  it('caches the minted token and does not re-mint on a second call before expiry', async () => {
    const env = makeEnv();
    let current = new Date('2026-01-01T00:00:00.000Z');
    const mintToken = vi.fn(async () => ({
      token: 'installation-token-1',
      expiresAt: new Date(current.getTime() + HOUR_MS),
    }));

    const minter = createTokenMinter(env, { now: () => current, mintToken });

    const first = await minter.getToken();
    current = new Date(current.getTime() + 10 * 60 * 1000); // +10 minutes, well inside the hour
    const second = await minter.getToken();

    expect(first).toBe('installation-token-1');
    expect(second).toBe('installation-token-1');
    expect(mintToken).toHaveBeenCalledTimes(1);
  });

  it('refreshes before expiry, honouring the 5 minute safety margin', async () => {
    const env = makeEnv();
    let current = new Date('2026-01-01T00:00:00.000Z');
    let mintCount = 0;
    const mintToken = vi.fn(async () => {
      mintCount += 1;
      return {
        token: `installation-token-${mintCount}`,
        expiresAt: new Date(current.getTime() + HOUR_MS),
      };
    });

    const minter = createTokenMinter(env, { now: () => current, mintToken });

    const first = await minter.getToken();
    // Advance to exactly the safety margin boundary before the cached token's expiry.
    current = new Date(current.getTime() + HOUR_MS - FIVE_MINUTES_MS);
    const second = await minter.getToken();

    expect(first).toBe('installation-token-1');
    expect(second).toBe('installation-token-2');
    expect(mintToken).toHaveBeenCalledTimes(2);
  });

  it('never returns a token that expires mid-flight: refresh happens strictly before the safety margin is crossed', async () => {
    const env = makeEnv();
    let current = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date(current.getTime() + HOUR_MS);
    const mintToken = vi.fn(async () => ({ token: 'installation-token-1', expiresAt }));

    const minter = createTokenMinter(env, { now: () => current, mintToken });
    await minter.getToken();

    // One millisecond inside the margin: still safe to reuse would violate the
    // "never mid-flight" guarantee, so this must trigger a refresh.
    current = new Date(expiresAt.getTime() - FIVE_MINUTES_MS + 1);
    await minter.getToken();

    expect(mintToken).toHaveBeenCalledTimes(2);
  });

  it('lets a caller override the clock per call via getToken(now)', async () => {
    const env = makeEnv();
    const base = new Date('2026-01-01T00:00:00.000Z');
    const mintToken = vi.fn(async () => ({
      token: 'installation-token-1',
      expiresAt: new Date(base.getTime() + HOUR_MS),
    }));
    const minter = createTokenMinter(env, { now: () => base, mintToken });

    await minter.getToken();
    await minter.getToken(new Date(base.getTime() + HOUR_MS)); // well past expiry

    expect(mintToken).toHaveBeenCalledTimes(2);
  });

  it('never includes the token or the private key in a thrown error', async () => {
    const env = makeEnv();
    const secretToken = 'ghs_super-secret-installation-token';
    const mintToken = vi.fn(async () => {
      throw new Error(`upstream rejected request carrying ${secretToken}`);
    });
    const minter = createTokenMinter(env, {
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      mintToken,
    });

    await expect(minter.getToken()).rejects.toThrow();
    try {
      await minter.getToken();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(env.githubAppPrivateKey);
      expect(message).not.toContain('BEGIN RSA PRIVATE KEY');
    }
  });
});

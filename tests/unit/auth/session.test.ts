import { describe, expect, it } from 'vitest';
import type { Env } from '@/types';
import {
  SESSION_COOKIE,
  issueSession,
  sessionCookieOptions,
  verifySession,
} from '@/lib/auth/session';

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
    allowedEmails: ['jane@client.example'],
    totpSecret: 'BASE32SECRET',
    smtpUrl: 'smtps://user:pass@smtp.example.com:465',
    smtpFrom: 'webagent@client.example',
    publicBaseUrl: 'https://client.example',
    maxConcurrentRuns: 2,
    ...overrides,
  };
}

describe('issueSession / verifySession', () => {
  it('round-trips the signed-in email through a freshly issued cookie', () => {
    const env = buildEnv();
    const now = new Date('2026-09-02T10:00:00Z');

    const cookie = issueSession('jane@client.example', env, now);
    const session = verifySession(cookie, env, now);

    expect(session).not.toBeNull();
    expect(session?.email).toBe('jane@client.example');
  });

  it('sets expiresAt seven days after issuance', () => {
    const env = buildEnv();
    const now = new Date('2026-09-02T10:00:00Z');
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const cookie = issueSession('jane@client.example', env, now);
    const session = verifySession(cookie, env, now);

    expect(session?.expiresAt).toBe(Math.floor((now.getTime() + sevenDaysMs) / 1000));
  });

  it('returns null for an undefined cookie value', () => {
    const env = buildEnv();

    expect(verifySession(undefined, env)).toBeNull();
  });

  it('returns null, and never throws, for a garbage cookie value', () => {
    const env = buildEnv();

    expect(() => verifySession('not-a-real-cookie', env)).not.toThrow();
    expect(verifySession('not-a-real-cookie', env)).toBeNull();
    expect(verifySession('', env)).toBeNull();
  });

  it('rejects a cookie whose payload has been tampered with', () => {
    const env = buildEnv();
    const cookie = issueSession('jane@client.example', env);
    const [, signature] = cookie.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ email: 'attacker@other.example', expiresAt: 9_999_999_999 }),
    ).toString('base64url');

    expect(verifySession(`${tamperedPayload}.${signature}`, env)).toBeNull();
  });

  it('rejects a cookie whose signature has been tampered with', () => {
    const env = buildEnv();
    const cookie = issueSession('jane@client.example', env);
    const [payload] = cookie.split('.');

    expect(verifySession(`${payload}.deadbeefdeadbeefdeadbeefdeadbeef`, env)).toBeNull();
  });

  it('rejects a cookie signed with a different session secret', () => {
    const issuingEnv = buildEnv({ sessionSecret: 'a'.repeat(32) });
    const verifyingEnv = buildEnv({ sessionSecret: 'b'.repeat(32) });
    const cookie = issueSession('jane@client.example', issuingEnv);

    expect(verifySession(cookie, verifyingEnv)).toBeNull();
  });

  it('rejects a cookie once it has expired', () => {
    const env = buildEnv();
    const issuedAt = new Date('2026-09-02T10:00:00Z');
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cookie = issueSession('jane@client.example', env, issuedAt);

    const justBeforeExpiry = new Date(issuedAt.getTime() + sevenDaysMs - 1000);
    const justAfterExpiry = new Date(issuedAt.getTime() + sevenDaysMs + 1000);

    expect(verifySession(cookie, env, justBeforeExpiry)).not.toBeNull();
    expect(verifySession(cookie, env, justAfterExpiry)).toBeNull();
  });
});

describe('sessionCookieOptions', () => {
  it('is httpOnly, sameSite lax, and scoped to the whole site', () => {
    const options = sessionCookieOptions(buildEnv());

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
  });

  it('sets maxAge to seven days in seconds', () => {
    const options = sessionCookieOptions(buildEnv());

    expect(options.maxAge).toBe(7 * 24 * 60 * 60);
  });

  it('marks the cookie secure when PUBLIC_BASE_URL is https', () => {
    const options = sessionCookieOptions(buildEnv({ publicBaseUrl: 'https://client.example' }));

    expect(options.secure).toBe(true);
  });

  it('leaves the cookie insecure when PUBLIC_BASE_URL is plain http, e.g. local development', () => {
    const options = sessionCookieOptions(buildEnv({ publicBaseUrl: 'http://localhost:3000' }));

    expect(options.secure).toBe(false);
  });
});

describe('SESSION_COOKIE', () => {
  it('names the cookie webagent_session', () => {
    expect(SESSION_COOKIE).toBe('webagent_session');
  });
});

// The credential that can point this installation at a different website
// (FR-003a, R6). Constitution Principle III applies here in its strictest
// form: the decision is arithmetic over a hash and a clock, and every test
// below exists to pin down that no path returns `ok` without both halves
// having been checked.
//
// The load-bearing case is `rejects a valid password when the code is wrong`.
// A second factor that can be skipped by getting the first one right is not a
// second factor.
import argon2 from 'argon2';
import { generate, generateSecret } from 'otplib';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CONFIG_SESSION_COOKIE,
  configSessionCookieOptions,
  issueConfigSession,
  verifyConfigCredential,
  verifyConfigSession,
} from '@/lib/auth/config-credential';
import type { Env } from '@/types';

const PASSWORD = 'a console password nobody guesses';
const AT = new Date('2026-09-02T10:00:00Z');

// otplib v13 requires at least 16 bytes of secret; a real one is generated
// once here rather than hard-coded, so the suite exercises the same shape
// `npm run gen:secrets` writes into a deployment.
const TOTP_SECRET = generateSecret();

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
}, 30_000);

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
    configPasswordHash: passwordHash,
    configTotpSecret: TOTP_SECRET,
    smtpUrl: 'smtps://user:pass@smtp.example.com:465',
    smtpFrom: 'webagent@client.example',
    publicBaseUrl: 'https://client.example',
  maxConcurrentRuns: 2,    ...overrides,
  };
}

/** The code an authenticator app would be showing at `at`. */
function codeAt(secret: string, at: Date): Promise<string> {
  return generate({ secret, epoch: Math.floor(at.getTime() / 1000) });
}

describe('verifyConfigCredential', () => {
  it('accepts the configured password together with the current code', async () => {
    const env = buildEnv();

    const result = await verifyConfigCredential(
      { password: PASSWORD, code: await codeAt(TOTP_SECRET, AT) },
      env,
      AT,
    );

    expect(result).toEqual({ ok: true });
  });

  it('rejects a valid password when the code is wrong', async () => {
    const env = buildEnv();
    const current = await codeAt(TOTP_SECRET, AT);
    const wrong = current === '000000' ? '111111' : '000000';

    const result = await verifyConfigCredential({ password: PASSWORD, code: wrong }, env, AT);

    expect(result).toEqual({ ok: false, reason: 'code' });
  });

  it('rejects a valid code when the password is wrong', async () => {
    const env = buildEnv();

    const result = await verifyConfigCredential(
      { password: 'not the password', code: await codeAt(TOTP_SECRET, AT) },
      env,
      AT,
    );

    expect(result).toEqual({ ok: false, reason: 'password' });
  });

  it('rejects a code belonging to a different secret', async () => {
    const env = buildEnv();
    const otherSecret = generateSecret();

    const result = await verifyConfigCredential(
      { password: PASSWORD, code: await codeAt(otherSecret, AT) },
      env,
      AT,
    );

    expect(result.ok).toBe(false);
  });

  it.each([
    ['empty password', { password: '', code: '123456' }],
    ['empty code', { password: PASSWORD, code: '' }],
    ['non-numeric code', { password: PASSWORD, code: 'abcdef' }],
    ['over-long code', { password: PASSWORD, code: '1234567890' }],
  ])('rejects %s without throwing', async (_label, input) => {
    const env = buildEnv();

    await expect(verifyConfigCredential(input, env, AT)).resolves.toMatchObject({ ok: false });
  });

  it('accepts a code from the immediately preceding time step, for clock drift', async () => {
    const env = buildEnv();
    const oneStepAgo = new Date(AT.getTime() - 30_000);

    const result = await verifyConfigCredential(
      { password: PASSWORD, code: await codeAt(TOTP_SECRET, oneStepAgo) },
      env,
      AT,
    );

    expect(result).toEqual({ ok: true });
  });

  it('rejects a code that has aged beyond the drift allowance', async () => {
    const env = buildEnv();
    const longAgo = new Date(AT.getTime() - 10 * 60_000);

    const result = await verifyConfigCredential(
      { password: PASSWORD, code: await codeAt(TOTP_SECRET, longAgo) },
      env,
      AT,
    );

    expect(result).toEqual({ ok: false, reason: 'code' });
  });

  it('refuses rather than throws when the configured hash is not an argon2 hash', async () => {
    const env = buildEnv({ configPasswordHash: 'plaintext-by-mistake' });

    const result = await verifyConfigCredential(
      { password: PASSWORD, code: await codeAt(TOTP_SECRET, AT) },
      env,
      AT,
    );

    expect(result).toEqual({ ok: false, reason: 'misconfigured' });
  });

  it('refuses rather than throws when the configured secret is not usable base32', async () => {
    const env = buildEnv({ configTotpSecret: 'not base32 at all!!!' });

    const result = await verifyConfigCredential(
      { password: PASSWORD, code: '123456' },
      env,
      AT,
    );

    expect(result).toEqual({ ok: false, reason: 'misconfigured' });
  });
});

describe('issueConfigSession / verifyConfigSession', () => {
  it('round-trips a freshly issued configuration session', () => {
    const env = buildEnv();

    expect(verifyConfigSession(issueConfigSession(env, AT), env, AT)).toBe(true);
  });

  it('rejects a session signed with a different deployment secret', () => {
    const issued = issueConfigSession(buildEnv({ sessionSecret: 'b'.repeat(32) }), AT);

    expect(verifyConfigSession(issued, buildEnv(), AT)).toBe(false);
  });

  it('rejects a client session cookie presented as a configuration session', async () => {
    const env = buildEnv();
    const { issueSession } = await import('@/lib/auth/session');

    expect(verifyConfigSession(issueSession('jane@client.example', env, AT), env, AT)).toBe(false);
  });

  it.each([undefined, '', 'nonsense', 'a.b.c'])('rejects %s as a session value', (value) => {
    expect(verifyConfigSession(value, buildEnv(), AT)).toBe(false);
  });

  it('expires well before a client session does, because it is the stronger credential', () => {
    const env = buildEnv();
    const cookie = issueConfigSession(env, AT);
    const anHourLater = new Date(AT.getTime() + 60 * 60 * 1000);

    expect(verifyConfigSession(cookie, env, anHourLater)).toBe(false);
  });

  it('names a cookie distinct from the client session cookie', async () => {
    const { SESSION_COOKIE } = await import('@/lib/auth/session');

    expect(CONFIG_SESSION_COOKIE).not.toBe(SESSION_COOKIE);
  });

  it('scopes the cookie to http-only, same-site, and secure under https', () => {
    const options = configSessionCookieOptions(buildEnv());

    expect(options).toMatchObject({ httpOnly: true, sameSite: 'strict', secure: true });
  });

  it('does not demand https from an installation served over http', () => {
    const options = configSessionCookieOptions(buildEnv({ publicBaseUrl: 'http://localhost:3000' }));

    expect(options.secure).toBe(false);
  });
});

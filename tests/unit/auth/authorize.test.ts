import { describe, expect, it } from 'vitest';
import type { Env } from '@/types';
import { issueSession } from '@/lib/auth/session';
import { authorizeSession } from '@/lib/auth/authorize';

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
    configPasswordHash: 'argon2id$hash',
    configTotpSecret: 'BASE32SECRET',
    smtpUrl: 'smtps://user:pass@smtp.example.com:465',
    smtpFrom: 'webagent@client.example',
    publicBaseUrl: 'https://client.example',
  maxConcurrentRuns: 2,    ...overrides,
  };
}

describe('authorizeSession', () => {
  it('grants access for a valid session whose email is on the allow list', () => {
    const env = buildEnv();
    const cookie = issueSession('jane@client.example', env);

    const result = authorizeSession(cookie, env);

    expect(result).toEqual({ ok: true, session: { email: 'jane@client.example', expiresAt: expect.any(Number) } });
  });

  it('reports no_session when there is no cookie at all', () => {
    const env = buildEnv();

    expect(authorizeSession(undefined, env)).toEqual({ ok: false, reason: 'no_session' });
  });

  it('reports no_session for a tampered or otherwise unsigned cookie', () => {
    const env = buildEnv();

    expect(authorizeSession('not-a-real-cookie', env)).toEqual({ ok: false, reason: 'no_session' });
  });

  it('reports expired for a session past its expiry', () => {
    const env = buildEnv();
    const issuedAt = new Date('2026-09-02T10:00:00Z');
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cookie = issueSession('jane@client.example', env, issuedAt);

    const result = authorizeSession(cookie, env, new Date(issuedAt.getTime() + sevenDaysMs + 1000));

    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports not_permitted for a validly signed session whose email is not on the allow list', () => {
    const env = buildEnv({ allowedEmails: ['jane@client.example'] });
    const cookie = issueSession('someone-else@client.example', env);

    const result = authorizeSession(cookie, env);

    expect(result).toEqual({ ok: false, reason: 'not_permitted' });
  });

  // Constitution VI / FR-003c: authorization is a single choke point, and
  // FR-003c1 makes ALLOWED_EMAILS deliberately absent from the repository so
  // write access to the site can never grant access to the editing
  // interface. This is the test for that: a session that was valid at
  // sign-in must stop being valid the moment env.allowedEmails narrows,
  // without anything re-issuing or re-checking at sign-in time only.
  it('re-checks against the configured ALLOWED_EMAILS on every call, not only at sign-in', () => {
    const signInEnv = buildEnv({ allowedEmails: ['jane@client.example', 'marketing@client.example'] });
    const cookie = issueSession('jane@client.example', signInEnv);

    const firstRequest = authorizeSession(cookie, signInEnv);
    expect(firstRequest.ok).toBe(true);

    const narrowedEnv = buildEnv({ allowedEmails: ['marketing@client.example'] });
    const secondRequest = authorizeSession(cookie, narrowedEnv);

    expect(secondRequest).toEqual({ ok: false, reason: 'not_permitted' });
  });

  // FR-003c1: permitted sign-ins live only in deployment configuration
  // (Env.allowedEmails), never in the site's own repository settings — a
  // developer with write access to the repository must not be able to grant
  // themselves access to the editing interface by adding an `allowedEmails`
  // key to `.webagent/config.yml`.
  it('FR-003c1: an allowedEmails key belonging to repository settings grants nobody access', () => {
    // Shaped like the parsed settings another module reads from the
    // repository (src/lib/config/settings.ts) — never actually of type Env.
    const repositorySettings: { allowedEmails: string[] } = {
      allowedEmails: ['attacker@evil.example'],
    };
    const env = buildEnv({ allowedEmails: ['jane@client.example'] });
    const cookie = issueSession('attacker@evil.example', env);

    const result = authorizeSession(cookie, env);

    // The attacker's address exists only in the settings-shaped object, and
    // authorizeSession has no parameter through which that object could
    // reach it — env.allowedEmails is the only source it reads.
    expect(repositorySettings.allowedEmails).toContain('attacker@evil.example');
    expect(result).toEqual({ ok: false, reason: 'not_permitted' });

    // Type-level half of the same assertion: authorizeSession's third
    // parameter is `now?: Date`, with no slot shaped for a settings object,
    // so smuggling one in is a compile error rather than something the
    // runtime merely happens to ignore. Built as a tuple, never invoked, so
    // the point is made without actually calling the function with a
    // non-Date "now" (which would throw at runtime, not just at the type
    // checker).
    type AuthorizeSessionArgs = Parameters<typeof authorizeSession>;
    // @ts-expect-error a settings object has no home in authorizeSession's parameter list
    const smuggledSettings: AuthorizeSessionArgs = [cookie, env, repositorySettings];
    expect(smuggledSettings).toBeDefined();
  });
});

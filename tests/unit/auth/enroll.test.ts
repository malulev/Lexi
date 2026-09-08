// The only link that shows the authenticator secret. It must not be
// derivable from a magic link: proof of an inbox is not proof of the right to
// see the seed every sign-in depends on.
import { describe, expect, it } from 'vitest';

import { ENROLL_TTL_MS, enrollmentUrl, issueEnrollToken, verifyEnrollToken } from '@/lib/auth/enroll';
import { issueMagicLinkToken } from '@/lib/auth/magic-link';
import type { Env } from '@/types';

const AT = new Date('2026-09-08T10:00:00Z');

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
    totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    smtpUrl: 'smtps://user:pass@smtp.example.com:465',
    smtpFrom: 'webagent@client.example',
    publicBaseUrl: 'https://edit.client.example',
    maxConcurrentRuns: 2,
    ...overrides,
  };
}

describe('enrollment token', () => {
  it('verifies for 24 hours and not after', () => {
    const token = issueEnrollToken(buildEnv(), AT);
    expect(verifyEnrollToken(token, buildEnv(), new Date(AT.getTime() + ENROLL_TTL_MS - 1000))).toBe(true);
    expect(verifyEnrollToken(token, buildEnv(), new Date(AT.getTime() + ENROLL_TTL_MS + 1000))).toBe(false);
  });

  it('is not interchangeable with a magic link', () => {
    const magic = issueMagicLinkToken('jane@client.example', buildEnv(), AT)!;
    expect(verifyEnrollToken(magic, buildEnv(), AT)).toBe(false);
  });

  it('is rejected when signed by another installation', () => {
    const token = issueEnrollToken(buildEnv(), AT);
    expect(verifyEnrollToken(token, buildEnv({ sessionSecret: 'b'.repeat(32) }), AT)).toBe(false);
  });

  it('rejects garbage without throwing', () => {
    expect(verifyEnrollToken(undefined, buildEnv(), AT)).toBe(false);
    expect(verifyEnrollToken(null, buildEnv(), AT)).toBe(false);
    expect(verifyEnrollToken('not.a.token', buildEnv(), AT)).toBe(false);
    expect(verifyEnrollToken('nodot', buildEnv(), AT)).toBe(false);
  });

  it('builds the URL from PUBLIC_BASE_URL', () => {
    const url = enrollmentUrl(buildEnv(), AT);
    expect(url.startsWith('https://edit.client.example/login/enroll?token=')).toBe(true);
    expect(verifyEnrollToken(new URL(url).searchParams.get('token'), buildEnv(), AT)).toBe(true);
  });
});

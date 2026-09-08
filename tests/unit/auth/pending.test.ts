// Half a sign-in: the link was followed, the code was not entered. The
// load-bearing case is the last one — a pending cookie must never pass as a
// session, or the code step is decoration.
import { describe, expect, it } from 'vitest';

import {
  PENDING_COOKIE,
  PENDING_TTL_MS,
  issuePending,
  pendingCookieOptions,
  verifyPending,
} from '@/lib/auth/pending';
import { verifySession } from '@/lib/auth/session';
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

describe('pending sign-in cookie', () => {
  it('round-trips the email and lower-cases it', () => {
    const cookie = issuePending('Jane@Client.example', buildEnv(), AT);
    expect(verifyPending(cookie, buildEnv(), AT)).toEqual({ email: 'jane@client.example' });
  });

  it('expires after ten minutes', () => {
    const cookie = issuePending('jane@client.example', buildEnv(), AT);
    const later = new Date(AT.getTime() + PENDING_TTL_MS + 1000);
    expect(verifyPending(cookie, buildEnv(), later)).toBeNull();
  });

  it('is rejected when tampered with, signed elsewhere, or absent', () => {
    const cookie = issuePending('jane@client.example', buildEnv(), AT);
    expect(verifyPending(`${cookie}x`, buildEnv(), AT)).toBeNull();
    expect(verifyPending(cookie, buildEnv({ sessionSecret: 'b'.repeat(32) }), AT)).toBeNull();
    expect(verifyPending(undefined, buildEnv(), AT)).toBeNull();
    expect(verifyPending('', buildEnv(), AT)).toBeNull();
  });

  it('is never accepted as a session', () => {
    const pending = issuePending('jane@client.example', buildEnv(), AT);
    expect(verifySession(pending, buildEnv(), AT)).toBeNull();
  });

  it('names the cookie and scopes it to the whole site', () => {
    expect(PENDING_COOKIE).toBe('webagent_pending');
    expect(pendingCookieOptions(buildEnv())).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
      maxAge: PENDING_TTL_MS / 1000,
    });
    expect(pendingCookieOptions(buildEnv({ publicBaseUrl: 'http://localhost:3000' })).secure).toBe(false);
  });
});

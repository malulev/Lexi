// Sign-in is two steps now: the email link, then an authenticator code. The
// load-bearing cases are that the link alone yields no session, and that the
// code route issues one only over a valid pending cookie and a right code.
import { generate } from 'otplib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PENDING_COOKIE,
  SESSION_COOKIE,
  issueMagicLinkToken,
  issuePending,
  verifyPending,
  verifySession,
} from '@/lib/auth';
import { loadEnv } from '@/lib/config/env';
import { setInstallation, type Installation } from '@/lib/installation';
import { createFakeMailer } from '@/lib/notify/email';

const { GET, POST } = await import('@/app/api/auth/[...route]/route');

afterEach(() => setInstallation(null));

/** The auth routes touch nothing but the environment and the mailer. */
function installMinimal(): void {
  setInstallation({ env: loadEnv(), mailer: createFakeMailer() } as unknown as Installation);
}

function cookieHeader(name: string, value: string): Record<string, string> {
  return { cookie: `${name}=${encodeURIComponent(value)}` };
}

function setCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
}

function cookieValue(setCookieLine: string): string {
  return decodeURIComponent(setCookieLine.split(';')[0]!.slice(setCookieLine.indexOf('=') + 1));
}

async function currentCode(): Promise<string> {
  return generate({ secret: loadEnv().totpSecret });
}

async function postCode(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost:3000/api/auth/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ route: ['code'] }) },
  );
}

describe('GET /api/auth/callback', () => {
  it('issues a pending cookie, not a session, and sends the browser to the code page', async () => {
    installMinimal();
    const env = loadEnv();
    const token = issueMagicLinkToken('jane@client.example', env)!;

    const response = await GET(
      new Request(`http://localhost:3000/api/auth/callback?token=${encodeURIComponent(token)}`),
      { params: Promise.resolve({ route: ['callback'] }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/login/code');
    const pending = setCookie(response, PENDING_COOKIE);
    expect(pending).toBeDefined();
    expect(verifyPending(cookieValue(pending!), env)).toEqual({ email: 'jane@client.example' });
    // Any session cookie on this response is a clearing one, never a live one.
    const session = setCookie(response, SESSION_COOKIE);
    expect(session === undefined || /Max-Age=0/.test(session)).toBe(true);
  });

  it('still bounces a bad link to the sign-in page', async () => {
    installMinimal();
    const response = await GET(new Request('http://localhost:3000/api/auth/callback?token=nope'), {
      params: Promise.resolve({ route: ['callback'] }),
    });
    expect(response.headers.get('location')).toBe('http://localhost:3000/login?error=expired');
    expect(setCookie(response, PENDING_COOKIE)).toBeUndefined();
  });
});

describe('POST /api/auth/code', () => {
  it('upgrades a pending cookie to a session on the right code', async () => {
    installMinimal();
    const env = loadEnv();
    const pending = issuePending('jane@client.example', env);

    const response = await postCode({ code: await currentCode() }, cookieHeader(PENDING_COOKIE, pending));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    const session = setCookie(response, SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(verifySession(cookieValue(session!), env)?.email).toBe('jane@client.example');
    expect(setCookie(response, PENDING_COOKIE)).toMatch(/Max-Age=0/);
  });

  it('refuses a wrong code and issues no session', async () => {
    installMinimal();
    const pending = issuePending('jane@client.example', loadEnv());

    const response = await postCode({ code: '000000' }, cookieHeader(PENDING_COOKIE, pending));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'refused' });
    expect(setCookie(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('refuses a malformed body the same way', async () => {
    installMinimal();
    const pending = issuePending('jane@client.example', loadEnv());

    const response = await postCode({ nothing: true }, cookieHeader(PENDING_COOKIE, pending));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'refused' });
  });

  it('refuses without a pending cookie, even with the right code', async () => {
    installMinimal();

    const response = await postCode({ code: await currentCode() });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'expired' });
    expect(setCookie(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('refuses a session cookie presented as a pending one', async () => {
    installMinimal();
    const env = loadEnv();
    const { issueSession } = await import('@/lib/auth');
    const session = issueSession('jane@client.example', env);

    const response = await postCode({ code: await currentCode() }, cookieHeader(PENDING_COOKIE, session));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'expired' });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears both cookies', async () => {
    installMinimal();
    const response = await POST(new Request('http://localhost:3000/api/auth/logout', { method: 'POST' }), {
      params: Promise.resolve({ route: ['logout'] }),
    });
    expect(response.status).toBe(303);
    expect(setCookie(response, SESSION_COOKIE)).toMatch(/Max-Age=0/);
    expect(setCookie(response, PENDING_COOKIE)).toMatch(/Max-Age=0/);
  });
});

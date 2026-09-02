import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env, Session } from '@/types';
import { loadEnv } from '@/lib/config/env';

/**
 * The session (data-model.md `Session`): a signed cookie carrying the email
 * address and an expiry, with no server-side record. `node:crypto` only.
 */

export const SESSION_COOKIE = 'webagent_session';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A subkey per purpose, not the raw `SESSION_SECRET`, so a session cookie
 * and a magic-link token (src/lib/auth/magic-link.ts) can never be mistaken
 * for one another even though both derive from the same deployment secret.
 */
function sessionKey(env: Env): Buffer {
  return createHmac('sha256', env.sessionSecret).update('session').digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

/** Constant-time comparison that tolerates mismatched lengths instead of throwing. */
function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Builds the signed cookie value. `now` is injectable so tests never wait on the clock. */
export function issueSession(email: string, env: Env, now: Date = new Date()): string {
  const session: Session = {
    email: email.trim().toLowerCase(),
    expiresAt: Math.floor((now.getTime() + SESSION_TTL_MS) / 1000),
  };
  const encodedPayload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = sign(encodedPayload, sessionKey(env));
  return `${encodedPayload}.${signature}`;
}

function parseSession(encodedPayload: string): Session | null {
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (typeof decoded?.email === 'string' && typeof decoded?.expiresAt === 'number') {
      return decoded as Session;
    }
    return null;
  } catch {
    return null;
  }
}

export type SessionInspection =
  | { status: 'ok'; session: Session }
  | { status: 'expired' }
  | { status: 'invalid' };

/**
 * The one place that decodes a cookie value, distinguishing "not a valid,
 * correctly-signed session at all" from "was valid but has expired" —
 * `authorizeSession` (src/lib/auth/authorize.ts) needs that distinction to
 * report `no_session` versus `expired`; `verifySession` below collapses it
 * for callers that only care whether the session is currently usable.
 */
export function inspectSession(value: string | undefined, env: Env, now: Date = new Date()): SessionInspection {
  if (!value) {
    return { status: 'invalid' };
  }

  const parts = value.split('.');
  if (parts.length !== 2) {
    return { status: 'invalid' };
  }

  const [encodedPayload, signature] = parts as [string, string];
  if (!signaturesMatch(signature, sign(encodedPayload, sessionKey(env)))) {
    return { status: 'invalid' };
  }

  const session = parseSession(encodedPayload);
  if (!session) {
    return { status: 'invalid' };
  }

  if (session.expiresAt * 1000 <= now.getTime()) {
    return { status: 'expired' };
  }

  return { status: 'ok', session };
}

/**
 * Verifies signature and expiry only. It does NOT check `env.allowedEmails`
 * — that recheck belongs solely to `authorizeSession` (src/lib/auth/
 * authorize.ts), the one choke point every route calls, so removing an
 * address is enforced in exactly one place rather than duplicated here.
 */
export function verifySession(value: string | undefined, env: Env, now: Date = new Date()): Session | null {
  const inspection = inspectSession(value, env, now);
  return inspection.status === 'ok' ? inspection.session : null;
}

/**
 * `env` defaults to `loadEnv()` so a route handler can call this with no
 * arguments once the application has started; tests pass an explicit `Env`
 * to stay independent of `process.env`.
 */
export function sessionCookieOptions(env: Env = loadEnv()): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.publicBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

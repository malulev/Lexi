import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Env } from '@/types';

/**
 * Half a sign-in: the email link has been followed, the authenticator code
 * has not been entered. A different cookie signed with a different subkey,
 * so nothing that checks for a session can be fooled by it, and vice versa.
 * Short-lived, because it is worth exactly one code entry.
 */

export const PENDING_COOKIE = 'webagent_pending';
export const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingPayload {
  email: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

function pendingKey(env: Env): Buffer {
  return createHmac('sha256', env.sessionSecret).update('pending-session').digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

function signaturesMatch(a: string, b: string): boolean {
  // Hex decoding stops at the first non-hex character, so a signature with
  // junk appended would decode to the genuine bytes. Require the exact text.
  if (a.length !== b.length || !/^[0-9a-f]+$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function issuePending(email: string, env: Env, now: Date = new Date()): string {
  const payload: PendingPayload = {
    email: email.trim().toLowerCase(),
    expiresAt: Math.floor((now.getTime() + PENDING_TTL_MS) / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, pendingKey(env))}`;
}

function parsePayload(encoded: string): PendingPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof decoded?.email === 'string' && typeof decoded?.expiresAt === 'number') {
      return decoded as PendingPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function verifyPending(
  value: string | undefined,
  env: Env,
  now: Date = new Date(),
): { email: string } | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];
  if (!signaturesMatch(signature, sign(encoded, pendingKey(env)))) return null;
  const payload = parsePayload(encoded);
  if (!payload || payload.expiresAt * 1000 <= now.getTime()) return null;
  return { email: payload.email };
}

export function pendingCookieOptions(env: Env): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    // Lax, not strict: the browser arrives here by following a link from an
    // email client, which is a cross-site navigation.
    sameSite: 'lax',
    secure: env.publicBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: PENDING_TTL_MS / 1000,
  };
}

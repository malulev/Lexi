import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Env } from '@/types';

/**
 * The one link that shows the authenticator secret. Minted by the operator
 * (`npm run enroll:link`), never by the app on its own, and signed with a
 * subkey the magic link does not use — so proof of an inbox is not proof of
 * the right to see the seed every sign-in depends on.
 */

export const ENROLL_TTL_MS = 24 * 60 * 60 * 1000;

function enrollKey(env: Env): Buffer {
  return createHmac('sha256', env.sessionSecret).update('totp-enroll').digest();
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

export function issueEnrollToken(env: Env, now: Date = new Date()): string {
  const payload = { iat: now.getTime(), nonce: randomBytes(12).toString('hex') };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, enrollKey(env))}`;
}

export function verifyEnrollToken(
  token: string | null | undefined,
  env: Env,
  now: Date = new Date(),
): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, signature] = parts as [string, string];
  if (!signaturesMatch(signature, sign(encoded, enrollKey(env)))) return false;
  try {
    const { iat } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof iat !== 'number') return false;
    const age = now.getTime() - iat;
    return age >= 0 && age <= ENROLL_TTL_MS;
  } catch {
    return false;
  }
}

export function enrollmentUrl(env: Env, now: Date = new Date()): string {
  return `${env.publicBaseUrl}/login/enroll?token=${encodeURIComponent(issueEnrollToken(env, now))}`;
}

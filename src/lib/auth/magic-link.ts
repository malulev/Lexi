import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Env } from '@/types';

/**
 * Client sign-in (R6): a short-lived, server-signed token mailed to the
 * address, with nothing per-user held at rest. `node:crypto` only — no new
 * dependency for what HMAC-SHA256 already does well.
 *
 * Single use, honestly stated: there is no datastore (constitution VII), so
 * nothing here can record that a token was already consumed. What this
 * module actually guarantees is a validity *window* — the token verifies to
 * the same address for as long as the window is open, and stops verifying
 * the instant it closes. It does not, and cannot, guarantee that a link is
 * consumed at most once; a link intercepted inside the window is as good as
 * the original until the window closes. That is the accepted, documented
 * trade-off for having no server-side session store. `tests/unit/auth/
 * magic-link.test.ts` asserts exactly this weaker property rather than
 * pretending to a stronger one.
 */

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

interface MagicLinkPayload {
  email: string;
  /** Milliseconds since the epoch. */
  iat: number;
  /** Adds entropy so two links for the same address never look identical. */
  nonce: string;
}

/**
 * A subkey per purpose, not the raw `SESSION_SECRET`, so a magic-link token
 * and a session cookie (src/lib/auth/session.ts) can never be mistaken for
 * one another even though both derive from the same deployment secret.
 */
function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac('sha256', secret).update(purpose).digest();
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

function magicLinkKey(env: Env): Buffer {
  return deriveKey(env.sessionSecret, 'magic-link');
}

/**
 * `null` means exactly one thing to the caller: send no email. The address
 * not being on `env.allowedEmails` and every other possible failure look
 * identical from the outside, which is what keeps `/api/auth/request` from
 * ever revealing whether an address is permitted.
 */
export function issueMagicLinkToken(email: string, env: Env, now: Date = new Date()): string | null {
  const normalisedEmail = email.trim().toLowerCase();
  if (!env.allowedEmails.includes(normalisedEmail)) {
    return null;
  }

  const payload: MagicLinkPayload = {
    email: normalisedEmail,
    iat: now.getTime(),
    nonce: randomBytes(16).toString('hex'),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encodedPayload, magicLinkKey(env));
  return `${encodedPayload}.${signature}`;
}

function parsePayload(encodedPayload: string): MagicLinkPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (typeof decoded?.email === 'string' && typeof decoded?.iat === 'number') {
      return decoded as MagicLinkPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Never throws on malformed input — a bad token is just not a valid sign-in. */
export function verifyMagicLinkToken(
  token: string,
  env: Env,
  now: Date = new Date(),
): { email: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts as [string, string];
  if (!signaturesMatch(signature, sign(encodedPayload, magicLinkKey(env)))) {
    return null;
  }

  const payload = parsePayload(encodedPayload);
  if (!payload) {
    return null;
  }

  const age = now.getTime() - payload.iat;
  if (age < 0 || age > MAGIC_LINK_TTL_MS) {
    return null;
  }

  return { email: payload.email };
}

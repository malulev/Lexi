import { verify as verifyTotp } from 'otplib';

import type { Env } from '@/types';

/**
 * The second factor at sign-in: a six-digit code from an authenticator app
 * seeded with the installation's one shared secret (`TOTP_SECRET`).
 *
 * No database, so a code is valid for its window plus the drift below, not
 * single-use. That is the same documented trade-off the magic link makes
 * (src/lib/auth/magic-link.ts), stated here rather than pretended away.
 */

const CODE_DRIFT_SECONDS = 30;

export async function verifyTotpCode(code: string, env: Env, now: Date = new Date()): Promise<boolean> {
  const token = code.trim();
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = await verifyTotp({
      secret: env.totpSecret,
      token,
      epoch: Math.floor(now.getTime() / 1000),
      epochTolerance: CODE_DRIFT_SECONDS,
    });
    return result.valid;
  } catch {
    // An unusable secret is a startup fault and is reported there; here it
    // can only ever mean "no code is accepted".
    return false;
  }
}

/**
 * Startup validation asks this, so a bad secret refuses to serve with its
 * name rather than refusing every client with no explanation.
 */
export async function isUsableTotpSecret(secret: string, at: Date = new Date()): Promise<boolean> {
  try {
    await verifyTotp({ secret, token: '000000', epoch: Math.floor(at.getTime() / 1000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * What an authenticator app scans. The secret travels inside it, so this is
 * rendered only behind the operator-issued enrollment token (enroll.ts).
 */
export function otpauthUri(env: Env, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: env.totpSecret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

import { createHmac, timingSafeEqual } from 'node:crypto';

import argon2 from 'argon2';
import { verify as verifyTotp } from 'otplib';

import { loadEnv } from '@/lib/config/env';
import type { Env } from '@/types';

/**
 * The configuration credential (FR-003a, R6): a password verified against an
 * argon2 hash, plus a time-based code verified against a shared secret. Both
 * are deployment configuration, so this is the stronger credential without a
 * datastore holding anything at rest (constitution VII).
 *
 * Constitution Principle III in its strictest reading applies here. This
 * decision is arithmetic — a hash comparison and a clock — and nothing about
 * it is delegated, inferred, or asked of a model. There is exactly one way to
 * reach `{ ok: true }`, and it runs both checks.
 *
 * `reason` exists so a failure can be logged with context. It is for the
 * server's log, never for the person at the form: telling an attacker which
 * half they got right is the one thing a second factor must not do.
 */

export type ConfigCredentialResult =
  | { ok: true }
  | { ok: false; reason: 'password' | 'code' | 'misconfigured' };

/**
 * One time step either side of now. RFC 6238's own recommendation, and the
 * smallest allowance that survives a phone whose clock is a few seconds off.
 */
const CODE_DRIFT_SECONDS = 30;

/**
 * Verifies a password against `CONFIG_PASSWORD_HASH`.
 *
 * argon2 throws when the configured value is not an encoded hash at all — a
 * plaintext password pasted into the variable by mistake, say. That is a
 * misconfiguration, and it must refuse rather than propagate: a thrown error
 * here would reach a route as a 500, which reads like a bug rather than like
 * the refusal it is.
 */
async function matchesConfiguredPassword(password: string, env: Env): Promise<boolean | 'unusable'> {
  if (password.length === 0) return false;
  try {
    return await argon2.verify(env.configPasswordHash, password);
  } catch {
    return 'unusable';
  }
}

/**
 * Verifies a code against `CONFIG_TOTP_SECRET`.
 *
 * otplib rejects a malformed token by throwing, and a secret that is not
 * usable base32 — or is shorter than the 16 bytes it requires — the same way.
 * The first is an ordinary bad code; the second is a misconfiguration, and
 * they are told apart by validating the secret independently of the token.
 */
async function matchesConfiguredCode(code: string, env: Env, now: Date): Promise<boolean | 'unusable'> {
  const epoch = Math.floor(now.getTime() / 1000);
  try {
    const result = await verifyTotp({
      secret: env.configTotpSecret,
      token: code,
      epoch,
      epochTolerance: CODE_DRIFT_SECONDS,
    });
    return result.valid;
  } catch {
    return (await isUsableTotpSecret(env.configTotpSecret, now)) ? false : 'unusable';
  }
}

/**
 * Whether `CONFIG_PASSWORD_HASH` is an encoded argon2 hash at all, asked by
 * verifying a password it cannot be. A wrong password returns false; a value
 * that is not a hash throws, and that is the distinction being drawn.
 *
 * Startup validation (src/lib/config/startup.ts) calls this so a deployment
 * that pasted a plaintext password into the variable is told at boot rather
 * than at the moment someone needs to sign in.
 */
export async function isUsablePasswordHash(hash: string): Promise<boolean> {
  try {
    await argon2.verify(hash, 'a password this hash cannot encode');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `CONFIG_TOTP_SECRET` is base32 an authenticator app could hold, and
 * long enough for otplib to accept (16 bytes — the 16-character sample secret
 * that appears in so much documentation is half of that, and is rejected).
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
 * The one way in. Both factors are checked; there is no argument, flag, or
 * ordering that makes either optional.
 */
export async function verifyConfigCredential(
  input: { password: string; code: string },
  env: Env,
  now: Date = new Date(),
): Promise<ConfigCredentialResult> {
  const password = await matchesConfiguredPassword(input.password, env);
  if (password === 'unusable') return { ok: false, reason: 'misconfigured' };

  const code = await matchesConfiguredCode(input.code, env, now);
  if (code === 'unusable') return { ok: false, reason: 'misconfigured' };

  if (!password) return { ok: false, reason: 'password' };
  if (!code) return { ok: false, reason: 'code' };

  return { ok: true };
}

// ---------------------------------------------------------------------------
// The configuration session
// ---------------------------------------------------------------------------

export const CONFIG_SESSION_COOKIE = 'webagent_config';

/**
 * Half an hour, against a client session's seven days. The credential this
 * cookie stands in for can redirect the installation at a different website,
 * so an unattended browser should stop holding it long before the working day
 * ends. Re-entering a password and a code is the intended cost.
 */
const CONFIG_SESSION_TTL_MS = 30 * 60 * 1000;

/** A subkey per purpose, as in session.ts: a client cookie can never be read as a configuration one. */
function configSessionKey(env: Env): Buffer {
  return createHmac('sha256', env.sessionSecret).update('config-session').digest();
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

/**
 * The cookie carries an expiry and nothing else. There is no identity to
 * record: an installation has one configuration credential, not a directory
 * of them (constitution VI).
 */
export function issueConfigSession(env: Env, now: Date = new Date()): string {
  const expiresAt = Math.floor((now.getTime() + CONFIG_SESSION_TTL_MS) / 1000);
  const encodedPayload = Buffer.from(JSON.stringify({ expiresAt })).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, configSessionKey(env))}`;
}

function parseExpiry(encodedPayload: string): number | null {
  try {
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return typeof decoded?.expiresAt === 'number' ? decoded.expiresAt : null;
  } catch {
    return null;
  }
}

/** Never throws on malformed input — anything that is not a currently valid session is simply `false`. */
export function verifyConfigSession(
  value: string | undefined,
  env: Env,
  now: Date = new Date(),
): boolean {
  if (!value) return false;

  const parts = value.split('.');
  if (parts.length !== 2) return false;

  const [encodedPayload, signature] = parts as [string, string];
  if (!signaturesMatch(signature, sign(encodedPayload, configSessionKey(env)))) return false;

  const expiresAt = parseExpiry(encodedPayload);
  if (expiresAt === null) return false;

  return expiresAt * 1000 > now.getTime();
}

/**
 * `sameSite: 'strict'`, unlike the client session's `lax`: nothing ever
 * navigates into the configuration surface from another site, so there is no
 * usability cost to refusing cross-site carriage of this cookie.
 */
export function configSessionCookieOptions(env: Env = loadEnv()): {
  httpOnly: true;
  sameSite: 'strict';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.publicBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: CONFIG_SESSION_TTL_MS / 1000,
  };
}

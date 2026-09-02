import type { Env, Session } from '@/types';
import { inspectSession } from '@/lib/auth/session';

/**
 * The single authorization choke point (constitution VI): every route that
 * needs a signed-in client calls this, and only this, to decide whether the
 * request may proceed. Nothing upstream of a route handler is trusted to
 * have already checked — a session accepted a minute ago is re-checked
 * again here on the next request.
 *
 * Its only source of permitted addresses is `env.allowedEmails`. There is
 * deliberately no parameter through which repository-sourced settings could
 * reach this function (FR-003c1) — write access to the site's repository
 * must never be able to grant access to the editing interface.
 */
export type AuthResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'no_session' | 'expired' | 'not_permitted' };

export function authorizeSession(cookieValue: string | undefined, env: Env, now: Date = new Date()): AuthResult {
  const inspection = inspectSession(cookieValue, env, now);

  if (inspection.status === 'invalid') {
    return { ok: false, reason: 'no_session' };
  }
  if (inspection.status === 'expired') {
    return { ok: false, reason: 'expired' };
  }

  // Re-checked here, every call, against deployment configuration only —
  // this is the enforcement behind "removing an address takes effect on the
  // next request" (contracts/http-api.md).
  if (!env.allowedEmails.includes(inspection.session.email)) {
    return { ok: false, reason: 'not_permitted' };
  }

  return { ok: true, session: inspection.session };
}

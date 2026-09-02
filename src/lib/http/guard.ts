import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { authorizeSession, SESSION_COOKIE } from '@/lib/auth';
import { getInstallation } from '@/lib/installation';
import { errorBody, ERROR_STATUS } from '@/lib/jobs/messages';
import type { ErrorCode, Session } from '@/types';

/**
 * The one place a request is authorized (constitution Principle VI).
 *
 * Every route calls this and none of them re-implements it, because an
 * authorization rule written twice is an authorization rule that will
 * eventually disagree with itself. Identity is re-checked against the
 * configured addresses on every request, so removing an address takes effect
 * on the next one rather than at the next sign-in.
 */
export async function requireClient(): Promise<
  { ok: true; session: Session } | { ok: false; response: NextResponse }
> {
  const { env } = getInstallation();
  const store = await cookies();
  const result = authorizeSession(store.get(SESSION_COOKIE)?.value, env);

  if (result.ok) return { ok: true, session: result.session };

  // The reason is deliberately not distinguished to the caller. Telling an
  // unauthenticated request whether an address is permitted is the same
  // disclosure the sign-in route is careful to avoid.
  return {
    ok: false,
    response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
  };
}

export function fail(code: ErrorCode): NextResponse {
  return NextResponse.json(errorBody(code), { status: ERROR_STATUS[code] });
}

/**
 * A route that throws must still answer in the client's vocabulary. The detail
 * is logged with its context and never returned (Principle I).
 */
export function failUnexpectedly(context: string, cause: unknown): NextResponse {
  console.error(`[webagent] ${context}`, cause);
  return fail('internal_error');
}

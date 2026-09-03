'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  CONFIG_SESSION_COOKIE,
  configSessionCookieOptions,
  issueConfigSession,
  verifyConfigCredential,
} from '@/lib/auth/config-credential';
import { getInstallation } from '@/lib/installation';

/**
 * Signing in to the configuration surface, and out of it again.
 *
 * The credential itself lives in src/lib/auth/config-credential.ts and the
 * decision is made there; this file only carries a form's fields to it and
 * turns the answer into a cookie. Nothing here decides anything.
 */

export interface ConfigSignInState {
  error: string | null;
}

/**
 * One message for every refusal. Which half was wrong is written to the log
 * with its context and never to the page — a form that says "the code is
 * wrong" has just told an attacker the password is right.
 */
const REFUSED = 'That password and code were not accepted.';

export async function signInToConfig(
  _previous: ConfigSignInState,
  formData: FormData,
): Promise<ConfigSignInState> {
  const { env } = getInstallation();
  const password = String(formData.get('password') ?? '');
  const code = String(formData.get('code') ?? '').trim();

  const result = await verifyConfigCredential({ password, code }, env);

  if (!result.ok) {
    console.warn(`[webagent] configuration sign-in refused (${result.reason})`);
    return { error: REFUSED };
  }

  const store = await cookies();
  store.set(CONFIG_SESSION_COOKIE, issueConfigSession(env), configSessionCookieOptions(env));
  return { error: null };
}

export async function signOutOfConfig(): Promise<void> {
  const store = await cookies();
  store.delete(CONFIG_SESSION_COOKIE);
  // Redirected rather than re-rendered, so a browser's back button lands on
  // the gate rather than on a cached copy of the configuration.
  redirect('/settings');
}

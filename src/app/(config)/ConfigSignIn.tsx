'use client';

import { useActionState } from 'react';

import { signInToConfig, type ConfigSignInState } from './actions';

/**
 * The gate on the configuration surface (FR-003a).
 *
 * Both fields are always required. There is no "remember this device", no
 * recovery link, and no way to present one factor without the other: the
 * credential this form carries can point the installation at a different
 * website, so the only path through it is the one the server checks in full.
 */
const INITIAL: ConfigSignInState = { error: null };

export function ConfigSignIn() {
  const [state, submit, pending] = useActionState(signInToConfig, INITIAL);

  return (
    <main className="config-gate">
      <form className="config-gate__form" action={submit}>
        <h1>Configuration</h1>
        <p className="config-gate__intro">
          This page is for whoever operates this installation. It is not the editing interface.
        </p>

        <label className="config-gate__label" htmlFor="password">
          Configuration password
        </label>
        <input
          id="password"
          name="password"
          className="config-gate__input"
          type="password"
          autoComplete="current-password"
          required
        />

        <label className="config-gate__label" htmlFor="code">
          Authenticator code
        </label>
        <input
          id="code"
          name="code"
          className="config-gate__input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
        />

        <button className="config-gate__submit" type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Unlock'}
        </button>

        {state.error ? <p className="config-gate__error">{state.error}</p> : null}
      </form>
    </main>
  );
}

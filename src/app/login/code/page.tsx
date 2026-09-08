'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { Wordmark } from '@/components/Brand';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useTranslation } from '@/components/LocaleProvider';
import { nextAfterCode } from './outcome';
import '@/components/client.css';

/**
 * The second step of signing in: the email link has landed the browser here
 * with a pending cookie, and the six-digit code turns it into a session.
 */
export default function CodePage() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (checking || code.length === 0) return;
    setChecking(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      const outcome = nextAfterCode(response.status, body);
      if (outcome.kind === 'home') {
        window.location.assign('/');
        return;
      }
      if (outcome.kind === 'signIn') {
        window.location.assign('/login?error=expired');
        return;
      }
      setError(t.login.codeRefused);
      setCode('');
    } catch {
      setError(t.login.codeRefused);
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="login login--narrow">
      <section className="login__form-panel">
        <div className="login__lang">
          <LanguageSwitcher />
        </div>
        <div className="login__card">
          <Wordmark size={24} />
          <form className="login__form" onSubmit={submit}>
            <h2>{t.login.codeTitle}</h2>
            <p className="login__form-hint">{t.login.codeHint}</p>
            <label className="login__label" htmlFor="code">
              {t.login.codeLabel}
            </label>
            <input
              id="code"
              className="login__input login__input--code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              dir="ltr"
            />
            <button className="login__submit" type="submit" disabled={checking}>
              {checking ? t.login.codeChecking : t.login.codeSubmit}
            </button>
            {error ? (
              <p className="login__error" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        </div>
      </section>
    </main>
  );
}

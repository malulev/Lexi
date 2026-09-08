'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { Wordmark } from '@/components/Brand';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useTranslation } from '@/components/LocaleProvider';
import { BRAND } from '@/lib/brand';
import '@/components/client.css';

/**
 * Signing in.
 *
 * The form's answer is deliberately the same whether or not the address may
 * sign in, matching the route behind it: an interface that says "no such user"
 * enumerates a client's staff for anyone who asks. What the person sees is
 * simply that a link is on its way, if there was one to send.
 */
export default function LoginPage() {
  const { t, fill, fillNodes } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    // The callback and the code page send an expired link here with
    // `?error=expired`; say so once, where the client is about to try again.
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('error') === 'expired'
      ? t.login.codeExpired
      : null,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending || !email.trim()) return;

    setSending(true);
    setError(null);

    try {
      await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setSent(true);
    } catch {
      setError(fill(t.login.couldNotReach, { name: BRAND.name }));
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="login">
      <section className="login__pitch">
        <Wordmark size={30} />

        <h1 className="login__headline">
          {t.login.headline}
          <em> {t.login.headlineEm}</em>
        </h1>
        <p className="login__lede">{fill(t.login.lede, { name: BRAND.name })}</p>

        <LoginDemo />
      </section>

      <section className="login__form-panel">
        <div className="login__lang">
          <LanguageSwitcher />
        </div>
        <div className="login__card">
          {sent ? (
            <div className="login__sent" role="status">
              <span className="login__sent-mark" aria-hidden="true">
                ✓
              </span>
              <h2>{t.login.checkEmail}</h2>
              <p>{fillNodes(t.login.linkOnItsWay, { email: <strong>{email.trim()}</strong> })}</p>
              <button type="button" className="login__again" onClick={() => setSent(false)}>
                {t.login.useDifferent}
              </button>
            </div>
          ) : (
            <form className="login__form" onSubmit={submit}>
              <h2>{t.login.signIn}</h2>
              <p className="login__form-hint">{t.login.noPassword}</p>
              <label className="login__label" htmlFor="email">
                {t.login.yourEmail}
              </label>
              <input
                id="email"
                className="login__input"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t.login.emailPlaceholder}
                dir="ltr"
              />
              <button className="login__submit" type="submit" disabled={sending}>
                {sending ? t.login.sending : t.login.emailMe}
              </button>
              {error ? (
                <p className="login__error" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

/**
 * The product in one exchange: a sentence in, a preview out, and a trail
 * that ends at "Ready to look at". Decorative for a screen reader, so hidden
 * from one — the words above already say what it shows.
 */
function LoginDemo() {
  const { t } = useTranslation();
  const stages = t.stages.change;
  const steps = [
    stages.starting,
    stages.running,
    stages.gating,
    stages.pushing,
    stages.building,
    stages.succeeded,
  ];
  return (
    <div className="demo" aria-hidden="true">
      <p className="demo__bubble demo__bubble--client">{t.login.demoClient}</p>
      <p className="demo__bubble demo__bubble--agent">{t.login.demoAgent}</p>
      <ol className="demo__trail">
        {steps.map((step, index) => (
          <li
            key={step}
            className={`demo__step${index === steps.length - 1 ? ' demo__step--current' : ''}`}
            style={{ animationDelay: `${index * 0.35}s` }}
          >
            <span className="demo__dot" />
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

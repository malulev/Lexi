'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
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
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError('Could not reach the site editor just now. Please try again in a moment.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="login">
      <div className="login__panel">
        <div className="login__pitch">
          <p className="login__brand">Site Editor</p>
          <h1>Describe a change. See it before it goes live.</h1>
          <p>
            Tell us what you would like changed about your website in your own words. You will get a
            private preview to look at, and nothing reaches your live site until you say so.
          </p>
        </div>

        <div className="login__form-panel">
          {sent ? (
            <div className="login__sent">
              <h2>Check your email</h2>
              <p>
                If <strong>{email.trim()}</strong> is allowed to edit this website, a sign-in link is
                on its way. It works for the next 15 minutes.
              </p>
            </div>
          ) : (
            <form className="login__form" onSubmit={submit}>
              <h2>Sign in</h2>
              <label className="login__label" htmlFor="email">
                Your email address
              </label>
              <input
                id="email"
                className="login__input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@yourcompany.com"
              />
              <button className="login__submit" type="submit" disabled={sending}>
                {sending ? 'Sending…' : 'Email me a sign-in link'}
              </button>
              {error ? <p className="login__error">{error}</p> : null}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

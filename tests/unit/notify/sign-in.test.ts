import { describe, expect, it } from 'vitest';
import { signInEmail } from '@/lib/notify/sign-in';

const LINK = 'https://edit.example.com/api/auth/callback?token=abc.def&next=%2F';

describe('the sign-in email', () => {
  it('carries the link in the plain text part', () => {
    const email = signInEmail(LINK);

    expect(email.text).toContain(LINK);
    expect(email.subject).toBe('Your sign-in link');
  });

  /**
   * A transactional mail whose whole body is one line and a long opaque URL is
   * the shape of a phishing message, and Gmail files it accordingly. An HTML
   * alternative with the link as an anchor is the part that changes that.
   */
  it('offers an HTML alternative with the link as an anchor', () => {
    const email = signInEmail(LINK);

    expect(email.html).toBeDefined();
    expect(email.html).toMatch(/<a\s[^>]*href="[^"]+"/);
  });

  it('escapes the link in the HTML attribute, so a token cannot break out of it', () => {
    const email = signInEmail(LINK);

    // `&` inside an attribute must be encoded; an unescaped one is a parse
    // hazard and, for a token carrying `&`, a truncated link.
    expect(email.html).toContain('token=abc.def&amp;next=%2F');
    expect(email.html).not.toMatch(/href="[^"]*&(?!amp;|lt;|gt;|quot;|#)/);
  });

  it('says how long the link lasts in both parts', () => {
    const email = signInEmail(LINK);

    expect(email.text).toMatch(/15 minutes/);
    expect(email.html).toMatch(/15 minutes/);
  });

  /** Principle I: a client surface names no internals. */
  it('names nothing internal', () => {
    const email = signInEmail(LINK);
    const body = `${email.subject}\n${email.text}\n${email.html}`;

    expect(body).not.toMatch(/\b(commit|branch|pull request|merge|diff|netlify)\b/i);
  });
});

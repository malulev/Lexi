/**
 * The sign-in email, in both of the parts a mail client may render.
 *
 * It is here rather than inline in the route for the same reason
 * `messages.ts` exists: every word a client reads is a surface worth testing
 * on its own, and a route handler is an awkward place to test one.
 *
 * The HTML alternative is not decoration. A transactional message whose
 * entire body is one sentence and a long opaque URL is the exact shape of a
 * phishing mail, and filters score it as one — a correctly authenticated
 * domain (SPF, DKIM, DMARC all passing) still lands in Spam on content alone.
 * Offering `multipart/alternative`, with the link as an anchor rather than a
 * bare URL, is what moves it. The plain text part stays complete and usable
 * on its own, because a text-only reader must never be handed a worse email.
 */

/** Escapes the five characters that can end an attribute or open a tag. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SignInEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * `link` is the callback URL carrying the magic-link token. It is escaped
 * into both the `href` and the visible text: the token is base64url and hex
 * today, but the query string already contains `&`, which is a parse hazard
 * unescaped and would silently truncate a link a filter rewrote.
 */
export function signInEmail(link: string): SignInEmail {
  const safeLink = escapeHtml(link);

  return {
    subject: 'Your sign-in link',
    text: [
      'Open this link to sign in and edit your website:',
      '',
      link,
      '',
      'The link works for the next 15 minutes. If you did not ask to sign in,',
      'you can ignore this message and nothing will happen.',
    ].join('\n'),
    html: [
      '<!doctype html>',
      '<html><body style="margin:0;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;">',
      '<p style="margin:0 0 20px;">Open this link to sign in and edit your website:</p>',
      `<p style="margin:0 0 20px;"><a href="${safeLink}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;">Sign in to your website</a></p>`,
      '<p style="margin:0 0 20px;color:#555555;">The link works for the next 15 minutes. If you did not ask to sign in, you can ignore this message and nothing will happen.</p>',
      `<p style="margin:0;color:#777777;font-size:13px;">If the button does not work, copy this address into your browser:<br>${safeLink}</p>`,
      '</body></html>',
    ].join('\n'),
  };
}

import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import type { Dictionary } from '@/lib/i18n';
import type { ErrorCode } from '@/types';

/**
 * The sentence to show for a refused request, in the page's language.
 *
 * A route answers `{ error, message }` in English. When the message is the
 * code's own default sentence the dictionary has the same sentence in every
 * language, so that is what the client reads. A message a route narrowed —
 * "this change is already published" — is shown as sent, because it says
 * more than the code and only exists in English.
 */
export function localizeRefusal(
  body: unknown,
  t: Dictionary,
  fallback: string = t.errors.internal_error,
): string {
  if (!body || typeof body !== 'object') return fallback;
  const { error, message } = body as { error?: unknown; message?: unknown };

  if (typeof error === 'string' && isErrorCode(error)) {
    if (typeof message !== 'string' || message === CLIENT_MESSAGES[error]) return t.errors[error];
  }
  return typeof message === 'string' ? message : fallback;
}

function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(CLIENT_MESSAGES, value);
}

import { CLIENT_MESSAGES, PUBLISH_REFUSALS, UNDO_REFUSALS } from '@/lib/jobs/messages';
import type { Dictionary } from '@/lib/i18n';
import type { ErrorCode } from '@/types';

/**
 * The sentence to show for a refused request, in the page's language.
 *
 * A route answers `{ error, message }` in English, because the record and the
 * HTTP contract are the developer's surfaces. The interface is not, so every
 * sentence that came from the closed vocabulary is looked up again here and
 * shown in the reader's language.
 *
 * Two vocabularies feed it. The code's own default sentence
 * (`CLIENT_MESSAGES`) is one. The other is the narrowed refusals a route may
 * substitute — "this change is already published" says more than "there is
 * nothing ready to publish here", which is exactly why `publication.ts` sends
 * it — and those are looked up by their English text, since the body carries
 * no key for them. A sentence from neither table is something no dictionary
 * has and is shown exactly as sent.
 */

/** English refusal text to where it lives in every dictionary. */
type RefusalSource =
  | { table: 'publishRefusals'; key: keyof typeof PUBLISH_REFUSALS }
  | { table: 'undoRefusals'; key: keyof typeof UNDO_REFUSALS };

const NARROWED: ReadonlyMap<string, RefusalSource> = new Map<string, RefusalSource>([
  ...Object.entries(PUBLISH_REFUSALS).map(
    ([key, text]) => [text, { table: 'publishRefusals', key } as RefusalSource] as const,
  ),
  ...Object.entries(UNDO_REFUSALS).map(
    ([key, text]) => [text, { table: 'undoRefusals', key } as RefusalSource] as const,
  ),
]);

export function localizeRefusal(
  body: unknown,
  t: Dictionary,
  fallback: string = t.errors.internal_error,
): string {
  if (!body || typeof body !== 'object') return fallback;
  const { error, message } = body as { error?: unknown; message?: unknown };

  if (typeof message === 'string') {
    const narrowed = NARROWED.get(message);
    // Discriminated rather than indexed by `narrowed.table`: the two tables
    // share three of their four keys but not the fourth, so the union has no
    // common index signature.
    if (narrowed) {
      return narrowed.table === 'publishRefusals'
        ? t.publishRefusals[narrowed.key]
        : t.undoRefusals[narrowed.key];
    }
  }

  if (typeof error === 'string' && isErrorCode(error)) {
    if (typeof message !== 'string' || message === CLIENT_MESSAGES[error]) return t.errors[error];
  }
  return typeof message === 'string' ? message : fallback;
}

function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(CLIENT_MESSAGES, value);
}

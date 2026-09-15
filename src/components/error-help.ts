import type { Dictionary } from '@/lib/i18n';
import type { ErrorCode } from '@/types';

/**
 * Whether there is a second thing to say, and what it is.
 *
 * The short message answers "what happened" in under 120 characters, because
 * that is what a person scanning a conversation can absorb. It leaves the next
 * question — *why did that happen, and what do I do now* — unanswered, and the
 * old answer to that was "ask your developer".
 *
 * This decides when the question mark appears at all. Two cases where it must
 * not: a message that did not go wrong, and help that would only repeat what
 * is already on the screen. The second is not hypothetical in a product with
 * four languages — a translator can collapse the two registers into one
 * sentence without noticing — and a disclosure that reveals nothing is how a
 * reader learns to stop opening them.
 */
export function selectErrorHelp(
  errorCode: ErrorCode | undefined,
  shownText: string,
  t: Dictionary,
): string | null {
  if (!errorCode) return null;

  const help = t.errorHelp[errorCode];
  if (!help || help.trim() === '') return null;
  return help === shownText ? null : help;
}

import { describe, expect, it } from 'vitest';

import { selectErrorHelp } from '@/components/error-help';
import { DICTIONARIES } from '@/lib/i18n';
import { CLIENT_MESSAGES, ERROR_HELP } from '@/lib/jobs/messages';
import type { ErrorCode } from '@/types';

const { en, he } = DICTIONARIES;

/**
 * The short message says what happened. The question mark beside it answers
 * the question a person actually has next — why, and what now — and that
 * answer has to be worth the extra press.
 *
 * So the selector's whole job is deciding when there *is* a second thing to
 * say. A message with no code has no help behind it; a help sentence that
 * merely repeats what is already on screen is worse than no question mark,
 * because a reader who presses it learns nothing and stops pressing.
 */
describe('selectErrorHelp', () => {
  it('offers the longer answer for every code in the vocabulary', () => {
    for (const code of Object.keys(CLIENT_MESSAGES) as ErrorCode[]) {
      expect(selectErrorHelp(code, CLIENT_MESSAGES[code], en), code).toBe(ERROR_HELP[code]);
    }
  });

  it('offers nothing for a message that did not go wrong', () => {
    expect(selectErrorHelp(undefined, 'I made the change you asked for.', en)).toBeNull();
  });

  it('answers in the reader’s language, not the record’s', () => {
    expect(selectErrorHelp('cost_ceiling', he.errors.cost_ceiling, he)).toBe(
      he.errorHelp.cost_ceiling,
    );
  });

  it('stays silent when the help would repeat what is already on screen', () => {
    // Not reachable from the shipped tables — they are audited as distinct —
    // but a translator can make it true in one language, and a question mark
    // that reveals the same sentence teaches a reader to stop pressing it.
    const same = {
      ...en,
      errorHelp: { ...en.errorHelp, build_failed: CLIENT_MESSAGES.build_failed },
    };

    expect(selectErrorHelp('build_failed', CLIENT_MESSAGES.build_failed, same)).toBeNull();
  });
});

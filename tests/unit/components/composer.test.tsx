import { describe, expect, it } from 'vitest';
import { selectComposerAvailability } from '@/components/Composer';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';

/**
 * FR-007a: message entry must be disabled while a request runs, with the
 * reason stated plainly — not merely implied by a greyed-out box. The
 * in-flight reason is never invented at this call site: it is the exact
 * sentence the server's `409 request_in_flight` body carries, so the
 * interface and the server-side enforcement (FR-007b) never disagree about
 * what the client is told.
 */
describe('selectComposerAvailability', () => {
  it('is enabled with no reason when nothing is running and the conversation is open', () => {
    expect(selectComposerAvailability({ requestInFlight: false, conversationStatus: 'open' })).toEqual({
      disabled: false,
      reason: null,
    });
  });

  it('is enabled with no reason for a brand-new conversation (no status yet)', () => {
    expect(selectComposerAvailability({ requestInFlight: false })).toEqual({
      disabled: false,
      reason: null,
    });
  });

  it('disables entry while a request is running, stating the same reason the server gives a 409', () => {
    const result = selectComposerAvailability({ requestInFlight: true, conversationStatus: 'open' });
    expect(result.disabled).toBe(true);
    expect(result.reason).toBe(CLIENT_MESSAGES.request_in_flight);
  });

  it('a request in flight overrides everything else', () => {
    const result = selectComposerAvailability({ requestInFlight: true, conversationStatus: 'closed' });
    expect(result.reason).toBe(CLIENT_MESSAGES.request_in_flight);
  });

  it('disables entry on a published conversation, in plain language', () => {
    const result = selectComposerAvailability({ requestInFlight: false, conversationStatus: 'published' });
    expect(result.disabled).toBe(true);
    expect(result.reason).toMatch(/published/i);
    expect(result.reason).not.toMatch(/\b(merge|merged|git|repo|pull request)\b/i);
  });

  it('disables entry on a closed conversation, in plain language', () => {
    const result = selectComposerAvailability({ requestInFlight: false, conversationStatus: 'closed' });
    expect(result.disabled).toBe(true);
    expect(result.reason).toMatch(/closed/i);
  });

  it('every disabled result states a reason — FR-007a requires the reason to be stated, not implied', () => {
    const cases = [
      { requestInFlight: true, conversationStatus: 'open' as const },
      { requestInFlight: false, conversationStatus: 'published' as const },
      { requestInFlight: false, conversationStatus: 'closed' as const },
    ];
    for (const input of cases) {
      const result = selectComposerAvailability(input);
      expect(result.disabled).toBe(true);
      expect(result.reason, JSON.stringify(input)).toBeTruthy();
    }
  });
});

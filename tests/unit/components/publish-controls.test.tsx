import { describe, expect, it } from 'vitest';

import { selectPublishOffer } from '@/components/PublishControls';
import type { PublishState } from '@/lib/conversations';

/**
 * FR-027 and constitution II, in the one place a client can act on them: the
 * button. Approval is offered only against a standing preview, disappears once
 * the change is live, and is never a single unconsidered click.
 */

const EVERY_STATE: PublishState[] = [
  'not_previewed',
  'ready',
  'published',
  'undone',
  'unavailable',
];

describe('selectPublishOffer', () => {
  it('offers approval only when a preview is standing (FR-027)', () => {
    const offered = EVERY_STATE.filter((state) => selectPublishOffer(state).action === 'publish');

    expect(offered).toEqual(['ready']);
  });

  it('offers the way back only while something is live (FR-029)', () => {
    const offered = EVERY_STATE.filter((state) => selectPublishOffer(state).action === 'undo');

    expect(offered).toEqual(['published']);
  });

  it('asks a second time before either one, so neither is a slip (constitution II)', () => {
    for (const state of ['ready', 'published'] as const) {
      const offer = selectPublishOffer(state);
      if (offer.action === 'none') throw new Error(`${state} should offer something`);
      expect(offer.question.endsWith('?'), state).toBe(true);
      expect(offer.confirmLabel.length, state).toBeGreaterThan(0);
    }
  });

  it('says where a conversation stands when there is nothing to press', () => {
    expect(selectPublishOffer('undone').action).toBe('none');
    expect(selectPublishOffer('not_previewed')).toEqual({ action: 'none', note: null });
  });

  it('never borrows a word from the machinery underneath (Principle I)', () => {
    for (const state of EVERY_STATE) {
      const offer = selectPublishOffer(state);
      const words =
        offer.action === 'none'
          ? (offer.note ?? '')
          : `${offer.label} ${offer.question} ${offer.confirmLabel}`;
      expect(words, state).not.toMatch(/\b(commit|branch|merge|pull request|revert|diff|deploy preview)\b/i);
    }
  });
});

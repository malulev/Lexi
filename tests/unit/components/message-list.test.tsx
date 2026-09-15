import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_STATUS_LABELS,
  describeConversationStatus,
  selectMessageTone,
  messageText,
} from '@/components/MessageList';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import { he } from '@/lib/i18n/he';
import type { ConversationStatus, Message } from '@/types';

/**
 * A conversation *is* a pull request (data-model.md), but the client must
 * never learn that: it sees a titled conversation with a status of "Draft",
 * "Published", or "Closed" — never the pull request's own vocabulary of
 * "open" or "merged". `Record<ConversationStatus, string>` makes the mapping
 * exhaustive, the same guarantee `STAGE_LABELS` gives the stage vocabulary.
 */
describe('the conversation-status vocabulary', () => {
  const entries = Object.entries(CONVERSATION_STATUS_LABELS) as Array<[ConversationStatus, string]>;

  it('covers every status with a label', () => {
    for (const [status, label] of entries) {
      expect(describeConversationStatus(status), status).toBe(label);
    }
  });

  it('never says "open" or "merged"', () => {
    for (const [status, label] of entries) {
      expect(label.toLowerCase(), status).not.toMatch(/\bopen\b|\bmerged\b/);
    }
  });

  it('reads "open" as Draft, "published" as Published, and "closed" as Closed', () => {
    expect(CONVERSATION_STATUS_LABELS.open).toBe('Draft');
    expect(CONVERSATION_STATUS_LABELS.published).toBe('Published');
    expect(CONVERSATION_STATUS_LABELS.closed).toBe('Closed');
  });
});

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    author: 'agent',
    at: '2026-09-02T10:00:00Z',
    text: 'Changed the homepage hero.',
    ...overrides,
  };
}

describe('selectMessageTone', () => {
  it('treats a message with no outcome as neutral (an ordinary chat turn)', () => {
    expect(selectMessageTone(buildMessage({ outcome: undefined }))).toBe('neutral');
  });

  it('treats a succeeded outcome as success', () => {
    expect(selectMessageTone(buildMessage({ outcome: 'succeeded' }))).toBe('success');
  });

  it('treats blocked, failed, and abandoned outcomes as a setback', () => {
    expect(selectMessageTone(buildMessage({ outcome: 'blocked' }))).toBe('setback');
    expect(selectMessageTone(buildMessage({ outcome: 'failed' }))).toBe('setback');
    expect(selectMessageTone(buildMessage({ outcome: 'abandoned' }))).toBe('setback');
  });
});

describe('messageText', () => {
  it('renders the prose the record carries, since it stands alone by contract', () => {
    expect(messageText(buildMessage({ text: 'Made the button dark blue.' }))).toBe(
      'Made the button dark blue.',
    );
  });

  it('falls back to the closed error vocabulary rather than showing nothing', () => {
    // Defensive only: the durable record's prose is meant to always stand
    // alone (contracts/durable-record.md), but a message must never render
    // blank if that ever fails to hold.
    expect(messageText(buildMessage({ text: '', errorCode: 'build_failed' }))).toBe(
      'The change broke the site build. I can try to fix it.',
    );
  });
});

/**
 * The durable record is written in English, once, by the host — it is the
 * developer's artefact and it is read back as such. The client interface is
 * not: a Hebrew reader whose change was refused should read the refusal in
 * Hebrew, not the English sentence that happens to be stored in the record.
 *
 * The rule that reconciles the two: when the stored prose *is* the code's own
 * default sentence, the dictionary has the same sentence in every language and
 * that is what gets shown. Prose the host narrowed past the code says more
 * than the code does and only exists in English, so it is shown as written.
 * This is the same rule `localizeRefusal` applies to a route's answer.
 */
describe('a refused message in a language that is not English', () => {
  function refused(text: string): Message {
    return {
      id: 1,
      author: 'agent',
      at: '2026-09-15T12:00:00.000Z',
      text,
      outcome: 'blocked',
      errorCode: 'blocked_by_policy',
    };
  }

  it('reads in the page language even though the record stored English', () => {
    const shown = messageText(refused(CLIENT_MESSAGES.blocked_by_policy), he);

    expect(shown).toBe(he.errors.blocked_by_policy);
    expect(shown).not.toBe(CLIENT_MESSAGES.blocked_by_policy);
  });

  it('keeps prose the host wrote past the code, which exists only as written', () => {
    const narrowed = 'I changed the heading and the footer for you.';

    expect(messageText(refused(narrowed), he)).toBe(narrowed);
  });

  it('still falls back to the code when a message carries no prose at all', () => {
    expect(messageText(refused(''), he)).toBe(he.errors.blocked_by_policy);
  });

  it('leaves a message with no error code alone', () => {
    const plain: Message = {
      id: 2,
      author: 'client',
      at: '2026-09-15T12:00:00.000Z',
      text: 'Make the heading bigger',
    };

    expect(messageText(plain, he)).toBe('Make the heading bigger');
  });
});

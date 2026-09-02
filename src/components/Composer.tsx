'use client';

import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { ConversationStatus } from '@/types';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';

export interface ComposerAvailability {
  disabled: boolean;
  reason: string | null;
}

/**
 * Whether the client may type a new request right now, and — per FR-007a —
 * the plain-language reason when they may not. A message a client sends
 * anyway while one is running is refused server-side with `409
 * request_in_flight` (FR-007b); the reason shown here is that exact
 * sentence, not a new one invented for the interface, so the two can never
 * drift apart. A conversation that has moved past "Draft" cannot take a
 * follow-up (data-model.md: `published → open` is impossible), so those
 * statuses get their own plain reason instead of a confusing failed send.
 */
export function selectComposerAvailability(input: {
  requestInFlight: boolean;
  conversationStatus?: ConversationStatus;
}): ComposerAvailability {
  if (input.requestInFlight) {
    return { disabled: true, reason: CLIENT_MESSAGES.request_in_flight };
  }
  if (input.conversationStatus === 'published') {
    return {
      disabled: true,
      reason: 'This conversation is already published. Start a new one to make another change.',
    };
  }
  if (input.conversationStatus === 'closed') {
    return {
      disabled: true,
      reason: 'This conversation is closed. Start a new one to make another change.',
    };
  }
  return { disabled: false, reason: null };
}

interface ComposerProps {
  onSend: (text: string) => Promise<void>;
  availability: ComposerAvailability;
  placeholder?: string;
}

/** The one way a client speaks to the product: a text box and a send button. */
export function Composer({ onSend, availability, placeholder }: ComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const disabled = availability.disabled || sending;

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(trimmed);
      setText('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : CLIENT_MESSAGES.internal_error);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void submit();
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {availability.reason ? (
        <p className="composer__reason" role="status">
          {availability.reason}
        </p>
      ) : null}
      {sendError ? (
        <p className="composer__error" role="alert">
          {sendError}
        </p>
      ) : null}
      <div className="composer__row">
        <textarea
          className="composer__input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? 'Describe a change to your website…'}
          disabled={disabled}
          rows={2}
        />
        <button
          type="submit"
          className="composer__send"
          disabled={disabled || text.trim().length === 0}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}

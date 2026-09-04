'use client';

import type { ReactNode } from 'react';

import { useTranslation } from './LocaleProvider';
import { displayModelName } from '@/lib/cost';
import { formatMessage, type Dictionary } from '@/lib/i18n';
import { en } from '@/lib/i18n/en';
import type { ConversationStatus, Message } from '@/types';

/**
 * A conversation is a pull request (data-model.md), but that is an
 * implementation detail the client must never see (constitution Principle
 * I). This is the one place a `ConversationStatus` becomes words, exhaustive
 * by construction — `tests/unit/components/message-list.test.tsx` audits it
 * the way `tests/unit/messages.test.ts` audits the error vocabulary. The
 * English table is the dictionary's; the other languages fill the same shape.
 */
export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = en.status;

export function describeConversationStatus(status: ConversationStatus, t: Dictionary = en): string {
  return t.status[status];
}

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {describeConversationStatus(status, t)}
    </span>
  );
}

export type MessageTone = 'neutral' | 'success' | 'setback';

/** How a finished request's message should read visually — never new copy, just a treatment. */
export function selectMessageTone(message: Message): MessageTone {
  if (!message.outcome) return 'neutral';
  return message.outcome === 'succeeded' ? 'success' : 'setback';
}

/**
 * The prose a message renders. Per contracts/durable-record.md the prose
 * already stands alone — this never invents wording, it only falls back to
 * the closed error vocabulary (src/lib/jobs/messages.ts) on the defensive
 * case where prose is unexpectedly missing, rather than rendering nothing.
 */
export function messageText(message: Message, t: Dictionary = en): string {
  if (message.text) return message.text;
  if (message.errorCode) return t.errors[message.errorCode];
  return '';
}

const URL_PATTERN = /https:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

/**
 * Splits prose into text and the https links it names, so "your change is
 * going live at https://…" is something a client can press. Only https, only
 * whole addresses: anything else stays plain text.
 */
export function splitLinks(text: string): Array<{ kind: 'text' | 'link'; value: string }> {
  const parts: Array<{ kind: 'text' | 'link'; value: string }> = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', value: text.slice(last, start) });
    parts.push({ kind: 'link', value: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts;
}

function renderProse(text: string): ReactNode[] {
  return splitLinks(text).map((part, index) =>
    part.kind === 'link' ? (
      <a key={index} href={part.value} target="_blank" rel="noopener noreferrer">
        {part.value.replace(/^https:\/\//, '')}
      </a>
    ) : (
      <span key={index}>{part.value}</span>
    ),
  );
}

function formatTimestamp(iso: string, tag: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(tag, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface MessageListProps {
  messages: Message[];
  /** Advanced mode: name the model each finished change ran, and what it cost. */
  showModels?: boolean;
}

export function MessageList({ messages, showModels = false }: MessageListProps) {
  const { t, tag, money } = useTranslation();

  if (messages.length === 0) {
    return (
      <div className="message-list__empty">
        <p>{t.messages.nothingYet}</p>
        <p className="message-list__empty-hint">{t.messages.describeFirst}</p>
      </div>
    );
  }

  return (
    <ol className="message-list">
      {messages.map((message) => (
        <li
          key={message.id}
          className={`message message--${message.author} message--${selectMessageTone(message)}`}
        >
          <p className="message__text" dir="auto">
            {renderProse(messageText(message, t))}
          </p>
          {message.previewUrl ? (
            <p className="message__note">
              <span className="message__note-mark" aria-hidden="true">
                ✓
              </span>
              {t.messages.previewReady}
            </p>
          ) : null}
          {showModels && message.model ? (
            <p className="message__meta">
              {formatMessage(t.messages.madeWith, { model: displayModelName(message.model) })}
              {message.costUsd !== undefined ? (
                <>
                  {' · '}
                  {formatMessage(t.messages.costOf, { cost: money(message.costUsd) })}
                </>
              ) : null}
            </p>
          ) : null}
          <time className="message__time" dateTime={message.at} suppressHydrationWarning>
            {formatTimestamp(message.at, tag)}
          </time>
        </li>
      ))}
    </ol>
  );
}

import type { ConversationStatus, Message } from '@/types';
import { clientMessage } from '@/lib/jobs/messages';

/**
 * A conversation is a pull request (data-model.md), but that is an
 * implementation detail the client must never see (constitution Principle
 * I). This is the one place a `ConversationStatus` becomes words, exhaustive
 * by construction — `tests/unit/components/message-list.test.tsx` audits it
 * the way `tests/unit/messages.test.ts` audits the error vocabulary.
 */
export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  open: 'Draft',
  published: 'Published',
  closed: 'Closed',
};

export function describeConversationStatus(status: ConversationStatus): string {
  return CONVERSATION_STATUS_LABELS[status];
}

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
  return (
    <span className={`status-badge status-badge--${status}`}>{describeConversationStatus(status)}</span>
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
export function messageText(message: Message): string {
  if (message.text) return message.text;
  if (message.errorCode) return clientMessage(message.errorCode);
  return '';
}

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return <p className="message-list__empty">No messages yet. Describe the first change below.</p>;
  }

  return (
    <ol className="message-list">
      {messages.map((message) => (
        <li
          key={message.id}
          className={`message message--${message.author} message--${selectMessageTone(message)}`}
        >
          <p className="message__text">{messageText(message)}</p>
          {message.previewUrl ? <p className="message__note">A preview is ready.</p> : null}
          <time className="message__time" dateTime={message.at}>
            {formatTimestamp(message.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

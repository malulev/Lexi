'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Composer, selectComposerAvailability } from './Composer';
import { ConversationStatusBadge, MessageList } from './MessageList';
import { PreviewPane } from './PreviewPane';
import { isTerminalStage, ProgressTrail } from './ProgressTrail';
import { useConversationStream } from './useConversationStream';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import type { Conversation, Message } from '@/types';

/**
 * The conversation, live.
 *
 * The server already handed us the durable history, so this component's job is
 * only to keep it current: the stream adds stages while a request runs, and a
 * finished request refreshes the page so the new durable record replaces the
 * ephemeral view of it. Stages and outcomes come from upstream either way —
 * the stream is the fast path, not the source of truth (constitution V).
 */
export function ConversationView({
  conversation,
  messages,
  requestInFlight,
}: {
  conversation: Conversation;
  messages: Message[];
  requestInFlight: boolean;
}) {
  const router = useRouter();
  const [sendRefused, setSendRefused] = useState<string | null>(null);
  const stream = useConversationStream(conversation.number, requestInFlight ? 'starting' : null);

  const running = requestInFlight && !stream.outcome;
  const lastFailure = lastFailureMessageOf(messages, stream.errorCode);
  const previewUrl = stream.previewUrl ?? conversation.previewUrl;

  // A request that has just ended leaves the page showing an ephemeral trail.
  // Re-reading replaces it with the durable record, which is what a reload or
  // another device would show — so all three agree.
  useEffect(() => {
    if (stream.outcome) router.refresh();
  }, [stream.outcome, router]);

  async function send(text: string): Promise<void> {
    setSendRefused(null);

    const response = await fetch(`/api/conversations/${conversation.number}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    if (response.ok) {
      router.refresh();
      return;
    }

    const body = await response.json().catch(() => null);
    const message =
      body && typeof body.message === 'string' ? body.message : CLIENT_MESSAGES.internal_error;
    setSendRefused(message);
    throw new Error(message);
  }

  return (
    <main className="conv">
      <header className="conv__header">
        <h1 className="conv__title">{conversation.title}</h1>
        <ConversationStatusBadge status={conversation.status} />
      </header>

      <div className="conv__chat">
        <MessageList messages={messages} />

        {running || stream.stageHistory.length > 0 ? (
          <ProgressTrail stageHistory={stream.stageHistory} />
        ) : null}

        {sendRefused ? <p className="conv__status conv__status--setback">{sendRefused}</p> : null}

        <Composer
          onSend={send}
          availability={selectComposerAvailability({
            requestInFlight: running,
            conversationStatus: conversation.status,
          })}
          placeholder="Describe another change"
        />
      </div>

      <PreviewPane
        previewUrl={previewUrl}
        requestInFlight={running}
        {...(lastFailure ? { lastFailureMessage: lastFailure } : {})}
      />
    </main>
  );
}

/**
 * The most recent failure the client has been told about, so the preview pane
 * can explain an empty preview instead of just showing nothing.
 */
function lastFailureMessageOf(
  messages: Message[],
  streamedErrorCode: Message['errorCode'],
): string | undefined {
  if (streamedErrorCode) return CLIENT_MESSAGES[streamedErrorCode];

  const lastOutcome = [...messages].reverse().find((message) => message.outcome);
  if (!lastOutcome || lastOutcome.outcome === 'succeeded') return undefined;
  return lastOutcome.errorCode ? CLIENT_MESSAGES[lastOutcome.errorCode] : undefined;
}

// Re-exported so the page's server component need not import from two places.
export { isTerminalStage };

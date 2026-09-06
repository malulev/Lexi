'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useAdvancedMode } from './advanced-mode';
import { Composer, selectComposerAvailability, type ComposerPayload } from './Composer';
import { useTranslation } from './LocaleProvider';
import { ConversationStatusBadge, MessageList } from './MessageList';
import { PreviewPane } from './PreviewPane';
import { PublishControls } from './PublishControls';
import { isTerminalStage, ProgressTrail, describeStage } from './ProgressTrail';
import { postChange } from './send-change';
import { localizeRefusal } from './server-message';
import { selectInFlight, useConversationStream } from './useConversationStream';
import { WorkingIndicator } from './WorkingIndicator';
import type { PublishState } from '@/lib/conversations';
import type { Dictionary } from '@/lib/i18n';
import { tierOfModel } from '@/lib/models';
import type { Conversation, Message, ModelTier } from '@/types';

/**
 * The conversation, live.
 *
 * The server already handed us the durable history, so this component's job is
 * only to keep it current: the stream adds stages while a request runs, and a
 * finished request refreshes the page so the new durable record replaces the
 * ephemeral view of it. Stages and outcomes come from upstream either way —
 * the stream is the fast path, not the source of truth (constitution V).
 *
 * The preview has the room: it is the thing the client came to look at. The
 * conversation sits beside it, and on a phone the two take turns.
 */
/**
 * Which address the preview pane should actually frame.
 *
 * A conversation's preview is the deploy preview of its own branch, and that
 * branch keeps the change on it forever — undo reverses the change on the live
 * site (the default branch), never on this branch. So once a conversation is
 * undone, framing its branch preview would show the client the very change
 * they just took back, while their real website no longer has it. In that one
 * state the pane frames the live website instead, which is now the reverted
 * truth. Every other state frames the branch preview as before.
 */
export interface EffectivePreview {
  url?: string;
  /** True when the framed page is the live website, not a private preview. */
  live: boolean;
}

export function selectEffectivePreview(input: {
  publishState: PublishState;
  streamPreviewUrl?: string;
  conversationPreviewUrl?: string;
  liveSiteUrl?: string;
}): EffectivePreview {
  if (input.publishState === 'undone') {
    return { ...(input.liveSiteUrl ? { url: input.liveSiteUrl } : {}), live: true };
  }
  const url = input.streamPreviewUrl ?? input.conversationPreviewUrl;
  return { ...(url ? { url } : {}), live: false };
}

export function ConversationView({
  conversation,
  messages,
  requestInFlight,
  publishState,
  defaultModelTier,
  models,
  liveSiteUrl,
}: {
  conversation: Conversation;
  messages: Message[];
  requestInFlight: boolean;
  /** Derived upstream on every read, so a reload cannot offer a stale button. */
  publishState: PublishState;
  /** The tier the installation runs by default, where the picker opens. */
  defaultModelTier?: ModelTier;
  /** The model each tier runs here, for the picker's details view. */
  models?: Record<ModelTier, string>;
  /** The client's own website address, so an undone conversation can show it reverted. */
  liveSiteUrl?: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [advanced] = useAdvancedMode();
  const conversationTier = selectConversationTier(messages, models, defaultModelTier ?? 'medium');
  const [sendRefused, setSendRefused] = useState<string | null>(null);
  const [pane, setPane] = useState<'conversation' | 'preview'>('conversation');
  // Pressed Send, and the stream has not yet announced the request: the page
  // behaves as if it is running from the very first moment (FR-007a).
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const stream = useConversationStream(conversation.number, requestInFlight);
  const thread = useRef<HTMLDivElement>(null);

  const liveRequestId = stream.request?.live ? stream.request.requestId : null;
  useEffect(() => {
    if (liveRequestId) setPendingSince(null);
  }, [liveRequestId]);

  const running = selectInFlight(stream, requestInFlight) || pendingSince !== null;
  const kind = stream.request?.kind ?? 'change';
  const stageHistory =
    stream.stageHistory.length === 0 && pendingSince !== null
      ? (['starting'] as const)
      : stream.stageHistory;
  const latestStage = stageHistory.at(-1);
  const startedAt = stream.startedAt ?? pendingSince;
  const publication = kind !== 'change';
  const lastFailure = lastFailureMessageOf(messages, stream.errorCode, t);
  const preview = selectEffectivePreview({
    publishState,
    ...(stream.previewUrl ? { streamPreviewUrl: stream.previewUrl } : {}),
    ...(conversation.previewUrl ? { conversationPreviewUrl: conversation.previewUrl } : {}),
    ...(liveSiteUrl ? { liveSiteUrl } : {}),
  });
  const previewUrl = preview.url;
  // The newest attempt that produced a preview, durable or live, plus whether
  // the pane is now framing the reverted live site: the frame reloads when any
  // of these changes and not otherwise.
  const previewVersion = `${messages.filter((message) => message.previewUrl).at(-1)?.id ?? 0}:${
    stream.outcome === 'succeeded' ? (stream.request?.requestId ?? '') : ''
  }:${preview.live ? 'live' : ''}`;
  const busyNote = publication ? t.publicationInProgress : t.errors.request_in_flight;

  // A request that has just ended leaves the page showing an ephemeral trail.
  // Re-reading replaces it with the durable record, which is what a reload or
  // another device would show — so all three agree.
  useEffect(() => {
    if (liveRequestId && stream.outcome) router.refresh();
  }, [liveRequestId, stream.outcome, router]);

  // The newest message is the one being read.
  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, stream.stageHistory.length]);

  async function send(payload: ComposerPayload): Promise<void> {
    setSendRefused(null);
    setPendingSince(Date.now());

    const response = await postChange(`/api/conversations/${conversation.number}/messages`, {
      message: payload.text,
      modelTier: payload.modelTier,
      files: payload.files,
    });

    if (response.ok) {
      router.refresh();
      return;
    }

    setPendingSince(null);
    const body = await response.json().catch(() => null);
    const message = localizeRefusal(body, t);
    setSendRefused(message);
    throw new Error(message);
  }

  const updatingLabel =
    running && latestStage && !isTerminalStage(latestStage)
      ? `${describeStage(latestStage, kind, t)}…`
      : undefined;

  return (
    <main className="conv" data-pane={pane}>
      <div className="conv__switch" role="tablist" aria-label={t.conversation.show}>
        {(['conversation', 'preview'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={pane === option}
            className={`conv__switch-btn${pane === option ? ' conv__switch-btn--active' : ''}`}
            onClick={() => setPane(option)}
          >
            {option === 'conversation' ? t.conversation.conversationTab : t.conversation.previewTab}
          </button>
        ))}
      </div>

      <section className="conv__preview">
        <PreviewPane
          {...(previewUrl ? { previewUrl } : {})}
          requestInFlight={running && !publication}
          liveMode={preview.live}
          {...(lastFailure && !preview.live ? { lastFailureMessage: lastFailure } : {})}
          {...(stream.liveUrl && !preview.live ? { liveUrl: stream.liveUrl } : {})}
          {...(updatingLabel ? { updatingLabel } : {})}
          version={previewVersion}
          working={
            running && latestStage && !isTerminalStage(latestStage)
              ? { kind, stage: latestStage, startedAt, lastActivityAt: stream.lastActivityAt }
              : undefined
          }
        />
      </section>

      <section className="conv__side" aria-label={t.conversation.conversationAria}>
        <header className="conv__header">
          <div className="conv__heading">
            <h1 className="conv__title" title={conversation.title} dir="auto">
              {conversation.title}
            </h1>
            <ConversationStatusBadge status={conversation.status} />
          </div>
        </header>

        <div className="conv__thread" ref={thread}>
          <MessageList messages={messages} showModels={advanced} />
          {stageHistory.length > 0 ? (
            <ProgressTrail stageHistory={[...stageHistory]} kind={kind} active={running}>
              {running && latestStage && !isTerminalStage(latestStage) ? (
                <WorkingIndicator
                  kind={kind}
                  stage={latestStage}
                  startedAt={startedAt}
                  lastActivityAt={stream.lastActivityAt}
                />
              ) : null}
            </ProgressTrail>
          ) : null}
        </div>

        <div className="conv__foot">
          {sendRefused ? (
            <p className="conv__status conv__status--setback" role="alert">
              {sendRefused}
            </p>
          ) : null}

          <PublishControls
            conversationNumber={conversation.number}
            title={conversation.title}
            state={publishState}
            requestInFlight={running}
            busyNote={busyNote}
          />

          <Composer
            onSend={send}
            availability={selectComposerAvailability(
              {
                requestInFlight: running,
                conversationStatus: conversation.status,
                busyReason: busyNote,
              },
              t,
            )}
            placeholder={t.composer.followUpPlaceholder}
            defaultModelTier={conversationTier}
            showModelPicker={false}
            {...(models ? { models } : {})}
          />
        </div>
      </section>
    </main>
  );
}

/**
 * The tier a conversation runs at: the one behind the model its latest
 * finished change used, so a follow-up costs what the first request did. A
 * conversation with no record yet, or one whose model maps to no tier, falls
 * back to the installation default.
 */
export function selectConversationTier(
  messages: Message[],
  models: Record<ModelTier, string> | undefined,
  fallback: ModelTier,
): ModelTier {
  if (!models) return fallback;
  const latest = [...messages].reverse().find((message) => message.model);
  return tierOfModel(models, latest?.model) ?? fallback;
}

/**
 * The most recent failure the client has been told about, so the preview pane
 * can explain an empty preview instead of just showing nothing.
 */
function lastFailureMessageOf(
  messages: Message[],
  streamedErrorCode: Message['errorCode'],
  t: Dictionary,
): string | undefined {
  if (streamedErrorCode) return t.errors[streamedErrorCode];

  const lastOutcome = [...messages].reverse().find((message) => message.outcome);
  if (!lastOutcome || lastOutcome.outcome === 'succeeded') return undefined;
  return lastOutcome.errorCode ? t.errors[lastOutcome.errorCode] : undefined;
}

// Re-exported so the page's server component need not import from two places.
export { isTerminalStage };

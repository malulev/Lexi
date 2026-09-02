'use client';

import { useEffect, useState } from 'react';
import type { ErrorCode, Outcome, Stage } from '@/types';

/**
 * The progress stream (contracts/http-api.md), consumed as `EventSource`
 * over `/api/conversations/{number}/stream`.
 *
 * The wire shapes below are the three named SSE events the contract
 * documents — `stage`, `output`, `done` — not the internal `JobEvent` union
 * in src/types/index.ts, which is the in-process event bus the stream route
 * subscribes to (plan.md "Stage transitions are published on an in-process
 * event bus"). That bus shape carries a `type` and `requestId`; the wire
 * format the client actually reads does not need either, since the event
 * name already says which one it is and the URL already scopes it to one
 * conversation. This module is written against the documented wire shape.
 */
interface StageWireEvent {
  stage: Stage;
  at: string;
}

// An `output` event carries a `text` field, which is deliberately never read:
// the contract's own example of it is a file path, and Principle I bans those
// from every client surface. Only the event's arrival is used, as a liveness
// pulse, so there is no wire type for its payload.

interface DoneWireEvent {
  outcome: Outcome;
  previewUrl?: string;
  errorCode?: ErrorCode;
}

export interface ConversationStreamState {
  /** Every stage observed, in order, deduplicated — durable, never best effort. */
  stageHistory: Stage[];
  outcome: Outcome | null;
  previewUrl?: string;
  errorCode?: ErrorCode;
  /** Whether the stream is currently open. Advisory only — see the hook's guard below. */
  connected: boolean;
  /**
   * When the last `output` event arrived, as a liveness pulse only.
   *
   * The contract's own example output line is `"Reading
   * src/components/Hero.tsx"` — a file path. Constitution Principle I bans
   * file paths from the client unconditionally, "not in a loading state",
   * and the constitution wins over a literal reading of a stream payload
   * (governance: the constitution supersedes conflicting artifacts). So the
   * text itself is never kept or shown; only the fact that something just
   * happened is, which is enough to show a calm "still working" pulse.
   */
  lastActivityAt: number | null;
}

export function initialStreamState(initialStage: Stage | null): ConversationStreamState {
  return {
    stageHistory: initialStage ? [initialStage] : [],
    outcome: null,
    previewUrl: undefined,
    errorCode: undefined,
    connected: false,
    lastActivityAt: null,
  };
}

export function applyStageEvent(
  state: ConversationStreamState,
  event: StageWireEvent,
): ConversationStreamState {
  if (state.stageHistory[state.stageHistory.length - 1] === event.stage) return state;
  return { ...state, stageHistory: [...state.stageHistory, event.stage] };
}

export function applyOutputEvent(
  state: ConversationStreamState,
  now: number = Date.now(),
): ConversationStreamState {
  return { ...state, lastActivityAt: now };
}

export function applyDoneEvent(
  state: ConversationStreamState,
  event: DoneWireEvent,
): ConversationStreamState {
  // `Outcome`'s four values are also `Stage` values (src/types/index.ts), so
  // the terminal outcome is simply the trail's last step.
  const terminalStage: Stage = event.outcome;
  const stageHistory =
    state.stageHistory[state.stageHistory.length - 1] === terminalStage
      ? state.stageHistory
      : [...state.stageHistory, terminalStage];
  return {
    ...state,
    stageHistory,
    outcome: event.outcome,
    previewUrl: event.previewUrl ?? state.previewUrl,
    errorCode: event.errorCode,
  };
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Subscribes to one conversation's progress stream.
 *
 * `initialStage` seeds the very first render from the durable
 * `pendingRequest` the initial page load already returned, so the composer
 * can disable itself before the stream connects at all — reconnection
 * "sends the durable records first" per the contract, but that first round
 * trip still takes a moment, and FR-007a asks for the disabled state to be
 * true, not eventually true. It is read only once, at mount: the live
 * stream is expected to confirm or correct it within that first round trip,
 * and re-seeding on every prop change would fight the stream's own state.
 *
 * A stream that never opens is guarded against by simply doing nothing: the
 * caller already has the durable snapshot from the initial fetch, and
 * `connected` stays `false` so the UI can reflect that honestly rather than
 * hanging on a load that will never resolve.
 */
export function useConversationStream(
  conversationNumber: number,
  initialStage: Stage | null,
): ConversationStreamState {
  const [state, setState] = useState<ConversationStreamState>(() => initialStreamState(initialStage));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      return undefined;
    }

    const source = new EventSource(`/api/conversations/${conversationNumber}/stream`);

    const handleOpen = () => setState((current) => ({ ...current, connected: true }));
    // The browser's EventSource retries a dropped connection on its own;
    // this only keeps `connected` honest while that retry is pending.
    const handleError = () => setState((current) => ({ ...current, connected: false }));
    const handleStage = (event: MessageEvent<string>) => {
      const data = safeParse<StageWireEvent>(event.data);
      if (data) setState((current) => applyStageEvent(current, data));
    };
    const handleOutput = () => setState((current) => applyOutputEvent(current));
    const handleDone = (event: MessageEvent<string>) => {
      const data = safeParse<DoneWireEvent>(event.data);
      if (data) setState((current) => applyDoneEvent(current, data));
    };

    source.addEventListener('open', handleOpen);
    source.addEventListener('error', handleError);
    source.addEventListener('stage', handleStage as EventListener);
    source.addEventListener('output', handleOutput as EventListener);
    source.addEventListener('done', handleDone as EventListener);

    return () => {
      source.close();
    };
  }, [conversationNumber]);

  return state;
}

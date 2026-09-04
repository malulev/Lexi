'use client';

import { useEffect, useState } from 'react';
import type { ErrorCode, Outcome, RequestKind, Stage } from '@/types';

/**
 * The progress stream (contracts/http-api.md), consumed as `EventSource`
 * over `/api/conversations/{number}/stream`.
 *
 * The wire shapes below are the named SSE events the contract documents —
 * `request`, `stage`, `output`, `done`, `sync` — not the internal `JobEvent`
 * union in src/types/index.ts, which is the in-process event bus the stream
 * route subscribes to (plan.md "Stage transitions are published on an
 * in-process event bus"). That bus shape carries a `requestId`; the wire
 * format the client actually reads does not need it on every event, since
 * `request` already said which request the events that follow belong to.
 *
 * The stream belongs to the conversation and stays open for its whole life
 * on the page: every request that begins on it — a follow-up sent from this
 * page, a publish, an undo, one another device started — arrives as a new
 * `request` event, and the trail starts over for it. Nothing here ever needs
 * a reload to move.
 */
interface RequestWireEvent {
  requestId: string;
  kind: RequestKind;
  /** `false` while the server replays the durable records; `true` for the one running now. */
  live: boolean;
}

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
  liveUrl?: string;
  errorCode?: ErrorCode;
}

interface SyncWireEvent {
  inFlight: boolean;
}

export interface StreamRequest {
  requestId: string;
  kind: RequestKind;
  live: boolean;
}

export interface ConversationStreamState {
  /** The request the trail currently describes: the newest one seen, replayed or live. */
  request: StreamRequest | null;
  /** Every stage of that request observed, in order, deduplicated — durable, never best effort. */
  stageHistory: Stage[];
  outcome: Outcome | null;
  /** The newest preview seen on any request; a failed follow-up never clears it (FR-024). */
  previewUrl?: string;
  /** The client's own website, once a publish or an undo reached it. */
  liveUrl?: string;
  errorCode?: ErrorCode;
  /**
   * Whether a request is running right now. Before `synced` this is whatever
   * the page was rendered with; after it, the stream is the authority.
   */
  inFlight: boolean;
  /** The server has finished replaying and said what is in flight. */
  synced: boolean;
  /** When the current request began, for the elapsed clock. Null once nothing is running. */
  startedAt: number | null;
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

/**
 * The first render, before the stream has said anything.
 *
 * `inFlight` comes from the durable snapshot the page was rendered with, so
 * the composer can disable itself before the stream connects at all (FR-007a
 * asks for the disabled state to be true, not eventually true). The trail is
 * seeded with `starting` for the same reason: something is happening, and a
 * client should not be left staring at nothing until the first event lands.
 */
export function initialStreamState(
  inFlight: boolean,
  now: number = Date.now(),
): ConversationStreamState {
  return {
    request: null,
    stageHistory: inFlight ? ['starting'] : [],
    outcome: null,
    previewUrl: undefined,
    liveUrl: undefined,
    errorCode: undefined,
    inFlight,
    synced: false,
    startedAt: inFlight ? now : null,
    connected: false,
    lastActivityAt: null,
  };
}

/** A new request: the trail starts over for it, and only it. */
export function applyRequestEvent(
  state: ConversationStreamState,
  event: RequestWireEvent,
  now: number = Date.now(),
): ConversationStreamState {
  return {
    ...state,
    request: { requestId: event.requestId, kind: event.kind, live: event.live },
    stageHistory: [],
    outcome: null,
    errorCode: undefined,
    inFlight: event.live,
    startedAt: event.live ? now : null,
  };
}

/**
 * A stage's own timestamp is the truest start the client can know: a request
 * that was already running when the page opened began before the page did,
 * and its first stage says when.
 */
export function applyStageEvent(
  state: ConversationStreamState,
  event: StageWireEvent,
): ConversationStreamState {
  const at = Date.parse(event.at);
  const startedAt =
    state.inFlight && !Number.isNaN(at) && (state.startedAt === null || at < state.startedAt)
      ? at
      : state.startedAt;
  if (state.stageHistory[state.stageHistory.length - 1] === event.stage) {
    return startedAt === state.startedAt ? state : { ...state, startedAt };
  }
  return { ...state, stageHistory: [...state.stageHistory, event.stage], startedAt };
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
    liveUrl: event.liveUrl ?? state.liveUrl,
    errorCode: event.errorCode,
    inFlight: false,
    startedAt: null,
  };
}

/**
 * The replay is over. From here the stream, not the page's snapshot, says
 * whether something is running — and a `done` that already arrived for the
 * live request outranks the server's summary, since the summary was taken a
 * moment before it.
 */
export function applySyncEvent(
  state: ConversationStreamState,
  event: SyncWireEvent,
): ConversationStreamState {
  return { ...state, synced: true, inFlight: event.inFlight && state.outcome === null };
}

/** Whether a request is running, honouring the page's snapshot until the stream has caught up. */
export function selectInFlight(state: ConversationStreamState, snapshotInFlight: boolean): boolean {
  return state.synced ? state.inFlight : snapshotInFlight || state.inFlight;
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
 * `snapshotInFlight` seeds the very first render from the durable
 * `pendingRequest` the initial page load already returned. It is read only
 * once, at mount: the live stream is expected to confirm or correct it
 * within its first round trip (the `sync` event), and re-seeding on every
 * prop change would fight the stream's own state.
 *
 * A stream that never opens is guarded against by simply doing nothing: the
 * caller already has the durable snapshot from the initial fetch, and
 * `connected` stays `false` so the UI can reflect that honestly rather than
 * hanging on a load that will never resolve.
 */
export function useConversationStream(
  conversationNumber: number,
  snapshotInFlight: boolean,
): ConversationStreamState {
  const [state, setState] = useState<ConversationStreamState>(() =>
    initialStreamState(snapshotInFlight),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      return undefined;
    }

    const source = new EventSource(`/api/conversations/${conversationNumber}/stream`);

    const handleOpen = () => setState((current) => ({ ...current, connected: true }));
    // The browser's EventSource retries a dropped connection on its own;
    // this only keeps `connected` honest while that retry is pending.
    const handleError = () => setState((current) => ({ ...current, connected: false }));
    const on = <T>(apply: (state: ConversationStreamState, data: T) => ConversationStreamState) =>
      ((event: MessageEvent<string>) => {
        const data = safeParse<T>(event.data);
        if (data) setState((current) => apply(current, data));
      }) as EventListener;
    const handleOutput = () => setState((current) => applyOutputEvent(current));

    source.addEventListener('open', handleOpen);
    source.addEventListener('error', handleError);
    source.addEventListener('request', on<RequestWireEvent>(applyRequestEvent));
    source.addEventListener('stage', on<StageWireEvent>(applyStageEvent));
    source.addEventListener('output', handleOutput as EventListener);
    source.addEventListener('done', on<DoneWireEvent>(applyDoneEvent));
    source.addEventListener('sync', on<SyncWireEvent>(applySyncEvent));

    return () => {
      source.close();
    };
  }, [conversationNumber]);

  return state;
}

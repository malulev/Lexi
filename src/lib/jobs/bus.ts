/**
 * The in-process progress stream (research.md R7). One route handler and the
 * orchestrator share a single process, so this is an event bus, not a queue
 * or a transport: publishing is synchronous, subscribers are plain
 * callbacks, and nothing here reaches another process.
 *
 * A browser reconnecting mid-request must not miss stages already passed —
 * that is what `history` is for. Live output is explicitly best effort
 * (JobEvent's doc comment in src/types/index.ts); stages and the final
 * outcome are not, so eviction under `maxHistory` targets `output` events
 * only.
 *
 * Events are keyed by request, but a browser watches a conversation, and a
 * conversation sees many requests over its life — a follow-up, a publish, an
 * undo. `announce` is the conversation-level channel that tells an
 * already-open stream a new request has begun, so it can start following that
 * request's events without the page reloading. `activeRequest` answers the
 * other direction: a stream connecting mid-request asks which one to follow.
 */

import type { JobEvent, RequestAnnouncement } from '@/types';

export interface JobBus {
  publish(event: JobEvent): void;
  subscribe(requestId: string, listener: (event: JobEvent) => void): () => void;
  history(requestId: string): JobEvent[];
  clear(requestId: string): void;
  /** Declares that `requestId` has begun on a conversation. Call before its first stage. */
  announce(announcement: RequestAnnouncement): void;
  subscribeConversation(
    conversationNumber: number,
    listener: (announcement: RequestAnnouncement) => void,
  ): () => void;
  /** The announced request that has not yet published `done`, if any. */
  activeRequest(conversationNumber: number): RequestAnnouncement | null;
}

const DEFAULT_MAX_HISTORY = 500;

function isEvictable(event: JobEvent): boolean {
  return event.type === 'output';
}

/** Appends `event`, then drops the oldest evictable (output) events until back under `maxHistory`. */
function appendBounded(history: JobEvent[], event: JobEvent, maxHistory: number): void {
  history.push(event);
  while (history.length > maxHistory) {
    const oldestEvictable = history.findIndex(isEvictable);
    if (oldestEvictable === -1) return; // only stage/done events remain; never dropped
    history.splice(oldestEvictable, 1);
  }
}

function notifyListener<T extends { requestId: string }>(listener: (event: T) => void, event: T): void {
  try {
    listener(event);
  } catch (error) {
    // A subscriber's own bug (e.g. writing to an already-closed response)
    // must not take down the publisher or starve sibling subscribers.
    console.error('job bus listener threw', { requestId: event.requestId, error });
  }
}

export function createJobBus(deps?: { maxHistory?: number }): JobBus {
  const maxHistory = deps?.maxHistory ?? DEFAULT_MAX_HISTORY;
  const histories = new Map<string, JobEvent[]>();
  const subscribers = new Map<string, Set<(event: JobEvent) => void>>();
  const conversationSubscribers = new Map<number, Set<(a: RequestAnnouncement) => void>>();
  const active = new Map<number, RequestAnnouncement>();

  function forgetActive(requestId: string): void {
    for (const [conversationNumber, announcement] of active) {
      if (announcement.requestId === requestId) active.delete(conversationNumber);
    }
  }

  function publish(event: JobEvent): void {
    const bucket = histories.get(event.requestId) ?? [];
    if (!histories.has(event.requestId)) histories.set(event.requestId, bucket);
    appendBounded(bucket, event, maxHistory);

    if (event.type === 'done') forgetActive(event.requestId);

    for (const listener of subscribers.get(event.requestId) ?? []) {
      notifyListener(listener, event);
    }
  }

  function subscribe(requestId: string, listener: (event: JobEvent) => void): () => void {
    const listeners = subscribers.get(requestId) ?? new Set();
    if (!subscribers.has(requestId)) subscribers.set(requestId, listeners);
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) subscribers.delete(requestId);
    };
  }

  function history(requestId: string): JobEvent[] {
    return [...(histories.get(requestId) ?? [])];
  }

  function clear(requestId: string): void {
    histories.delete(requestId);
    subscribers.delete(requestId);
    forgetActive(requestId);
  }

  function announce(announcement: RequestAnnouncement): void {
    active.set(announcement.conversationNumber, announcement);
    for (const listener of conversationSubscribers.get(announcement.conversationNumber) ?? []) {
      notifyListener(listener, announcement);
    }
  }

  function subscribeConversation(
    conversationNumber: number,
    listener: (announcement: RequestAnnouncement) => void,
  ): () => void {
    const listeners = conversationSubscribers.get(conversationNumber) ?? new Set();
    if (!conversationSubscribers.has(conversationNumber)) {
      conversationSubscribers.set(conversationNumber, listeners);
    }
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) conversationSubscribers.delete(conversationNumber);
    };
  }

  function activeRequest(conversationNumber: number): RequestAnnouncement | null {
    return active.get(conversationNumber) ?? null;
  }

  return { publish, subscribe, history, clear, announce, subscribeConversation, activeRequest };
}

/**
 * The process-wide bus every route handler and the orchestrator share.
 *
 * Held on `globalThis` rather than as a module constant, because a module
 * constant is not process-wide: the framework bundles each route separately
 * and in development evaluates this module once per bundle, so the route that
 * publishes a stage and the route that streams it would each have a bus of
 * their own and the stream would carry nothing. The global is the one object
 * every bundle in the process actually shares.
 */
const BUS_KEY = Symbol.for('webagent.jobBus');
const globalWithBus = globalThis as typeof globalThis & { [BUS_KEY]?: JobBus };

export const jobBus: JobBus = (globalWithBus[BUS_KEY] ??= createJobBus());

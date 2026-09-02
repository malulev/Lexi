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
 */

import type { JobEvent } from '@/types';

export interface JobBus {
  publish(event: JobEvent): void;
  subscribe(requestId: string, listener: (event: JobEvent) => void): () => void;
  history(requestId: string): JobEvent[];
  clear(requestId: string): void;
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

function notifyListener(listener: (event: JobEvent) => void, event: JobEvent): void {
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

  function publish(event: JobEvent): void {
    const bucket = histories.get(event.requestId) ?? [];
    if (!histories.has(event.requestId)) histories.set(event.requestId, bucket);
    appendBounded(bucket, event, maxHistory);

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
  }

  return { publish, subscribe, history, clear };
}

/** The process-wide bus every route handler and the orchestrator share. */
export const jobBus: JobBus = createJobBus();

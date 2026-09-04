import { describe, expect, it } from 'vitest';
import {
  initialStreamState,
  applyRequestEvent,
  applyStageEvent,
  applyOutputEvent,
  applyDoneEvent,
  applySyncEvent,
  selectInFlight,
} from '@/components/useConversationStream';

/**
 * The reducer half of the progress stream (contracts/http-api.md), tested
 * without an `EventSource` or a DOM: stages and outcome are durable and
 * must always win; live output is best effort and — per constitution
 * Principle I — is never rendered verbatim (the contract's own example
 * output line names a file path), so it may only ever move a liveness
 * timestamp, never text, into state.
 */
describe('initialStreamState', () => {
  it('starts empty when nothing is known to be in flight', () => {
    const state = initialStreamState(false);
    expect(state.stageHistory).toEqual([]);
    expect(state.request).toBeNull();
    expect(state.inFlight).toBe(false);
    expect(state.synced).toBe(false);
  });

  it('seeds a first stage when the page was rendered mid-request, so the first render is already honest', () => {
    const state = initialStreamState(true);
    expect(state.stageHistory).toEqual(['starting']);
    expect(state.inFlight).toBe(true);
  });
});

describe('applyRequestEvent', () => {
  it('starts the trail over for the new request and remembers what it is for', () => {
    let state = initialStreamState(false);
    state = applyStageEvent(state, { stage: 'running', at: 't' });
    state = applyDoneEvent(state, { outcome: 'succeeded', previewUrl: 'https://p.example' });

    state = applyRequestEvent(state, { requestId: 'publish_1', kind: 'publish', live: true });

    expect(state.request).toEqual({ requestId: 'publish_1', kind: 'publish', live: true });
    expect(state.stageHistory).toEqual([]);
    expect(state.outcome).toBeNull();
    expect(state.inFlight).toBe(true);
    // The preview survives: a later request never erases what was previewed (FR-024).
    expect(state.previewUrl).toBe('https://p.example');
  });

  it('does not count a replayed request as running', () => {
    const state = applyRequestEvent(initialStreamState(false), { requestId: 'r1', kind: 'change', live: false });
    expect(state.inFlight).toBe(false);
  });
});

describe('applyStageEvent', () => {
  it('appends a new stage', () => {
    const state = applyStageEvent(initialStreamState(false), { stage: 'starting', at: 't' });
    expect(state.stageHistory).toEqual(['starting']);
  });

  it('does not duplicate a repeated stage (a reconnect may replay it)', () => {
    const once = applyStageEvent(initialStreamState(false), { stage: 'starting', at: 't1' });
    const twice = applyStageEvent(once, { stage: 'starting', at: 't2' });
    expect(twice.stageHistory).toEqual(['starting']);
  });

  it('builds up the full history in order', () => {
    let state = initialStreamState(false);
    for (const stage of ['starting', 'running', 'gating'] as const) {
      state = applyStageEvent(state, { stage, at: 't' });
    }
    expect(state.stageHistory).toEqual(['starting', 'running', 'gating']);
  });
});

describe('applyOutputEvent', () => {
  it('records that activity happened, never the text itself', () => {
    const state = applyOutputEvent(initialStreamState(false), 12345);
    expect(state.lastActivityAt).toBe(12345);
    // No field anywhere in the state can hold arbitrary agent text — the
    // type itself has no such field, which is the guarantee this asserts.
    expect(Object.keys(state)).not.toContain('text');
    expect(Object.keys(state)).not.toContain('lastOutput');
  });
});

describe('applyDoneEvent', () => {
  it('folds the outcome into the stage history, since they share the same terminal vocabulary', () => {
    const running = applyStageEvent(initialStreamState(true), { stage: 'running', at: 't' });
    const done = applyDoneEvent(running, { outcome: 'succeeded', previewUrl: 'https://p.example' });
    expect(done.stageHistory).toEqual(['starting', 'running', 'succeeded']);
    expect(done.outcome).toBe('succeeded');
    expect(done.previewUrl).toBe('https://p.example');
    expect(done.inFlight).toBe(false);
  });

  it('keeps the previous preview URL when a failed follow-up carries none (FR-024)', () => {
    let state = initialStreamState(false);
    state = applyDoneEvent(state, { outcome: 'succeeded', previewUrl: 'https://p.example' });
    state = applyRequestEvent(state, { requestId: 'r2', kind: 'change', live: true });
    state = applyStageEvent(state, { stage: 'running', at: 't' });
    state = applyDoneEvent(state, { outcome: 'failed', errorCode: 'build_failed' });
    expect(state.previewUrl).toBe('https://p.example');
    expect(state.errorCode).toBe('build_failed');
  });

  it('remembers where the live site is once a publish reaches it', () => {
    const state = applyDoneEvent(initialStreamState(false), { outcome: 'succeeded', liveUrl: 'https://client.example' });
    expect(state.liveUrl).toBe('https://client.example');
  });
});

describe('the elapsed clock', () => {
  it('starts when a live request begins and stops when it ends', () => {
    let state = applyRequestEvent(initialStreamState(false), { requestId: 'r1', kind: 'change', live: true }, 1_000);
    expect(state.startedAt).toBe(1_000);
    state = applyDoneEvent(state, { outcome: 'succeeded' });
    expect(state.startedAt).toBeNull();
  });

  it('reaches back to the first stage of a request that was already running when the page opened', () => {
    let state = applyRequestEvent(initialStreamState(false), { requestId: 'r1', kind: 'change', live: true }, 60_000);
    state = applyStageEvent(state, { stage: 'starting', at: new Date(10_000).toISOString() });
    expect(state.startedAt).toBe(10_000);
  });

  it('does not start a clock for a replayed record', () => {
    let state = applyRequestEvent(initialStreamState(false), { requestId: 'r0', kind: 'change', live: false });
    state = applyStageEvent(state, { stage: 'starting', at: new Date(10_000).toISOString() });
    expect(state.startedAt).toBeNull();
  });
});

describe('sync, and who is trusted about "in flight"', () => {
  it('trusts the page snapshot until the stream has caught up', () => {
    expect(selectInFlight(initialStreamState(true), true)).toBe(true);
    expect(selectInFlight(initialStreamState(false), false)).toBe(false);
  });

  it('trusts the stream once it has synced, even against a stale snapshot', () => {
    const synced = applySyncEvent(initialStreamState(true), { inFlight: false });
    expect(synced.synced).toBe(true);
    expect(selectInFlight(synced, true)).toBe(false);
  });

  it('lets a done that already arrived outrank the server summary', () => {
    let state = applyRequestEvent(initialStreamState(false), { requestId: 'r1', kind: 'change', live: true });
    state = applyDoneEvent(state, { outcome: 'succeeded' });
    state = applySyncEvent(state, { inFlight: true });
    expect(state.inFlight).toBe(false);
  });

  it('reports a follow-up that began after the sync as running', () => {
    let state = applySyncEvent(initialStreamState(false), { inFlight: false });
    state = applyRequestEvent(state, { requestId: 'r2', kind: 'change', live: true });
    expect(selectInFlight(state, false)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  initialStreamState,
  applyStageEvent,
  applyOutputEvent,
  applyDoneEvent,
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
    expect(initialStreamState(null)).toEqual({
      stageHistory: [],
      outcome: null,
      previewUrl: undefined,
      errorCode: undefined,
      connected: false,
      lastActivityAt: null,
    });
  });

  it('seeds history with a durable pending stage, so the first render is already correct', () => {
    expect(initialStreamState('running').stageHistory).toEqual(['running']);
  });
});

describe('applyStageEvent', () => {
  it('appends a new stage', () => {
    const state = applyStageEvent(initialStreamState(null), { stage: 'starting', at: 't' });
    expect(state.stageHistory).toEqual(['starting']);
  });

  it('does not duplicate a repeated stage (a reconnect may replay it)', () => {
    const once = applyStageEvent(initialStreamState(null), { stage: 'starting', at: 't1' });
    const twice = applyStageEvent(once, { stage: 'starting', at: 't2' });
    expect(twice.stageHistory).toEqual(['starting']);
  });

  it('builds up the full history in order', () => {
    let state = initialStreamState(null);
    for (const stage of ['starting', 'running', 'gating'] as const) {
      state = applyStageEvent(state, { stage, at: 't' });
    }
    expect(state.stageHistory).toEqual(['starting', 'running', 'gating']);
  });
});

describe('applyOutputEvent', () => {
  it('records that activity happened, never the text itself', () => {
    const state = applyOutputEvent(initialStreamState(null), 12345);
    expect(state.lastActivityAt).toBe(12345);
    // No field anywhere in the state can hold arbitrary agent text — the
    // type itself has no such field, which is the guarantee this asserts.
    expect(Object.keys(state)).not.toContain('text');
    expect(Object.keys(state)).not.toContain('lastOutput');
  });
});

describe('applyDoneEvent', () => {
  it('folds the outcome into the stage history, since they share the same terminal vocabulary', () => {
    const running = applyStageEvent(initialStreamState(null), { stage: 'running', at: 't' });
    const done = applyDoneEvent(running, { outcome: 'succeeded', previewUrl: 'https://p.example' });
    expect(done.stageHistory).toEqual(['running', 'succeeded']);
    expect(done.outcome).toBe('succeeded');
    expect(done.previewUrl).toBe('https://p.example');
  });

  it('keeps the previous preview URL when a failed follow-up carries none (FR-024)', () => {
    let state = initialStreamState(null);
    state = applyDoneEvent(state, { outcome: 'succeeded', previewUrl: 'https://p.example' });
    state = applyStageEvent(state, { stage: 'running', at: 't' });
    state = applyDoneEvent(state, { outcome: 'failed', errorCode: 'build_failed' });
    expect(state.previewUrl).toBe('https://p.example');
    expect(state.errorCode).toBe('build_failed');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createStageMachine, isLegalTransition, TERMINAL_STAGES } from '@/lib/jobs/state';
import { createJobBus } from '@/lib/jobs/bus';
import type { JobEvent, Stage } from '@/types';

/**
 * data-model.md's Request entity is the authority for the stage list:
 * `starting -> running -> gating -> pushing -> building -> succeeded`, with
 * `blocked` only from `gating` and `failed` from any non-terminal stage.
 * `abandoned` is written by the process that breaks a stale lock for a
 * request it has no other visibility into, so it is reachable only from the
 * always-present initial stage, `starting` — never from a stage that implies
 * the machine has live knowledge of how far the request actually got.
 */

describe('isLegalTransition', () => {
  const legal: Array<[Stage, Stage]> = [
    ['starting', 'running'],
    ['starting', 'queued'],
    ['queued', 'running'],
    ['queued', 'failed'],
    ['running', 'gating'],
    ['gating', 'pushing'],
    ['gating', 'blocked'],
    ['pushing', 'building'],
    ['building', 'succeeded'],
    ['starting', 'failed'],
    ['running', 'failed'],
    ['gating', 'failed'],
    ['pushing', 'failed'],
    ['building', 'failed'],
    ['starting', 'abandoned'],
  ];

  const illegal: Array<[Stage, Stage]> = [
    ['starting', 'gating'],
    ['starting', 'pushing'],
    ['starting', 'building'],
    ['starting', 'succeeded'],
    ['queued', 'gating'],
    ['queued', 'abandoned'],
    ['running', 'blocked'],
    ['running', 'abandoned'],
    ['running', 'pushing'],
    ['running', 'queued'],
    ['gating', 'succeeded'],
    ['gating', 'abandoned'],
    ['gating', 'gating'],
    ['pushing', 'gating'],
    ['pushing', 'abandoned'],
    ['building', 'gating'],
    ['building', 'abandoned'],
    ['succeeded', 'running'],
    ['succeeded', 'failed'],
    ['blocked', 'running'],
    ['blocked', 'failed'],
    ['failed', 'running'],
    ['failed', 'failed'],
    ['abandoned', 'running'],
    ['abandoned', 'abandoned'],
  ];

  it.each(legal)('allows %s -> %s', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(true);
  });

  it.each(illegal)('rejects %s -> %s', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(false);
  });
});

describe('createStageMachine', () => {
  it('starts in the starting stage with no recorded stage events', () => {
    const machine = createStageMachine('r1', { onTerminal: vi.fn() });

    expect(machine.stage).toBe('starting');
    expect(machine.stages).toEqual([]);
    expect(machine.isTerminal()).toBe(false);
  });

  it('advances along the legal path, recording each step and publishing it on the bus', () => {
    const bus = createJobBus();
    const received: JobEvent[] = [];
    bus.subscribe('r1', (event) => received.push(event));
    const onTerminal = vi.fn();
    const machine = createStageMachine('r1', { bus, onTerminal });

    machine.advance('running');
    machine.advance('gating');
    machine.advance('pushing');
    machine.advance('building');
    machine.advance('succeeded');

    expect(machine.stage).toBe('succeeded');
    expect(machine.stages.map((event) => event.stage)).toEqual([
      'running',
      'gating',
      'pushing',
      'building',
      'succeeded',
    ]);
    expect(
      received.map((event) => (event.type === 'stage' ? event.stage : `unexpected:${event.type}`)),
    ).toEqual(['running', 'gating', 'pushing', 'building', 'succeeded']);
  });

  it('stamps each stage event using the injected clock', () => {
    let tick = 0;
    const now = () => new Date(1_700_000_000_000 + 1000 * tick++);
    const machine = createStageMachine('r1', { now, onTerminal: vi.fn() });

    machine.advance('running');

    expect(machine.stages[0]?.at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('throws on an illegal transition and leaves stage and history unchanged', () => {
    const onTerminal = vi.fn();
    const machine = createStageMachine('r1', { onTerminal });

    expect(() => machine.advance('succeeded')).toThrow();

    expect(machine.stage).toBe('starting');
    expect(machine.stages).toEqual([]);
    expect(onTerminal).not.toHaveBeenCalled();
  });

  it('refuses to advance out of a terminal stage, once reached', () => {
    const onTerminal = vi.fn();
    const machine = createStageMachine('r1', { onTerminal });
    machine.advance('running');
    machine.advance('gating');
    machine.advance('blocked');

    expect(() => machine.advance('failed')).toThrow();

    expect(machine.stage).toBe('blocked');
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it('returns a snapshot of stages that later advances do not retroactively mutate', () => {
    const machine = createStageMachine('r1', { onTerminal: vi.fn() });
    machine.advance('running');
    const snapshot = machine.stages;

    machine.advance('gating');

    expect(snapshot).toHaveLength(1);
    expect(machine.stages).toHaveLength(2);
  });

  describe('the completion callback (structural guarantee for "every terminal stage releases the lock and writes a record")', () => {
    // The state machine must not perform I/O itself — releasing the lock and
    // writing the durable record belong to the orchestrator (a later phase).
    // So instead of testing I/O here, we test the structural guarantee that
    // makes it impossible to skip: `onTerminal` is a REQUIRED constructor
    // argument (not optional, unlike `bus`/`now`), and `advance` is the only
    // way `stage` ever changes. Every path into a terminal stage runs through
    // `advance`, which invokes `onTerminal` synchronously before returning,
    // and `isLegalTransition` refuses anything further out of a terminal
    // stage — so the callback cannot be skipped, and cannot fire twice for
    // the same machine.

    it.each(TERMINAL_STAGES)('fires exactly once on reaching %s', (terminal) => {
      const onTerminal = vi.fn();
      const machine = createStageMachine('r1', { onTerminal });

      switch (terminal) {
        case 'succeeded':
          machine.advance('running');
          machine.advance('gating');
          machine.advance('pushing');
          machine.advance('building');
          machine.advance('succeeded');
          break;
        case 'blocked':
          machine.advance('running');
          machine.advance('gating');
          machine.advance('blocked');
          break;
        case 'failed':
          machine.advance('running');
          machine.advance('failed');
          break;
        case 'abandoned':
          machine.advance('abandoned');
          break;
        default:
          throw new Error(`unhandled terminal stage in test: ${terminal}`);
      }

      expect(machine.isTerminal()).toBe(true);
      expect(onTerminal).toHaveBeenCalledTimes(1);
      expect(onTerminal).toHaveBeenCalledWith(terminal);
    });

    it('never fires for a machine that never reaches a terminal stage', () => {
      const onTerminal = vi.fn();
      const machine = createStageMachine('r1', { onTerminal });

      machine.advance('running');
      machine.advance('gating');

      expect(onTerminal).not.toHaveBeenCalled();
      expect(machine.isTerminal()).toBe(false);
    });
  });
});

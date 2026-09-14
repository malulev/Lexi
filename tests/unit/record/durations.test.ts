import { describe, expect, it } from 'vitest';

import { stageDurations } from '@/lib/record/durations';
import type { RequestRecord } from '@/types';

/**
 * Hand-computed numbers throughout. A duration test that asserts against
 * another derivation of the same arithmetic proves only that the two agree.
 */

function record(over: Partial<RequestRecord>): RequestRecord {
  return {
    requestId: 'req-1',
    startedAt: '2026-09-13T12:00:00.000Z',
    finishedAt: '2026-09-13T12:05:00.000Z',
    outcome: 'succeeded',
    stages: [],
    ...over,
  } as RequestRecord;
}

describe('stageDurations', () => {
  it('measures the whole request from startedAt to finishedAt', () => {
    const result = stageDurations(record({}));

    // 12:00:00 → 12:05:00 is five minutes.
    expect(result.durationMs).toBe(300_000);
  });

  it('splits the time across the stages that were entered', () => {
    const result = stageDurations(
      record({
        startedAt: '2026-09-13T12:00:00.000Z',
        finishedAt: '2026-09-13T12:05:00.000Z',
        stages: [
          { stage: 'running', at: '2026-09-13T12:00:30.000Z' },
          { stage: 'gating', at: '2026-09-13T12:03:30.000Z' },
          { stage: 'pushing', at: '2026-09-13T12:03:40.000Z' },
          { stage: 'building', at: '2026-09-13T12:03:50.000Z' },
        ],
      }),
    );

    // The 30s before the first stage is clone + checkout, named by no stage.
    expect(result.preparingMs).toBe(30_000);
    expect(result.runningMs).toBe(180_000); // 12:00:30 → 12:03:30
    expect(result.gatingMs).toBe(10_000); // 12:03:30 → 12:03:40
    expect(result.pushingMs).toBe(10_000); // 12:03:40 → 12:03:50
    // The last stage runs to finishedAt, not to a stage that never came.
    expect(result.buildingMs).toBe(70_000); // 12:03:50 → 12:05:00
    expect(result.durationMs).toBe(300_000);
  });

  it('counts a queued request separately from a running one', () => {
    const result = stageDurations(
      record({
        startedAt: '2026-09-13T12:00:00.000Z',
        finishedAt: '2026-09-13T12:10:00.000Z',
        stages: [
          { stage: 'queued', at: '2026-09-13T12:00:00.000Z' },
          { stage: 'running', at: '2026-09-13T12:08:00.000Z' },
        ],
      }),
    );

    // Eight minutes waiting for a slot is the number that says the host is
    // undersized, and it must not be hidden inside runningMs.
    expect(result.queuedMs).toBe(480_000);
    expect(result.runningMs).toBe(120_000);
    expect(result.preparingMs).toBe(0);
  });

  it('still produces a total for an abandoned record, which has no stages', () => {
    const result = stageDurations(
      record({ outcome: 'abandoned', stages: [], finishedAt: '2026-09-13T12:00:07.000Z' }),
    );

    expect(result.durationMs).toBe(7_000);
    expect(result.preparingMs).toBeUndefined();
    expect(result.runningMs).toBeUndefined();
  });

  it('produces zero rather than nonsense for a publish record whose clocks are equal', () => {
    const result = stageDurations(
      record({
        startedAt: '2026-09-13T12:00:00.000Z',
        finishedAt: '2026-09-13T12:00:00.000Z',
        stages: [{ stage: 'succeeded', at: '2026-09-13T12:00:00.000Z' }],
      }),
    );

    expect(result.durationMs).toBe(0);
    expect(result.preparingMs).toBe(0);
  });

  it('never reports a negative duration when timestamps disagree', () => {
    const result = stageDurations(
      record({
        startedAt: '2026-09-13T12:05:00.000Z',
        finishedAt: '2026-09-13T12:00:00.000Z',
      }),
    );

    expect(result.durationMs).toBe(0);
  });
});

import type { RequestRecord, Stage } from '@/types';

/**
 * How long a request spent, and where.
 *
 * Every input already exists in the record written to the pull request —
 * `startedAt`, `finishedAt`, and a timestamp per stage entered. Nothing has
 * ever derived a duration from them, so "why was that slow" has until now
 * meant reading timestamps by eye.
 *
 * Two things the arithmetic has to respect:
 *
 *  - `stages[]` holds *entry* times. A stage lasts until the next one begins,
 *    and the last one lasts until `finishedAt`.
 *  - `createStageMachine` starts at `starting` implicitly and only appends on
 *    `advance()`, so `stages[0]` is `queued` or `running` — never `starting`.
 *    The gap between `startedAt` and the first recorded stage is therefore
 *    real work (mirror clone, checkout, attachments) that no stage names.
 *    `preparingMs` is that gap, and it is a prime suspect when latency creeps.
 *
 * Total by construction. An abandoned record carries no stages at all, and a
 * publish record carries one synthetic stage with `startedAt === finishedAt`;
 * both must produce a number for the total and simply omit the rest.
 */

export interface StageDurations {
  /** `finishedAt − startedAt`: what the client actually waited. */
  durationMs: number;
  /** Before the first recorded stage: clone, checkout, attachments. */
  preparingMs?: number;
  queuedMs?: number;
  runningMs?: number;
  gatingMs?: number;
  pushingMs?: number;
  buildingMs?: number;
}

const FIELD_BY_STAGE: Partial<Record<Stage, keyof StageDurations>> = {
  queued: 'queuedMs',
  running: 'runningMs',
  gating: 'gatingMs',
  pushing: 'pushingMs',
  building: 'buildingMs',
};

function msBetween(from: string, to: string): number | undefined {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  // Never negative: clocks and rounding are not this module's problem to
  // report, and a negative duration would poison every average built on it.
  return Math.max(0, end - start);
}

export function stageDurations(record: RequestRecord): StageDurations {
  const total = msBetween(record.startedAt, record.finishedAt) ?? 0;
  const durations: StageDurations = { durationMs: total };

  const stages = record.stages ?? [];
  if (stages.length === 0) return durations;

  const first = stages[0];
  if (first) {
    const preparing = msBetween(record.startedAt, first.at);
    if (preparing !== undefined) durations.preparingMs = preparing;
  }

  stages.forEach((entry, index) => {
    const field = FIELD_BY_STAGE[entry.stage];
    if (!field || field === 'durationMs') return;
    // The stage ends when the next begins, or — for the last one — when the
    // request does.
    const endsAt = stages[index + 1]?.at ?? record.finishedAt;
    const elapsed = msBetween(entry.at, endsAt);
    if (elapsed === undefined) return;
    // A stage entered twice (it cannot be, today) would sum rather than
    // silently keep the last.
    durations[field] = (durations[field] ?? 0) + elapsed;
  });

  return durations;
}

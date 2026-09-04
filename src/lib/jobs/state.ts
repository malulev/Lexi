/**
 * The request stage machine (data-model.md's Request entity). Legal path:
 * `starting -> (queued ->) running -> gating -> pushing -> building -> succeeded`, with
 * `blocked` reachable only from `gating`, and `failed` reachable from any
 * non-terminal stage. Nothing advances out of a terminal stage.
 *
 * `abandoned` is written by the process that breaks a stale lock (FR-007c),
 * for a request whose original process has crashed — that breaking process
 * has no live stage history for the dead request, only its id. It therefore
 * represents the abandonment as a fresh machine, still at `starting`,
 * advancing directly to `abandoned`. Any stage that implies live knowledge
 * of how far a request actually got (running, gating, pushing, building)
 * cannot transition to `abandoned` for exactly that reason: a machine with
 * that knowledge is, by definition, still connected to a live process, and
 * a live process reports `failed`, not `abandoned`.
 */

import type { JobBus } from './bus';
import type { Stage, StageEvent } from '@/types';

export const TERMINAL_STAGES: readonly Stage[] = ['succeeded', 'blocked', 'failed', 'abandoned'];

const LEGAL_NEXT: Record<Stage, readonly Stage[]> = {
  starting: ['queued', 'running', 'abandoned'],
  queued: ['running'],
  running: ['gating'],
  gating: ['pushing', 'blocked'],
  pushing: ['building'],
  building: ['succeeded'],
  succeeded: [],
  blocked: [],
  failed: [],
  abandoned: [],
};

export function isLegalTransition(from: Stage, to: Stage): boolean {
  if (TERMINAL_STAGES.includes(from)) return false; // nothing advances out of a terminal stage
  if (to === 'failed') return true; // failure can interrupt any non-terminal stage
  return LEGAL_NEXT[from].includes(to);
}

export interface StageMachine {
  readonly stage: Stage;
  readonly stages: StageEvent[];
  advance(to: Stage): void;
  isTerminal(): boolean;
}

export interface StageMachineDeps {
  bus?: JobBus;
  now?: () => Date;
  /**
   * Fired exactly once, when (and only when) the machine reaches a terminal
   * stage. The task requirement is "every terminal stage releases the lock
   * and writes a record" — an I/O guarantee this module cannot enforce
   * directly, because the state machine must not perform I/O itself (that is
   * the orchestrator's job, `src/lib/jobs/run.ts`, a later phase). Making
   * this callback REQUIRED turns an I/O promise into a structural one: a
   * caller cannot construct a machine without supplying a handler, and
   * `advance` — the only way `stage` ever changes — invokes it synchronously
   * before returning whenever `to` is terminal. Because `isLegalTransition`
   * refuses any further transition once `stage` is terminal, this callback
   * can fire at most once per machine, and reaching a terminal stage without
   * it firing is impossible by construction, not merely by convention.
   */
  onTerminal: (stage: Stage) => void;
}

export function createStageMachine(requestId: string, deps: StageMachineDeps): StageMachine {
  const now = deps.now ?? (() => new Date());
  let current: Stage = 'starting';
  const history: StageEvent[] = [];

  function advance(to: Stage): void {
    if (!isLegalTransition(current, to)) {
      throw new Error(`illegal stage transition for request ${requestId}: ${current} -> ${to}`);
    }

    const event: StageEvent = { stage: to, at: now().toISOString() };
    current = to;
    history.push(event);
    deps.bus?.publish({ type: 'stage', requestId, stage: to, at: event.at });

    if (TERMINAL_STAGES.includes(to)) {
      deps.onTerminal(to);
    }
  }

  return {
    get stage() {
      return current;
    },
    get stages() {
      return [...history];
    },
    advance,
    isTerminal: () => TERMINAL_STAGES.includes(current),
  };
}

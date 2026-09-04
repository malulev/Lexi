/**
 * Facade for `runner/`: the `JobRunner` contract plus its two
 * implementations, so a caller writes one import regardless of which it
 * needs.
 *
 * `JobRunner` itself is declared in `./types.ts`, owned by the architect —
 * re-exported here rather than redeclared. That file names the interface
 * `run(request)` / `cancel(requestId)`; task tracking describes the same
 * contract as `start`/`logs`/`cancel`/timeout, which is `run` (one awaited
 * call standing in for start-then-await-completion), `onOutput` on
 * `RunRequest` (logs), `cancel`, and `RunRequest.timeoutMs` respectively —
 * one contract, two vocabularies.
 */

export type { JobRunner, RunOutcome, RunRequest, RunResult } from './types';
export { createFakeRunner, type FakeRunnerScript } from './fake';
export { createDockerRunner, type CreateDockerRunnerOptions } from './docker';
export { assertControlDirOutsideWorkDir, readAgentResult, writeControlDir } from './control';
export {
  AGENT_LABEL,
  countRunningAgents,
  createDockerSlots,
  UNLIMITED_SLOTS,
  type AgentSlots,
  type CreateDockerSlotsOptions,
  type SlotOutcome,
} from './slots';

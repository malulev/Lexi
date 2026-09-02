import type { AgentPrompt, AgentResult } from '@/types';

/**
 * How the host runs one agent job.
 *
 * Docker is the only implementation. The interface exists so the orchestrator
 * is testable without Docker — not to anticipate other backends.
 */

export type RunOutcome = 'completed' | 'timeout' | 'error';

export interface RunRequest {
  requestId: string;
  /** Host path mounted at `/work`. The working tree, with no git remote. */
  workDir: string;
  /** Host path mounted at `/control`. Never inside `workDir` (FR-015). */
  controlDir: string;
  prompt: AgentPrompt;
  model: string;
  timeoutMs: number;
  /** Called for each line of container stdout. Best effort; may be dropped. */
  onOutput?: (line: string) => void;
}

export interface RunResult {
  outcome: RunOutcome;
  exitCode: number | null;
  /** Parsed `/control/result.json`, absent when the agent wrote none. */
  result?: AgentResult;
  errorDetail?: string;
}

export interface JobRunner {
  run(request: RunRequest): Promise<RunResult>;
  /** Destroys the container for a request, whatever state it is in. */
  cancel(requestId: string): Promise<void>;
}

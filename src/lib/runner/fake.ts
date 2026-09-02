import type { AgentResult } from '@/types';
import type { JobRunner, RunOutcome, RunRequest, RunResult } from './types';

/**
 * A `JobRunner` with no container underneath it.
 *
 * This is what the orchestrator and route integration tests run against —
 * a deliverable, not a stub. It honours `RunRequest.timeoutMs` and
 * `onOutput` for real, and `edit` lets a test mutate the working tree the
 * way a real agent would, so assertions about the gate, the commit, and the
 * push are exercised against an actual filesystem change rather than a
 * fabricated result object.
 */

export interface FakeRunnerScript {
  outcome?: RunOutcome;
  output?: string[];
  result?: AgentResult;
  /** Mutates the working tree the way a real agent would, so orchestrator tests are real. */
  edit?: (workDir: string) => Promise<void>;
  delayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the script to completion, or reports a timeout if the scripted delay
 * would outlast the request's own `timeoutMs` — mirroring what the docker
 * runner does when the container outruns its budget, without needing a
 * container to prove it.
 */
async function runScript(request: RunRequest, script: FakeRunnerScript): Promise<RunResult> {
  for (const line of script.output ?? []) {
    request.onOutput?.(line);
  }

  const delayMs = script.delayMs ?? 0;
  if (delayMs > request.timeoutMs) {
    await delay(request.timeoutMs);
    return { outcome: 'timeout', exitCode: null };
  }
  if (delayMs > 0) {
    await delay(delayMs);
  }

  if (script.edit) {
    await script.edit(request.workDir);
  }

  const outcome = script.outcome ?? 'completed';
  return {
    outcome,
    exitCode: outcome === 'completed' ? 0 : null,
    result: outcome === 'completed' ? script.result : undefined,
  };
}

export function createFakeRunner(script: FakeRunnerScript = {}): JobRunner & { readonly calls: RunRequest[] } {
  const calls: RunRequest[] = [];
  // One resolver per in-flight requestId, so `cancel` can settle that
  // request's `run` promise immediately instead of waiting out its script.
  const cancellations = new Map<string, (result: RunResult) => void>();

  async function run(request: RunRequest): Promise<RunResult> {
    calls.push(request);

    const cancelled = new Promise<RunResult>((resolve) => {
      cancellations.set(request.requestId, resolve);
    });

    try {
      return await Promise.race([runScript(request, script), cancelled]);
    } finally {
      cancellations.delete(request.requestId);
    }
  }

  async function cancel(requestId: string): Promise<void> {
    // Cancelling a request nobody is running is not an error: the real
    // docker runner treats "no container for this id" the same way.
    cancellations.get(requestId)?.({ outcome: 'error', exitCode: null, errorDetail: 'cancelled' });
  }

  return { run, cancel, calls };
}

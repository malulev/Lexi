import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { assertControlDirOutsideWorkDir, readAgentResult } from './control';
import { AGENT_LABEL } from './slots';
import type { JobRunner, RunRequest, RunResult } from './types';
import { log } from '@/lib/log';

/**
 * The only real `JobRunner`: one throwaway container per request.
 *
 * Every property that makes the agent container safe to run unattended is
 * enforced here, not merely intended:
 *  - `buildContainerOptions` builds `Env` from a single explicit two-item
 *    literal (FR-015) — no GitHub token, no Netlify token, no session
 *    secret ever reaches the container, because nothing reads them into
 *    this function to begin with.
 *  - `CapDrop`/`SecurityOpt` narrow what a compromised agent process could
 *    do with the write access it already has to the working tree. This is
 *    defence in depth (R2): the absence of credentials above is the
 *    boundary that actually matters; egress restriction to the model
 *    provider would be additional depth, not the guarantee itself.
 *  - the container is destroyed in a `finally` on every path — completed,
 *    timed out, or failed before it ever started — because a leaked
 *    container is a leaked working tree and a leaked model spend.
 */

/** Enough for node plus the agent's own children; far below the host's table. */
export const AGENT_PIDS_LIMIT = 512;

/**
 * Half the default weight (1024). When the CPUs saturate — and on the
 * measured host they did at four agents — the kernel gives client apps and
 * the reverse proxy twice an agent's share, so the sites stay responsive
 * through the burst. Weight, not a quota: an idle host still gives an agent
 * everything.
 */
export const AGENT_CPU_SHARES = 512;

export interface CreateDockerRunnerOptions {
  image: string;
  apiKey: string;
  /** Injected in tests so no test here needs a live Docker daemon. */
  docker?: Docker;
}

type WaitOutcome = { timedOut: true } | { timedOut: false; statusCode: number };

/**
 * Exactly `OPENROUTER_API_KEY` and `MODEL`, and nothing else, as one
 * literal. A future edit that adds a third variable has to touch this
 * function, which is what makes the addition visible in code review — the
 * property under test in isolation.test.ts.
 */
function buildContainerOptions(
  image: string,
  apiKey: string,
  request: RunRequest,
): Docker.ContainerCreateOptions {
  return {
    Image: image,
    Env: [`OPENROUTER_API_KEY=${apiKey}`, `MODEL=${request.model}`],
    WorkingDir: '/work',
    Tty: false,
    // Counted by ops/status.sh for the host's running-agent metric. The
    // request id is for a developer reading `docker ps`, nothing reads it back.
    Labels: { [AGENT_LABEL]: 'true', 'webagent.request': request.requestId },
    HostConfig: {
      Binds: [`${request.workDir}:/work`, `${request.controlDir}:/control`],
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      // The memory cap is not this module's opinion. The admission daemon
      // (ops/slotd) hands each run its cap with the grant, so how many agents
      // fit and how big each may get come from one configuration on the host
      // and cannot drift apart. No grant — a development machine, or the
      // daemon unreachable — means no cap, which is exactly today's behavior.
      // `MemorySwap` equal to `Memory`, or the cap is a suggestion the
      // container can swap past.
      ...(request.memoryBytes
        ? { Memory: request.memoryBytes, MemorySwap: request.memoryBytes }
        : {}),
      CpuShares: AGENT_CPU_SHARES,
      // `PidsLimit` bounds a fork bomb, which exhausts the host's process
      // table rather than this cgroup — no memory figure would have.
      PidsLimit: AGENT_PIDS_LIMIT,
      // NOT `LogConfig: { Type: 'none' }`, however much this wants to be.
      //
      // The agent's stdout is the model's working transcript over a client's
      // private tree, and Docker writes it to a json-file in the directory a
      // log collector globs — which is how it once reached an external log
      // service. Turning the log driver off looked like the structural fix.
      // It broke the agent run: `wireOutput` reads that output back through
      // `container.attach()`, and on this daemon attach does not survive the
      // driver being `none`, so every request saw an agent that said nothing.
      //
      // The transcript is therefore kept off the wire downstream instead —
      // see the line filter in ops/monitoring/alloy/config.alloy, and the
      // reason it has to be a line match rather than a field comparison.
      AutoRemove: false,
    },
  };
}

/** Best effort: dropped output never fails a request (`RunRequest.onOutput`). */
function forwardLines(stream: NodeJS.ReadableStream, onOutput: (line: string) => void): void {
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      onOutput(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
    }
  });
}

/**
 * Demultiplexes the attached stream and forwards complete lines. Docker's
 * raw attached output is framed (an 8-byte header per chunk identifying
 * stdout vs stderr), not plain text — reading it without `demuxStream`
 * silently corrupts the progress stream with header bytes mixed into it.
 */
function wireOutput(
  docker: Docker,
  attached: NodeJS.ReadWriteStream,
  onOutput?: (line: string) => void,
): void {
  if (!onOutput) return;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  docker.modem.demuxStream(attached, stdout, stderr);
  forwardLines(stdout, onOutput);
  forwardLines(stderr, onOutput);
}

/** Races the container's exit against the request's own timeout budget. */
function waitWithTimeout(container: Docker.Container, timeoutMs: number): Promise<WaitOutcome> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => resolvePromise({ timedOut: true }), timeoutMs);

    container
      .wait()
      .then((result: { StatusCode: number }) => {
        clearTimeout(timer);
        resolvePromise({ timedOut: false, statusCode: result.StatusCode });
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        rejectPromise(error);
      });
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Logged, never rethrown: cleanup runs inside a `finally` that must not shadow the run's real outcome. */
function logCleanupFailure(
  action: string,
  requestId: string,
  containerId: string,
  error: unknown,
): void {
  log.error('runner.cleanup_failed', {
    action,
    requestId,
    containerId,
    error: describeError(error),
  });
}

export function createDockerRunner(options: CreateDockerRunnerOptions): JobRunner {
  const docker = options.docker ?? new Docker();
  const containersByRequestId = new Map<string, Docker.Container>();

  async function destroy(requestId: string, container: Docker.Container): Promise<void> {
    try {
      await container.remove({ force: true });
    } catch (error) {
      logCleanupFailure('remove container', requestId, container.id, error);
    }
  }

  async function run(request: RunRequest): Promise<RunResult> {
    let container: Docker.Container | undefined;
    try {
      // Checked here too, ahead of ever building the mounts, even though
      // `writeControlDir` (control.ts) already refuses to have written a
      // prompt into an unsafe layout — a caller that constructs `/control`
      // some other way must not get a working container out of this
      // either. Inside the `try`: `run` never throws, it reports `error`.
      assertControlDirOutsideWorkDir(request.controlDir, request.workDir);

      container = await docker.createContainer(
        buildContainerOptions(options.image, options.apiKey, request),
      );
      containersByRequestId.set(request.requestId, container);

      const attached = await container.attach({ stream: true, stdout: true, stderr: true });
      wireOutput(docker, attached, request.onOutput);

      await container.start();

      const waited = await waitWithTimeout(container, request.timeoutMs);
      if (waited.timedOut) {
        try {
          await container.kill();
        } catch (error) {
          logCleanupFailure('kill timed-out container', request.requestId, container.id, error);
        }
        return { outcome: 'timeout', exitCode: null };
      }

      const result = await readAgentResult(request.controlDir);
      return { outcome: 'completed', exitCode: waited.statusCode, result: result ?? undefined };
    } catch (error) {
      return { outcome: 'error', exitCode: null, errorDetail: describeError(error) };
    } finally {
      // Skip destroying a container `cancel` already took ownership of and
      // removed, so the two paths never race to remove the same container.
      if (container && containersByRequestId.get(request.requestId) === container) {
        containersByRequestId.delete(request.requestId);
        await destroy(request.requestId, container);
      }
    }
  }

  async function cancel(requestId: string): Promise<void> {
    const container = containersByRequestId.get(requestId);
    if (!container) return; // nothing running under this id — already finished, or never started
    containersByRequestId.delete(requestId);
    try {
      await container.kill();
    } catch (error) {
      logCleanupFailure('kill container on cancel', requestId, container.id, error);
    }
    await destroy(requestId, container);
  }

  return { run, cancel };
}

import type Docker from 'dockerode';

/**
 * Host-wide agent slots, with the Docker daemon as the semaphore.
 *
 * Several installations may share one machine, and with it one daemon. Each
 * has its own lock (one request per site), but nothing stops four sites from
 * starting four agents into 4 GB of RAM at once. Rather than a broker or a
 * shared lock file, the daemon itself is asked how many agent containers are
 * running: every one carries `AGENT_LABEL`, and a container that died is
 * simply no longer listed, so there is no stale state to reason about.
 *
 * This is a check-then-act race, not a semaphore: every waiter whose poll
 * lands between a slot freeing and the first waiter's `createContainer`
 * observes the same free slot and also proceeds, so the overshoot is bounded
 * by the number of concurrent waiters, not by one. Poll jitter (below) keeps
 * waiters from polling in lockstep, which narrows that window but does not
 * close it. Per-container memory and CPU caps that would make an overshoot
 * harmless are a planned follow-up, not something this module relies on
 * today. An exact semaphore would need shared state this product
 * deliberately does not have (constitution VII).
 */

export const AGENT_LABEL = 'webagent.agent';

export type SlotOutcome = { ok: true } | { ok: false; waitedMs: number };

export interface AgentSlots {
  /**
   * Resolves once fewer than the limit are running. `onWait` fires once, the
   * first time the caller actually has to wait, so the orchestrator can
   * announce a `queued` stage only to a request that queued.
   */
  acquire(options?: { onWait?: () => void }): Promise<SlotOutcome>;
}

/** For tests and single-site development: every request runs at once. */
export const UNLIMITED_SLOTS: AgentSlots = {
  acquire: async () => ({ ok: true }),
};

export interface CreateDockerSlotsOptions {
  docker: Pick<Docker, 'listContainers'>;
  limit: number;
  pollMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Source of the jitter unit in `[0, 1)`. Injectable so tests stay deterministic. */
  random?: () => number;
}

const DEFAULT_POLL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 15 * 60_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Spreads waiters out between 75% and 125% of the poll interval so several hosts' worth of installations do not poll in lockstep. */
function jitteredPoll(pollMs: number, unit: number): number {
  return Math.round(pollMs * (0.75 + unit * 0.5));
}

/**
 * Running containers carrying the agent label. A daemon that cannot answer
 * counts as empty: refusing every request because the count failed would
 * turn a monitoring fault into an outage, and the runner's own
 * `createContainer` reports a dead daemon properly a moment later.
 */
export async function countRunningAgents(docker: Pick<Docker, 'listContainers'>): Promise<number> {
  try {
    const containers = await docker.listContainers({
      filters: { label: [`${AGENT_LABEL}=true`] },
    });
    return containers.length;
  } catch (error) {
    console.error('runner/slots: could not count running agents, proceeding as if none', {
      error: describe(error),
    });
    return 0;
  }
}

export function createDockerSlots(options: CreateDockerSlotsOptions): AgentSlots {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? pause;
  const random = options.random ?? Math.random;

  async function acquire(acquireOptions: { onWait?: () => void } = {}): Promise<SlotOutcome> {
    const startedAt = now();
    let announced = false;

    for (;;) {
      const running = await countRunningAgents(options.docker);
      if (running < options.limit) return { ok: true };

      const waitedMs = now() - startedAt;
      if (waitedMs >= maxWaitMs) return { ok: false, waitedMs };

      if (!announced) {
        announced = true;
        acquireOptions.onWait?.();
      }
      await sleep(jitteredPoll(pollMs, random()));
    }
  }

  return { acquire };
}

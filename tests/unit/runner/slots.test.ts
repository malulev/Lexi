import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_LABEL,
  countRunningAgents,
  createDockerSlots,
  UNLIMITED_SLOTS,
} from '@/lib/runner/slots';

/**
 * The Docker daemon is the semaphore: every installation on a host shares it,
 * so counting labelled containers there is a host-wide count with no shared
 * file and no stale-lock logic. A dead container simply stops being listed.
 */

/** A daemon whose running-agent count follows a script, one entry per call. */
function daemonReporting(
  counts: number[],
): Pick<Docker, 'listContainers'> & { filters: unknown[] } {
  const filters: unknown[] = [];
  let call = 0;
  return {
    filters,
    listContainers: (async (options: Docker.ContainerListOptions) => {
      filters.push(options.filters);
      const count = counts[Math.min(call, counts.length - 1)] ?? 0;
      call += 1;
      return Array.from({ length: count }, (_, index) => ({ Id: `agent-${index}` }));
    }) as Docker['listContainers'],
  };
}

function clock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe('countRunningAgents', () => {
  it('asks the daemon only for running containers carrying the agent label', async () => {
    const docker = daemonReporting([3]);
    expect(await countRunningAgents(docker)).toBe(3);
    expect(docker.filters).toEqual([{ label: [`${AGENT_LABEL}=true`] }]);
  });

  it('counts zero, and says so in the log, when the daemon cannot be asked', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const docker = {
      listContainers: (async () => {
        throw new Error('connect ENOENT /var/run/docker.sock');
      }) as Docker['listContainers'],
    };
    expect(await countRunningAgents(docker)).toBe(0);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe('createDockerSlots', () => {
  it('returns at once when fewer agents run than the limit, without announcing a wait', async () => {
    const onWait = vi.fn();
    const slots = createDockerSlots({ docker: daemonReporting([1]), limit: 2, ...clock() });
    expect(await slots.acquire({ onWait })).toEqual({ ok: true });
    expect(onWait).not.toHaveBeenCalled();
  });

  it('waits while the host is full, announces the wait exactly once, and proceeds when a slot frees', async () => {
    const onWait = vi.fn();
    const time = clock();
    const sleep = vi.fn(time.sleep);
    const slots = createDockerSlots({
      docker: daemonReporting([2, 2, 1]),
      limit: 2,
      pollMs: 3_000,
      now: time.now,
      sleep,
      random: () => 0.5,
    });

    expect(await slots.acquire({ onWait })).toEqual({ ok: true });
    expect(onWait).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it('gives up after the maximum wait and reports how long it waited', async () => {
    const time = clock();
    const slots = createDockerSlots({
      docker: daemonReporting([2]),
      limit: 2,
      pollMs: 60_000,
      maxWaitMs: 5 * 60_000,
      now: time.now,
      sleep: time.sleep,
      random: () => 0.5,
    });

    expect(await slots.acquire()).toEqual({ ok: false, waitedMs: 5 * 60_000 });
  });

  it('treats the limit as exclusive: a limit of one waits behind one running agent', async () => {
    const onWait = vi.fn();
    const slots = createDockerSlots({ docker: daemonReporting([1, 0]), limit: 1, ...clock() });
    expect(await slots.acquire({ onWait })).toEqual({ ok: true });
    expect(onWait).toHaveBeenCalledOnce();
  });

  it('spreads waiters between 75% and 125% of the poll interval so they do not poll in lockstep', async () => {
    const time = clock();
    const sleepLow = vi.fn(time.sleep);
    const lowSlots = createDockerSlots({
      docker: daemonReporting([2, 0]),
      limit: 2,
      pollMs: 3_000,
      now: time.now,
      sleep: sleepLow,
      random: () => 0,
    });
    expect(await lowSlots.acquire()).toEqual({ ok: true });
    expect(sleepLow).toHaveBeenCalledWith(2_250);

    const highTime = clock();
    const sleepHigh = vi.fn(highTime.sleep);
    const highSlots = createDockerSlots({
      docker: daemonReporting([2, 0]),
      limit: 2,
      pollMs: 3_000,
      now: highTime.now,
      sleep: sleepHigh,
      random: () => 1,
    });
    expect(await highSlots.acquire()).toEqual({ ok: true });
    expect(sleepHigh).toHaveBeenCalledWith(3_750);
  });
});

describe('UNLIMITED_SLOTS', () => {
  it('never waits', async () => {
    const onWait = vi.fn();
    expect(await UNLIMITED_SLOTS.acquire({ onWait })).toEqual({ ok: true });
    expect(onWait).not.toHaveBeenCalled();
  });
});

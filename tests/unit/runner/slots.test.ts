import { describe, expect, it, vi } from 'vitest';

import { AGENT_LABEL, UNLIMITED_SLOTS } from '@/lib/runner/slots';

describe('UNLIMITED_SLOTS', () => {
  it('never waits, never announces a wait, and hands back a release that does nothing', async () => {
    const onWait = vi.fn();
    const outcome = await UNLIMITED_SLOTS.acquire({ onWait, requestId: 'r1' });
    expect(outcome.ok).toBe(true);
    expect(outcome.waitedMs).toBe(0);
    expect(onWait).not.toHaveBeenCalled();
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.memoryBytes).toBeUndefined();
    await expect(outcome.release()).resolves.toBeUndefined();
    await expect(outcome.release()).resolves.toBeUndefined();
  });
});

describe('AGENT_LABEL', () => {
  it('is the label ops/status.sh counts running agents by', () => {
    // status.sh filters `label=webagent.agent=true`; renaming this silently
    // zeroes the host's running-agent metric.
    expect(AGENT_LABEL).toBe('webagent.agent');
  });
});

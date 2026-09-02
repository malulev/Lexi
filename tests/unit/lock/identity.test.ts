import { describe, expect, it } from 'vitest';
import { createFakeRepoClient } from '@/lib/github/fake';
import { createLock, LOCK_REF } from '@/lib/lock/lock';

/**
 * A request the previous process abandoned has no one left to write its ending.
 * The process that breaks its lock does it instead — and can only name the
 * request because the lock commit's message names it (FR-007c).
 */
describe('breaking an abandoned lock', () => {
  /**
   * One clock drives both the repository and the lock, because the staleness
   * rule compares the lock ref's own committer date against the time the
   * breaking process believes it to be. Two clocks would be testing a
   * coincidence rather than the rule.
   */
  function movableClock(iso: string) {
    let current = new Date(iso);
    return {
      now: () => current,
      advanceMinutes(minutes: number) {
        current = new Date(current.getTime() + minutes * 60_000);
      },
    };
  }

  it('names the request whose lock it broke, so the ending is not anonymous', async () => {
    const clock = movableClock('2026-09-02T10:00:00Z');
    const client = createFakeRepoClient({ now: clock.now });

    const first = createLock(client, { now: clock.now });
    const held = await first.acquire('r_abandoned', 10);
    expect(held.ok).toBe(true);

    // Long enough after that the lock is presumed abandoned.
    clock.advanceMinutes(31);
    const second = createLock(client, { now: clock.now });
    const broken = await second.acquire('r_new', 10);

    expect(broken.ok).toBe(false);
    if (!broken.ok && broken.reason === 'broken_stale') {
      expect(broken.brokenRequestId).toBe('r_abandoned');
    } else {
      throw new Error(`expected a broken stale lock, got ${JSON.stringify(broken)}`);
    }
  });

  it('breaks the lock anyway when the message cannot be read', async () => {
    const clock = movableClock('2026-09-02T10:00:00Z');
    const client = createFakeRepoClient({ now: clock.now });
    const unreadable = { ...client, getCommitMessage: async () => null };

    const first = createLock(client, { now: clock.now });
    await first.acquire('r_abandoned', 10);

    clock.advanceMinutes(31);
    const second = createLock(unreadable, { now: clock.now });
    const broken = await second.acquire('r_new', 10);

    expect(broken.ok).toBe(false);
    if (!broken.ok && broken.reason === 'broken_stale') {
      expect(broken.brokenRequestId).toBeUndefined();
      expect(broken.handle.requestId).toBe('r_new');
    } else {
      throw new Error('a lock whose holder cannot be named must still be breakable');
    }
  });

  it('leaves a fresh lock alone, whatever its message says', async () => {
    const clock = movableClock('2026-09-02T10:00:00Z');
    const client = createFakeRepoClient({ now: clock.now });
    const first = createLock(client, { now: clock.now });
    await first.acquire('r_working', 10);

    clock.advanceMinutes(5);
    const second = createLock(client, { now: clock.now });
    const refused = await second.acquire('r_new', 10);

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('held');
    expect(await client.getRef(LOCK_REF)).not.toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  RefAlreadyExistsError,
  type CommentInfo,
  type PullRequestInfo,
  type RefInfo,
  type RepoClient,
} from '@/lib/github/types';
import { createLock, LOCK_REF } from '@/lib/lock/lock';

/**
 * research.md R3 / data-model.md's Lock entity is the authority here: the
 * lock is a git reference, acquiring it is a compare-and-swap, and a ref
 * older than `maxRequestMinutes` is presumed abandoned and breakable.
 *
 * This is a minimal in-memory `RepoClient`, just enough surface for the lock
 * module, with a clock the tests can advance instead of waiting on a real
 * one. Another agent owns `src/lib/github/fake.ts`; this stub does not
 * depend on it existing.
 */
class FakeRepoClient implements RepoClient {
  private readonly refs = new Map<string, RefInfo>();
  private readonly commitMessages = new Map<string, string>();
  private lockCommitSeq = 0;

  constructor(
    private readonly clock: { now: () => Date },
    private readonly defaultBranch = 'main',
  ) {
    this.refs.set(`refs/heads/${defaultBranch}`, {
      ref: `refs/heads/${defaultBranch}`,
      sha: 'base-sha',
      committedAt: clock.now().toISOString(),
    });
  }

  async readFile(): Promise<string | null> {
    return null;
  }

  async getDefaultBranch(): Promise<string> {
    return this.defaultBranch;
  }

  async createRef(ref: string, sha: string): Promise<void> {
    if (this.refs.has(ref)) throw new RefAlreadyExistsError(ref);
    this.refs.set(ref, { ref, sha, committedAt: this.clock.now().toISOString() });
  }

  async deleteRef(ref: string): Promise<void> {
    if (!this.refs.has(ref)) throw new NotFoundError(`ref not found: ${ref}`);
    this.refs.delete(ref);
  }

  async getRef(ref: string): Promise<RefInfo | null> {
    return this.refs.get(ref) ?? null;
  }

  async createLockCommit(message: string, _parentSha: string): Promise<string> {
    const sha = `lock-sha-${++this.lockCommitSeq}`;
    this.commitMessages.set(sha, message);
    return sha;
  }

  async getCommitMessage(sha: string): Promise<string | null> {
    return this.commitMessages.get(sha) ?? null;
  }

  async createPullRequest(): Promise<PullRequestInfo> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async getPullRequest(): Promise<PullRequestInfo | null> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async listPullRequests(): Promise<PullRequestInfo[]> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async updatePullRequest(): Promise<PullRequestInfo> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async listComments(): Promise<CommentInfo[]> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async createComment(): Promise<CommentInfo> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async updateComment(): Promise<CommentInfo> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async mergePullRequest(): Promise<{ sha: string }> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async revertCommit(): Promise<{ sha: string }> {
    throw new Error('not implemented in FakeRepoClient');
  }

  async compareBranches(): Promise<{ aheadBy: number; behindBy: number }> {
    return { aheadBy: 0, behindBy: 0 };
  }

  async authenticatedRemoteUrl(): Promise<string> {
    throw new Error('not implemented in FakeRepoClient');
  }
}

/** A clock the tests can advance deterministically instead of waiting on a real one. */
function makeClock(startIso = '2026-09-02T10:00:00.000Z') {
  let current = new Date(startIso);
  return {
    now: () => current,
    advanceMinutes(minutes: number) {
      current = new Date(current.getTime() + minutes * 60_000);
    },
  };
}

describe('createLock().acquire', () => {
  it('succeeds once, creating refs/webagent/lock', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    const result = await lock.acquire('r1', 30);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected an acquired lock');
    expect(result.handle.requestId).toBe('r1');
    expect(await client.getRef(LOCK_REF)).not.toBeNull();
  });

  it('a second acquisition observes rejection while the first is still fresh', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    await lock.acquire('r1', 30);
    const second = await lock.acquire('r2', 30);

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected rejection');
    expect(second.reason).toBe('held');
    expect(second.reason === 'held' && second.heldSince).toBeTruthy();
  });

  it('a ref older than maxRequestMinutes is breakable, and hands the lock to the new request', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    await lock.acquire('r1', 5);
    clock.advanceMinutes(6);
    const second = await lock.acquire('r2', 5);

    expect(second.ok).toBe(false);
    if (second.ok || second.reason !== 'broken_stale') {
      throw new Error('expected the stale lock to be broken');
    }
    expect(second.handle.requestId).toBe('r2');

    // The break really did hand the lock to r2, not merely report that it could.
    const third = await lock.acquire('r3', 5);
    expect(third.ok).toBe(false);
    if (third.ok) throw new Error('expected r2 to now hold the lock');
    expect(third.reason).toBe('held');
  });

  it('a fresh ref is NOT breakable, even minutes before the staleness boundary', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    await lock.acquire('r1', 5);
    clock.advanceMinutes(4);
    const second = await lock.acquire('r2', 5);

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected rejection');
    expect(second.reason).toBe('held');
  });
});

describe('LockHandle.release', () => {
  it('deletes the ref', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    const acquired = await lock.acquire('r1', 30);
    if (!acquired.ok) throw new Error('expected an acquired lock');
    await acquired.handle.release();

    expect(await client.getRef(LOCK_REF)).toBeNull();
  });

  it('is idempotent: releasing an already-gone ref does not throw', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    const acquired = await lock.acquire('r1', 30);
    if (!acquired.ok) throw new Error('expected an acquired lock');
    await acquired.handle.release();

    await expect(acquired.handle.release()).resolves.toBeUndefined();
  });

  it('lets a following request acquire cleanly once released', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    const first = await lock.acquire('r1', 30);
    if (!first.ok) throw new Error('expected an acquired lock');
    await first.handle.release();

    const second = await lock.acquire('r2', 30);
    expect(second.ok).toBe(true);
  });
});

describe('createLock().inspect', () => {
  it('reports null when the lock is not held', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    expect(await lock.inspect()).toBeNull();
  });

  it('reports how long the lock has been held', async () => {
    const clock = makeClock();
    const client = new FakeRepoClient(clock);
    const lock = createLock(client, { now: clock.now });

    await lock.acquire('r1', 30);
    const info = await lock.inspect();

    expect(info).not.toBeNull();
    expect(info?.heldSince).toBe(clock.now().toISOString());
  });
});

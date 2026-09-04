/**
 * Single-flight lock over a site's repository, backed by a git reference
 * (research.md R3; data-model.md's Lock entity; FR-007b, FR-007c). The
 * reference is the single source of truth: creating it is a compare-and-swap
 * — `RefAlreadyExistsError` means someone else already holds it — which is
 * what makes "at most one request in progress" true across separate
 * processes and survives a process restart, not merely within one running
 * process.
 */

import { isNotFoundError, isRefAlreadyExistsError, type RepoClient } from '@/lib/github/types';

export const LOCK_REF = 'refs/webagent/lock';

export interface LockHandle {
  requestId: string;
  acquiredAt: string;
  release(): Promise<void>;
}

export type AcquireResult =
  | { ok: true; handle: LockHandle }
  | { ok: false; reason: 'held'; heldSince: string }
  | {
      ok: false;
      reason: 'broken_stale';
      handle: LockHandle;
      brokenRequestId?: string;
      /** When the broken request began, as its own process recorded it. */
      brokenStartedAt?: string;
    };

const MS_PER_MINUTE = 60_000;

/**
 * Names the request and its start time in the lock commit's message, per
 * data-model.md's Lock entity ("identity: points at a commit whose message
 * names the request and its start time").
 *
 * This is not decoration. It is the only channel by which a process breaking an
 * abandoned lock can learn whose request it is ending, and so the only way that
 * request's record gets written under its own identity rather than anonymously.
 */
function buildLockMessage(requestId: string, startedAt: string): string {
  return `${LOCK_MESSAGE_PREFIX}${requestId} started ${startedAt}`;
}

const LOCK_MESSAGE_PREFIX = 'webagent-lock: ';

/** Whom a lock belongs to, as far as its own commit message can say. */
interface LockHolder {
  requestId: string;
  startedAt?: string;
}

/** `undefined` when the message is absent or was not written by this product. */
function parseLockMessage(message: string | null): LockHolder | undefined {
  if (!message?.startsWith(LOCK_MESSAGE_PREFIX)) return undefined;

  const [requestId, startedAt] = message.slice(LOCK_MESSAGE_PREFIX.length).split(' started ');
  const named = requestId?.trim();
  if (!named) return undefined;

  // The start time is optional here even though this product always writes
  // one: a lock written by an older version, or by a hand, is still a lock
  // worth breaking under a name.
  const began = startedAt?.trim();
  return { requestId: named, ...(began ? { startedAt: began } : {}) };
}

/** Best effort by design: a lock is still breakable when its message cannot be read. */
async function readHolder(client: RepoClient, sha: string): Promise<LockHolder | undefined> {
  try {
    return parseLockMessage(await client.getCommitMessage(sha));
  } catch {
    return undefined;
  }
}

function isStale(committedAt: string, maxRequestMinutes: number, now: Date): boolean {
  const ageMs = now.getTime() - new Date(committedAt).getTime();
  return ageMs > maxRequestMinutes * MS_PER_MINUTE;
}

async function releaseRef(client: RepoClient, ref: string): Promise<void> {
  try {
    await client.deleteRef(ref);
  } catch (error) {
    // Release runs on every terminal path, including failure. A release that
    // throws because the ref is already gone would leak the lock forever, so
    // idempotency here is load-bearing, not a nicety. A missing ref is the
    // expected case; anything else is logged so a genuine transport fault is
    // not silently invisible.
    if (!isNotFoundError(error)) {
      console.error('lock release failed; ref may remain held', { ref, error });
    }
  }
}

function makeHandle(client: RepoClient, requestId: string, acquiredAt: string): LockHandle {
  return { requestId, acquiredAt, release: () => releaseRef(client, LOCK_REF) };
}

async function getParentSha(client: RepoClient): Promise<string> {
  const defaultBranch = await client.getDefaultBranch();
  const headRef = await client.getRef(`refs/heads/${defaultBranch}`);
  if (!headRef) {
    throw new Error(`default branch ref not found: refs/heads/${defaultBranch}`);
  }
  return headRef.sha;
}

/** Breaks an abandoned lock and claims it for this request (FR-007c). */
async function breakStaleLock(
  client: RepoClient,
  requestId: string,
  startedAt: string,
  preparedLockSha: string,
  staleSha: string,
): Promise<AcquireResult> {
  // Read whose request this was before deleting the ref that names it.
  const broken = await readHolder(client, staleSha);
  await releaseRef(client, LOCK_REF);

  try {
    await client.createRef(LOCK_REF, preparedLockSha);
  } catch (error) {
    if (!isRefAlreadyExistsError(error)) throw error;
    // Another process broke and re-acquired the same stale lock first.
    const raced = await client.getRef(LOCK_REF);
    return { ok: false, reason: 'held', heldSince: raced?.committedAt ?? startedAt };
  }

  return {
    ok: false,
    reason: 'broken_stale',
    handle: makeHandle(client, requestId, startedAt),
    ...(broken?.requestId ? { brokenRequestId: broken.requestId } : {}),
    ...(broken?.startedAt ? { brokenStartedAt: broken.startedAt } : {}),
  };
}

/** Handles the CAS losing race: another request already holds, or held, the lock. */
async function resolveContestedAcquire(
  client: RepoClient,
  requestId: string,
  startedAt: string,
  preparedLockSha: string,
  maxRequestMinutes: number,
  now: Date,
): Promise<AcquireResult> {
  const existing = await client.getRef(LOCK_REF);

  if (!existing) {
    // Vanished between our failed create and this read: the other holder
    // released concurrently. Our commit already exists; claim it.
    await client.createRef(LOCK_REF, preparedLockSha);
    return { ok: true, handle: makeHandle(client, requestId, startedAt) };
  }

  if (!isStale(existing.committedAt, maxRequestMinutes, now)) {
    return { ok: false, reason: 'held', heldSince: existing.committedAt };
  }

  return breakStaleLock(client, requestId, startedAt, preparedLockSha, existing.sha);
}

export function createLock(client: RepoClient, deps?: { now?: () => Date }) {
  const now = deps?.now ?? (() => new Date());

  async function acquire(requestId: string, maxRequestMinutes: number): Promise<AcquireResult> {
    const startedAt = now().toISOString();
    const parentSha = await getParentSha(client);
    const message = buildLockMessage(requestId, startedAt);
    const lockSha = await client.createLockCommit(message, parentSha);

    try {
      await client.createRef(LOCK_REF, lockSha);
      return { ok: true, handle: makeHandle(client, requestId, startedAt) };
    } catch (error) {
      if (!isRefAlreadyExistsError(error)) throw error;
      return resolveContestedAcquire(client, requestId, startedAt, lockSha, maxRequestMinutes, now());
    }
  }

  async function inspect(): Promise<{ heldSince: string; requestId?: string } | null> {
    const info = await client.getRef(LOCK_REF);
    return info ? { heldSince: info.committedAt } : null;
  }

  return { acquire, inspect };
}

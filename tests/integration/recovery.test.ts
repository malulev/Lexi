import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { claimConversationBranch, readConversation } from '@/lib/conversations';
import { runRequest } from '@/lib/jobs/run';
import { createLock, LOCK_REF } from '@/lib/lock/lock';
import { parseComment } from '@/lib/record/record';
import { createHarness, type Harness } from './harness';

/**
 * User Story 5, the ending nobody is left to write.
 *
 * A process that dies mid-request leaves a lock and a conversation whose last
 * word is the client's own. The next process to arrive is the only one that
 * still knows the request existed, so it writes the ending on its behalf
 * (FR-007c). These tests exercise that across a real orchestrator run, because
 * the lock unit tests can prove the lock was broken but not that the
 * conversation reads correctly afterwards.
 */

let harness: Harness | null = null;

const ABANDONED_STARTED_AT = '2026-09-02T10:00:00.000Z';

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
});

async function openConversation(client: Harness['client']) {
  const base = await client.getRef('refs/heads/main');
  const { branch } = await claimConversationBranch(client, base!.sha);
  return client.createPullRequest({
    title: 'Change something',
    head: branch,
    base: 'main',
    body: 'Opened from a change request.',
  });
}

function editsTheHomepage() {
  return {
    result: {
      summary: 'I made the headline shorter.',
      filesChanged: ['src/index.html'],
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.1,
    },
    async edit(workDir: string) {
      const full = join(workDir, 'src/index.html');
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, '<h1>Built for speed</h1>\n', 'utf8');
    },
  };
}

/**
 * A lock left behind by a process that never came back.
 *
 * The ref is aged in place rather than by winding a clock forward, because the
 * staleness rule reads the ref's own committer date and that is exactly the
 * field a restart leaves stranded in the past.
 */
async function leaveAnAbandonedLock(harnessed: Harness, requestId: string): Promise<void> {
  const stopped = createLock(harnessed.client, { now: () => new Date(ABANDONED_STARTED_AT) });
  const held = await stopped.acquire(requestId, harnessed.deps.config.settings.maxRequestMinutes);
  expect(held.ok).toBe(true);

  const ref = harnessed.client.state.refs[LOCK_REF]!;
  ref.committedAt = ABANDONED_STARTED_AT;
}

describe('a request the previous process never finished', () => {
  it('is recorded as abandoned by whoever breaks its lock', async () => {
    harness = await createHarness({ script: editsTheHomepage(), previewTimeoutMs: 50 });
    const pullRequest = await openConversation(harness.client);
    await leaveAnAbandonedLock(harness, 'r_abandoned');

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline',
      history: [],
    });

    const records = (await harness.client.listComments(pullRequest.number))
      .map((comment) => parseComment(comment).record)
      .filter((record) => record !== undefined);

    const abandoned = records.find((record) => record.outcome === 'abandoned');
    expect(abandoned, 'the interrupted request must get an ending of its own').toBeDefined();
    expect(abandoned?.requestId).toBe('r_abandoned');
    // The lock commit names when its request began, and that is the only
    // record of the fact left anywhere — so the ending uses it rather than
    // claiming the request started at the moment it was cleaned up.
    expect(abandoned?.startedAt).toBe(ABANDONED_STARTED_AT);
    expect(abandoned?.finishedAt).not.toBe('');
  });

  it('reads as interrupted in the conversation, with nothing published', async () => {
    harness = await createHarness({ script: editsTheHomepage(), previewTimeoutMs: 50 });
    const pullRequest = await openConversation(harness.client);
    await leaveAnAbandonedLock(harness, 'r_abandoned');

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline',
      history: [],
    });

    const detail = await readConversation(harness.client, pullRequest.number);
    const interrupted = detail?.messages.find((message) => message.outcome === 'abandoned');

    expect(interrupted).toBeDefined();
    expect(interrupted?.text.toLowerCase()).toContain('interrupted');
    expect(interrupted?.text.toLowerCase()).toContain('nothing was published');
    // Plain language only: no lock, no ref, no request identifier.
    expect(interrupted?.text).not.toContain('r_abandoned');
    expect(interrupted?.text.toLowerCase()).not.toContain('lock');
  });

  it('lets the request that broke the lock run to completion', async () => {
    harness = await createHarness({ script: editsTheHomepage(), previewTimeoutMs: 50 });
    const pullRequest = await openConversation(harness.client);
    await leaveAnAbandonedLock(harness, 'r_abandoned');

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline',
      history: [],
    });

    expect(outcome.started).toBe(true);
    if (!outcome.started) throw new Error('breaking a stale lock must not refuse the new request');
    expect(outcome.record.outcome).not.toBe('abandoned');
    // The lock the second request took is released like any other.
    expect(harness.client.state.refs[LOCK_REF]).toBeUndefined();
  });

  it('leaves a lock that is merely slow alone', async () => {
    harness = await createHarness({ script: editsTheHomepage() });
    const pullRequest = await openConversation(harness.client);
    const working = createLock(harness.client);
    await working.acquire('r_working', harness.deps.config.settings.maxRequestMinutes);

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline',
      history: [],
    });

    expect(outcome.started).toBe(false);
    if (outcome.started) throw new Error('a live request must not be evicted');
    expect(outcome.errorCode).toBe('request_in_flight');

    const records = (await harness.client.listComments(pullRequest.number)).map(
      (comment) => parseComment(comment).record,
    );
    expect(records.some((record) => record?.outcome === 'abandoned')).toBe(false);
  });
});

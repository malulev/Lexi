import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { claimConversationBranch } from '@/lib/conversations';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import { beginRequest, runRequest } from '@/lib/jobs/run';
import { parseComment } from '@/lib/record/record';
import type { AgentSlots } from '@/lib/runner/slots';
import type { JobEvent } from '@/types';
import { branchExists, createHarness, readPushedFile, type Harness } from './harness';

/**
 * A request on a full host waits its turn, and says so in the client's words;
 * one that waits too long ends in its own sentence with the site untouched.
 */

let harness: Harness | null = null;

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

const editsTheHomepage = {
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

/** Slots that make the caller wait once, then let it through. */
function slotsThatQueueOnce(): AgentSlots & { readonly waits: number } {
  let waits = 0;
  return {
    get waits() {
      return waits;
    },
    async acquire(options) {
      waits += 1;
      options?.onWait?.();
      return { ok: true };
    },
  };
}

const slotsThatNeverFree: AgentSlots = {
  async acquire(options) {
    options?.onWait?.();
    return { ok: false, waitedMs: 15 * 60_000 };
  },
};

function stagesSeen(events: JobEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'stage' ? [event.stage] : []));
}

describe('a request on a full host', () => {
  it('queues before running, and the client sees the wait as a stage', async () => {
    const slots = slotsThatQueueOnce();
    harness = await createHarness({ script: editsTheHomepage, slots, previewTimeoutMs: 500 });
    const pullRequest = await openConversation(harness.client);

    const begun = await beginRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });
    expect(begun.started).toBe(true);
    if (!begun.started) throw new Error('the request should have started');

    await begun.completed;

    // Subscribing after `beginRequest` can miss events published before its
    // first suspension (execute runs synchronously that far), so the durable
    // history is read instead — the same remedy stream.test.ts uses.
    expect(slots.waits).toBe(1);
    const stages = stagesSeen(harness.bus.history(begun.requestId));
    expect(stages.indexOf('queued')).toBeGreaterThan(-1);
    expect(stages.indexOf('queued')).toBeLessThan(stages.indexOf('running'));
    expect(harness.runner.calls).toHaveLength(1);
  });

  it('gives up after the wait with its own sentence, having run nothing and published nothing', async () => {
    harness = await createHarness({ script: editsTheHomepage, slots: slotsThatNeverFree });
    const pullRequest = await openConversation(harness.client);

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });

    expect(outcome.started && outcome.outcome).toBe('failed');
    expect(harness.runner.calls).toHaveLength(0);
    const parsed = parseComment((await harness.client.listComments(pullRequest.number)).at(-1)!);
    expect(parsed.record?.errorCode).toBe('too_busy');
    expect(parsed.record?.errorDetail).toMatch(/15 minutes/);
    expect(parsed.record?.stages.map((event) => event.stage)).toEqual(['queued', 'failed']);
    expect(parsed.prose).toBe(CLIENT_MESSAGES.too_busy);
    expect(await readPushedFile(harness.originDir, 'main', 'src/index.html')).toContain('Hello');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });

  it('runs at once, with no queued stage, when no slots are configured', async () => {
    harness = await createHarness({ script: editsTheHomepage, previewTimeoutMs: 500 });
    const pullRequest = await openConversation(harness.client);

    const begun = await beginRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });
    expect(begun.started).toBe(true);
    if (!begun.started) throw new Error('the request should have started');

    await begun.completed;

    const stages = stagesSeen(harness.bus.history(begun.requestId));
    // A negative assertion needs a positive one beside it, or it passes on an
    // empty history that never ran anything at all.
    expect(stages).toContain('running');
    expect(stages).not.toContain('queued');
  });
});

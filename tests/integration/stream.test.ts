import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { branchFor, readConversation } from '@/lib/conversations';
import { beginRequest, runRequest } from '@/lib/jobs/run';
import type { Deploy } from '@/lib/netlify/types';
import type { JobEvent, Stage } from '@/types';
import { createHarness, type Harness } from './harness';

/**
 * Progress, and what survives losing it.
 *
 * The split the constitution draws is the thing under test: stage transitions
 * and outcomes are durable and must arrive in order, while live output is
 * explicitly ephemeral. A reader who reconnects is owed the former and not the
 * latter (constitution V, R7, FR-009).
 */

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
});

function readyDeploy(conversationNumber: number): Deploy {
  return {
    id: 'deploy-1',
    state: 'ready',
    context: 'deploy-preview',
    reviewId: conversationNumber,
    deployUrl: `https://deploy-preview-${conversationNumber}--client.netlify.app`,
    createdAt: '2026-09-02T10:34:00Z',
  };
}

function editingScript(output: string[] = []) {
  return {
    output,
    result: {
      summary: 'I made the headline shorter.',
      filesChanged: ['src/index.html'],
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.4,
    },
    async edit(workDir: string) {
      await writeFile(join(workDir, 'src/index.html'), '<h1>Shorter</h1>\n', 'utf8');
    },
  };
}

async function openConversation(harnessed: Harness) {
  const branch = branchFor(1);
  await harnessed.client.createRef(`refs/heads/${branch}`, 'fake-genesis-commit');
  const pullRequest = await harnessed.client.createPullRequest({
    title: 'Shorten the headline',
    head: branch,
    base: 'main',
    body: 'Opened from a change request.',
  });
  harnessed.netlify.addDeploy(readyDeploy(pullRequest.number));
  return pullRequest;
}

describe('the progress stream while a request runs', () => {
  it('emits every stage of the happy path, in order', async () => {
    harness = await createHarness({ script: editingScript() });
    const pullRequest = await openConversation(harness);

    const seen: Stage[] = [];
    const begun = await beginRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });

    expect(begun.started).toBe(true);
    if (!begun.started) throw new Error('the request should have started');

    harness.bus.subscribe(begun.requestId, (event: JobEvent) => {
      if (event.type === 'stage') seen.push(event.stage);
    });

    await begun.completed;

    // Subscribing after `beginRequest` misses nothing durable, because the bus
    // keeps a request's stage history for exactly this reason.
    const history = harness.bus
      .history(begun.requestId)
      .flatMap((event) => (event.type === 'stage' ? [event.stage] : []));

    expect(history).toEqual(['running', 'gating', 'pushing', 'building', 'succeeded']);
  });

  it('ends with an outcome and the preview, so a watcher need not poll to learn it finished', async () => {
    harness = await createHarness({ script: editingScript() });
    const pullRequest = await openConversation(harness);

    const begun = await beginRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });
    if (!begun.started) throw new Error('the request should have started');
    await begun.completed;

    const done = harness.bus.history(begun.requestId).find((event) => event.type === 'done');
    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.outcome).toBe('succeeded');
      expect(done.previewUrl).toContain('deploy-preview');
    }
  });

  it('keeps stages even when the agent is chatty enough to overflow the history bound', async () => {
    // More output lines than the bus will hold, so eviction certainly happens.
    const chatty = Array.from({ length: 40 }, (_, index) => `line ${index}`);
    harness = await createHarness({ script: editingScript(chatty) });
    const pullRequest = await openConversation(harness);

    const begun = await beginRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });
    if (!begun.started) throw new Error('the request should have started');
    await begun.completed;

    const kept = harness.bus.history(begun.requestId);
    const stages = kept.flatMap((event) => (event.type === 'stage' ? [event.stage] : []));

    expect(stages).toEqual(['running', 'gating', 'pushing', 'building', 'succeeded']);
    expect(kept.some((event) => event.type === 'done')).toBe(true);
  });
});

describe('reconnecting after the live stream is gone', () => {
  it('replays the finished request from its durable record, not from memory', async () => {
    harness = await createHarness({ script: editingScript() });
    const pullRequest = await openConversation(harness);

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });
    if (!outcome.started) throw new Error('the request should have started');

    // Everything the process was holding is thrown away, standing in for the
    // restart R7 says the client must survive.
    harness.bus.clear(outcome.requestId);
    expect(harness.bus.history(outcome.requestId)).toHaveLength(0);

    const detail = await readConversation(harness.client, pullRequest.number);
    expect(detail).not.toBeNull();

    const record = detail!.records.at(-1);
    expect(record?.outcome).toBe('succeeded');
    expect(record?.previewUrl).toContain('deploy-preview');
    expect(record?.stages.map((stage) => stage.stage)).toEqual([
      'running',
      'gating',
      'pushing',
      'building',
      'succeeded',
    ]);
  });

  it('reconstructs the whole conversation from comments alone, as a fresh process would', async () => {
    harness = await createHarness({ script: editingScript() });
    const pullRequest = await openConversation(harness);

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });

    const detail = await readConversation(harness.client, pullRequest.number);
    const agentTurn = detail!.messages.find((message) => message.author === 'agent');

    expect(agentTurn?.outcome).toBe('succeeded');
    expect(agentTurn?.previewUrl).toContain('deploy-preview');
    // The prose a client reads carries no trace of the block behind it.
    expect(agentTurn?.text).not.toContain('webagent:v1');
    expect(agentTurn?.text).not.toContain('src/');
  });
});

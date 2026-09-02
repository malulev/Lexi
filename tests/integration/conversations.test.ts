import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { beginRequest, runRequest } from '@/lib/jobs/run';
import { branchFor, readConversation, renderClientMessage } from '@/lib/conversations';
import { parseComment } from '@/lib/record/record';
import type { Deploy } from '@/lib/netlify/types';
import { branchExists, createHarness, readPushedFile, type Harness } from './harness';

/**
 * User Story 1: a client describes a change and gets a preview, with the public
 * site untouched.
 *
 * These run the real orchestrator over real git repositories. Only the network
 * — GitHub, Netlify, the model — is faked, because those are the boundaries the
 * design already draws.
 */

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
});

function previewDeploy(conversationNumber: number): Deploy {
  return {
    id: 'deploy-1',
    state: 'ready',
    context: 'deploy-preview',
    reviewId: conversationNumber,
    deployUrl: `https://deploy-preview-${conversationNumber}--client.netlify.app`,
    createdAt: '2026-09-02T10:34:00Z',
  };
}

/** An agent that edits one permitted file, as a real one would. */
function editsTheHomepage(headline: string) {
  return {
    result: {
      summary: 'I made the headline shorter.',
      filesChanged: ['src/index.html'],
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.4,
    },
    async edit(workDir: string) {
      await writeFile(join(workDir, 'src/index.html'), `<h1>${headline}</h1>\n`, 'utf8');
    },
  };
}

async function openConversation(client: Harness['client'], branch: string) {
  await client.createRef(`refs/heads/${branch}`, 'fake-genesis-commit');
  return client.createPullRequest({
    title: 'Shorten the headline',
    head: branch,
    base: 'main',
    body: 'Opened from a change request.',
  });
}

describe('sending one change request', () => {
  it('pushes the change and reports a preview, leaving the default branch alone', async () => {
    harness = await createHarness({ script: editsTheHomepage('Built for speed') });
    const pullRequest = await openConversation(harness.client, branchFor(1));
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline to Built for speed',
      history: [],
    });

    expect(outcome.started).toBe(true);
    if (!outcome.started) throw new Error('the request should have started');
    expect(outcome.outcome).toBe('succeeded');
    expect(outcome.record.previewUrl).toContain('deploy-preview');

    // The change reached the conversation's branch...
    expect(await readPushedFile(harness.originDir, pullRequest.headRef, 'src/index.html')).toContain(
      'Built for speed',
    );
    // ...and nowhere near the branch the public site is built from (FR-024).
    expect(await readPushedFile(harness.originDir, 'main', 'src/index.html')).toContain('Hello');
  });

  it('writes one durable record a client can read as prose and a dashboard can parse', async () => {
    harness = await createHarness({ script: editsTheHomepage('Built for speed') });
    const pullRequest = await openConversation(harness.client, branchFor(1));
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline',
      history: [],
    });

    const comments = await harness.client.listComments(pullRequest.number);
    expect(comments).toHaveLength(1);

    const parsed = parseComment(comments[0]!);
    expect(parsed.record?.outcome).toBe('succeeded');
    expect(parsed.record?.filesChanged).toBe(1);
    expect(parsed.record?.costUsd).toBe(0.4);
    // The prose stands alone: a reader who never sees the block loses nothing.
    expect(parsed.prose).toContain('Your preview is ready.');
    expect(parsed.prose).not.toContain('src/');
    expect(parsed.prose).not.toContain('webagent:v1');
  });

  it('releases the lock when the request ends, so the next request is not refused', async () => {
    harness = await createHarness({ script: editsTheHomepage('Built for speed') });
    const pullRequest = await openConversation(harness.client, branchFor(1));
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline',
      history: [],
    });

    expect(await harness.lock.inspect()).toBeNull();
  });
});

describe('a second request while one is in flight', () => {
  it('is refused rather than queued, which is what the disabled input cannot enforce (FR-007b)', async () => {
    // A slow agent keeps the first request — and so the lock — in flight.
    harness = await createHarness({ script: { ...editsTheHomepage('Slow'), delayMs: 200 } });
    const pullRequest = await openConversation(harness.client, branchFor(1));
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    const first = await beginRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Make it slow',
      history: [],
    });
    expect(first.started).toBe(true);

    const second = await beginRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Also make it bigger',
      history: [],
    });

    expect(second.started).toBe(false);
    if (!second.started) expect(second.errorCode).toBe('request_in_flight');

    if (first.started) await first.completed;
  });

  it('runs exactly one agent, whatever the second caller asked for', async () => {
    harness = await createHarness({ script: { ...editsTheHomepage('Slow'), delayMs: 200 } });
    const pullRequest = await openConversation(harness.client, branchFor(1));
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    const input = {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Make it slow',
      history: [],
    };

    const first = await beginRequest(harness.deps, input);
    await beginRequest(harness.deps, { ...input, message: 'And bigger' });
    if (first.started) await first.completed;

    expect(harness.runner.calls).toHaveLength(1);
  });
});

describe('a follow-up message', () => {
  it('lands on the same branch and pull request, refreshing the preview rather than competing with it (FR-006)', async () => {
    // One script whose edit changes between runs, so the second request is a
    // genuine follow-up rather than a repeat of the first.
    let headline = 'First';
    harness = await createHarness({
      script: {
        result: {
          summary: 'I changed the headline.',
          filesChanged: ['src/index.html'],
          tokensIn: 100,
          tokensOut: 20,
          costUsd: 0.4,
        },
        async edit(workDir: string) {
          await writeFile(join(workDir, 'src/index.html'), `<h1>${headline}</h1>\n`, 'utf8');
        },
      },
    });
    const pullRequest = await openConversation(harness.client, branchFor(1));
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    const input = {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Say First',
      history: [],
    };

    await runRequest(harness.deps, input);

    headline = 'Second';
    await runRequest(harness.deps, { ...input, message: 'Now say Second' });

    // Both requests asked the mirror for the same branch...
    expect(harness.checkouts).toEqual([pullRequest.headRef, pullRequest.headRef]);
    // ...no competing branch was opened...
    expect(await branchExists(harness.originDir, branchFor(2))).toBe(false);
    // ...and the second change built on the first rather than replacing it.
    expect(await readPushedFile(harness.originDir, pullRequest.headRef, 'src/index.html')).toContain(
      'Second',
    );
    expect(harness.client.state.pullRequests).toHaveLength(1);
  });

  it('carries the earlier turns into the agent’s prompt, since each container starts fresh', async () => {
    harness = await createHarness({ script: editsTheHomepage('Second') });
    const pullRequest = await openConversation(harness.client, branchFor(1));
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    await harness.client.createComment(pullRequest.number, renderClientMessage('Say First'));
    const detail = await readConversation(harness.client, pullRequest.number);

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Now say Second',
      history: detail!.messages,
    });

    const prompt = harness.runner.calls[0]!.prompt;
    expect(prompt.request).toContain('Now say Second');
    expect(prompt.history.map((turn) => turn.text)).toContain('Say First');
    expect(prompt.guidance).toContain('sentence case');
  });
});

describe('a change the site does not permit', () => {
  it('pushes nothing and commits nothing, and says so in the client’s words', async () => {
    harness = await createHarness({
      script: {
        result: {
          summary: 'I changed the payment settings.',
          filesChanged: ['config/payments.json'],
          tokensIn: 10,
          tokensOut: 5,
          costUsd: 0.1,
        },
        async edit(workDir: string) {
          await mkdir(join(workDir, 'config'), { recursive: true });
          await writeFile(join(workDir, 'config/payments.json'), '{"live":true}\n', 'utf8');
        },
      },
    });

    const pullRequest = await openConversation(harness.client, branchFor(1));

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Turn on live payments',
      history: [],
    });

    expect(outcome.started).toBe(true);
    if (!outcome.started) throw new Error('the request should have started');
    expect(outcome.outcome).toBe('blocked');
    expect(outcome.record.blockedPath).toBe('config/payments.json');

    // Nothing was committed, so there is nothing to unwind.
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
    expect(
      await readPushedFile(harness.originDir, 'main', 'config/payments.json'),
    ).toBeNull();

    const comments = await harness.client.listComments(pullRequest.number);
    const parsed = parseComment(comments.at(-1)!);
    expect(parsed.prose).toBe('Your developer has protected this part of the site.');
    expect(parsed.prose).not.toContain('config/payments.json');
  });
});

describe('a request that changes nothing', () => {
  it('reports that nothing needed changing rather than pushing an empty commit', async () => {
    harness = await createHarness({
      script: {
        result: {
          summary: 'Nothing needed changing.',
          filesChanged: [],
          tokensIn: 10,
          tokensOut: 2,
          costUsd: 0.02,
        },
      },
    });

    const pullRequest = await openConversation(harness.client, branchFor(1));

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Make the headline say Hello',
      history: [],
    });

    expect(outcome.started).toBe(true);
    if (!outcome.started) throw new Error('the request should have started');
    expect(outcome.record.errorCode).toBe('nothing_to_change');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });
});

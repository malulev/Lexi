import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { beginRequest, runRequest } from '@/lib/jobs/run';
import {
  branchFor,
  claimConversationBranch,
  collectRefusedPaths,
  readConversation,
  renderClientMessage,
} from '@/lib/conversations';
import { parseComment } from '@/lib/record/record';
import type { Deploy } from '@/lib/netlify/types';
import { createFakeMailer, notifyOnce } from '@/lib/notify/email';
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

/** Opened the way the route opens one, so the head is a commit ahead of its base. */
async function openConversation(client: Harness['client']) {
  const base = await client.getRef('refs/heads/main');
  const { branch } = await claimConversationBranch(client, base!.sha);
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
    const pullRequest = await openConversation(harness.client);
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
    const pullRequest = await openConversation(harness.client);
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
    const pullRequest = await openConversation(harness.client);
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
    const pullRequest = await openConversation(harness.client);
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
    const pullRequest = await openConversation(harness.client);
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
    const pullRequest = await openConversation(harness.client);
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
    const pullRequest = await openConversation(harness.client);
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

    const pullRequest = await openConversation(harness.client);

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

    const pullRequest = await openConversation(harness.client);

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

describe('telling the client their preview is ready', () => {
  it('sends once, and stays silent when asked to send the same event again (OD-004)', async () => {
    harness = await createHarness({ script: editsTheHomepage('Built for speed') });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline',
      history: [],
    });
    if (!outcome.started) throw new Error('the request should have started');

    const mailer = createFakeMailer();
    const commentId = (await harness.client.listComments(pullRequest.number)).at(-1)!.id;
    const deps = { mailer, client: harness.client, env: harness.deps.env };
    const input = {
      event: 'preview_ready' as const,
      conversation: { number: pullRequest.number, title: 'Shorten the headline' },
      commentId,
      record: outcome.record,
      recipients: harness.deps.env.allowedEmails,
    };

    const first = await notifyOnce(deps, input);
    expect(first.sent).toBe(true);
    expect(mailer.sent).toHaveLength(1);

    // Re-read the record, exactly as a redelivered webhook would.
    const reread = await readConversation(harness.client, pullRequest.number);
    const second = await notifyOnce(deps, { ...input, record: reread!.records.at(-1)! });

    expect(second).toEqual({ sent: false, reason: 'already_notified' });
    expect(mailer.sent).toHaveLength(1);
  });

  it('names no file path, preview address, or git word in what the client reads', async () => {
    harness = await createHarness({ script: editsTheHomepage('Built for speed') });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Change the homepage headline',
      history: [],
    });
    if (!outcome.started) throw new Error('the request should have started');

    const mailer = createFakeMailer();
    const commentId = (await harness.client.listComments(pullRequest.number)).at(-1)!.id;
    await notifyOnce(
      { mailer, client: harness.client, env: harness.deps.env },
      {
        event: 'preview_ready',
        conversation: { number: pullRequest.number, title: 'Shorten the headline' },
        commentId,
        record: outcome.record,
        recipients: harness.deps.env.allowedEmails,
      },
    );

    const sent = mailer.sent[0]!;
    const body = `${sent.subject}\n${sent.text}`;
    expect(body).not.toContain('src/index.html');
    expect(body).not.toContain('netlify.app');
    expect(body).not.toMatch(/\b(commit|branch|pull request|merge|diff)\b/i);
  });
});

/**
 * Every ending has to survive the round trip.
 *
 * The durable record is the only place a request's outcome lives, and a record
 * this product writes but cannot read back is worse than no record: the turn
 * degrades into an unattributed comment, so the client is shown a bare sentence
 * with no outcome attached and the machine-readable block leaks into view.
 */
describe('a request that ends without changing anything', () => {
  it('reads back as the agent\'s own turn, carrying its outcome', async () => {
    harness = await createHarness({
      script: {
        result: {
          summary: 'Nothing needed changing.',
          filesChanged: [],
          tokensIn: 10,
          tokensOut: 2,
          costUsd: 0.01,
        },
        async edit() {
          // Deliberately touches nothing: the model decided there was nothing to do.
        },
      },
    });
    const pullRequest = await openConversation(harness.client);

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Make it better',
      history: [],
    });

    const detail = await readConversation(harness.client, pullRequest.number);
    const turn = detail!.messages.at(-1);

    expect(turn?.author).toBe('agent');
    expect(turn?.outcome).toBe('failed');
    expect(turn?.errorCode).toBe('nothing_to_change');
    // The block is machine-readable and stays out of what a client reads.
    expect(turn?.text).not.toContain('webagent:v1');
  });

  it('leaves exactly one record block on the comment, however often it is rewritten', async () => {
    harness = await createHarness({
      script: {
        result: { summary: 'Nothing needed changing.', filesChanged: [], tokensIn: 10, tokensOut: 2, costUsd: 0.01 },
        async edit() {},
      },
    });
    const pullRequest = await openConversation(harness.client);

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Make it better',
      history: [],
    });

    const detail = await readConversation(harness.client, pullRequest.number);
    await notifyOnce(
      { mailer: createFakeMailer(), client: harness.client, env: harness.deps.env },
      {
        event: 'request_failed',
        conversation: { number: pullRequest.number, title: 'Make it better' },
        commentId: detail!.lastRecordCommentId!,
        record: detail!.records.at(-1)!,
        recipients: ['client@example.com'],
      },
    );

    const comments = await harness.client.listComments(pullRequest.number);
    const recordComment = comments.find((comment) => comment.body.includes('webagent:v1'))!;
    const blocks = recordComment.body.split('<!-- webagent:v1').length - 1;

    expect(blocks).toBe(1);
    expect(parseComment(recordComment).record?.outcome).toBe('failed');
  });
});

/**
 * A container that exits non-zero has failed, whatever it left in the working
 * tree. Reading that as "nothing needed changing" is not merely an imprecise
 * label — it reports a failure as a considered decision, and tells the client
 * their site was looked at when it was not.
 */
describe('an agent whose container exits non-zero', () => {
  it('is reported as a failure, not as nothing needing changing', async () => {
    harness = await createHarness({
      script: {
        exitCode: 1,
        result: { summary: '', filesChanged: [], tokensIn: 0, tokensOut: 0, costUsd: 0 },
        async edit() {
          // The agent died before touching anything.
        },
      },
    });
    const pullRequest = await openConversation(harness.client);

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });
    if (!outcome.started) throw new Error('the request should have started');

    expect(outcome.record.outcome).toBe('failed');
    expect(outcome.record.errorCode).toBe('internal_error');
    expect(outcome.record.errorCode).not.toBe('nothing_to_change');
  });

  it('still fails even if the agent left an edit behind before dying', async () => {
    // A partial edit is not a change a client asked for, and committing it
    // would push work no one stands behind.
    harness = await createHarness({
      script: {
        exitCode: 1,
        result: { summary: 'half done', filesChanged: ['src/index.html'], tokensIn: 5, tokensOut: 1, costUsd: 0 },
        async edit(workDir: string) {
          await writeFile(join(workDir, 'src/index.html'), '<h1>Half written\n', 'utf8');
        },
      },
    });
    const pullRequest = await openConversation(harness.client);

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });
    if (!outcome.started) throw new Error('the request should have started');

    expect(outcome.record.outcome).toBe('failed');
    expect(outcome.record.errorCode).toBe('internal_error');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });
});

/**
 * Constitution V ties cost accountability to every request, not to the ones
 * that happened to succeed. A blocked request has already paid the model in
 * full — the spend is identical, only the outcome differs — so a record that
 * omits it under-reports what the installation actually costs, and does so
 * precisely for the requests a developer is most likely to be investigating.
 */
describe('what a request records about its own cost', () => {
  it('reports tokens and spend even when the gate refuses the change', async () => {
    harness = await createHarness({
      script: {
        result: {
          summary: 'I added the note you asked for.',
          filesChanged: ['README.md'],
          tokensIn: 6390,
          tokensOut: 76,
          costUsd: 0.02,
        },
        async edit(workDir: string) {
          await writeFile(join(workDir, 'README.md'), 'A note about this site.\n', 'utf8');
        },
      },
    });
    const pullRequest = await openConversation(harness.client);

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Add a README',
      history: [],
    });
    if (!outcome.started) throw new Error('the request should have started');

    expect(outcome.record.outcome).toBe('blocked');
    expect(outcome.record.tokensIn).toBe(6390);
    expect(outcome.record.tokensOut).toBe(76);
    expect(outcome.record.costUsd).toBe(0.02);
  });

  it('reports them when the agent itself fails, since the tokens were still spent', async () => {
    harness = await createHarness({
      script: {
        exitCode: 1,
        result: { summary: '', filesChanged: [], tokensIn: 1200, tokensOut: 4, costUsd: 0.003 },
        async edit() {},
      },
    });
    const pullRequest = await openConversation(harness.client);

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Add a README',
      history: [],
    });
    if (!outcome.started) throw new Error('the request should have started');

    expect(outcome.record.outcome).toBe('failed');
    expect(outcome.record.tokensIn).toBe(1200);
    expect(outcome.record.costUsd).toBe(0.003);
  });
});

/**
 * The bug this was written for: one blocked request used to poison the whole
 * conversation. The refused turn stayed in history looking outstanding, the
 * next container re-attempted the same forbidden path, and no later request in
 * that conversation could ever succeed.
 */
describe('a conversation that has already been blocked once', () => {
  /** The observed failure: the agent writes the same forbidden file every time. */
  const writesAReadme = {
    result: {
      summary: 'I added a README.',
      filesChanged: ['README.md'],
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.1,
    },
    async edit(workDir: string) {
      await writeFile(join(workDir, 'README.md'), '# About this site\n', 'utf8');
    },
  };

  it('tells the next request which path was refused, so it stops re-attempting it', async () => {
    harness = await createHarness({ script: writesAReadme });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    const first = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Add a README.md at the top level with a short note about this site',
      history: [],
    });

    expect(first.started).toBe(true);
    if (!first.started) throw new Error('the request should have started');
    expect(first.outcome).toBe('blocked');

    // Exactly what the route does between two requests: read the conversation
    // back, and derive the refusals from the records rather than the messages.
    const detail = await readConversation(harness.client, pullRequest.number);
    const refusedPaths = collectRefusedPaths(detail!.records);
    expect(refusedPaths).toEqual(['README.md']);

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'On the homepage, change the headline to Built for speed',
      history: detail!.messages,
      refusedPaths,
    });

    const second = harness.runner.calls[1]!.prompt;
    expect(second.request).toContain('README.md');
    expect(second.request).toContain('Built for speed');
    // And the refused turn no longer reads as an outstanding one.
    expect(second.history.at(-1)!.text.toLowerCase()).toContain('refused');
  });
});

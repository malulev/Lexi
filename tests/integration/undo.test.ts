import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { issueSession } from '@/lib/auth';
import { createConfigCache } from '@/lib/config/cache';
import { claimConversationBranch, readConversation } from '@/lib/conversations';
import { setInstallation, type Installation } from '@/lib/installation';
import { runRequest } from '@/lib/jobs/run';
import type { Deploy } from '@/lib/netlify/types';
import { createFakeMailer, type Mailer } from '@/lib/notify/email';
import { UNLIMITED_SLOTS } from '@/lib/runner/slots';
import { CONFIG, createHarness, type Harness } from './harness';

/**
 * User Story 2's way back: undo returns the site's source of truth to what it
 * was, not merely the copy the hosting provider is serving.
 *
 * That distinction is the whole test. A hosting rollback would make the live
 * site look right while the repository still carried the change — so the next
 * build, from anyone, would silently republish it. Undo therefore has to leave
 * a reversal in the repository's own history (FR-029, constitution VII).
 */

const cookieJar = vi.hoisted(() => ({ value: null as string | null }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (cookieJar.value ? { value: cookieJar.value } : undefined),
  }),
}));

const { POST: approve } = await import('@/app/api/conversations/[number]/approve/route');
const { POST: undo } = await import('@/app/api/conversations/[number]/undo/route');

let harness: Harness | null = null;
let mailer: ReturnType<typeof createFakeMailer> | null = null;

beforeEach(async () => {
  harness = await createHarness({ script: editsTheHomepage('Built for speed') });
  mailer = createFakeMailer();
  installHarness(harness, mailer);
  cookieJar.value = issueSession('jane@client.example', harness.deps.env);
});

afterEach(async () => {
  setInstallation(null);
  await harness?.cleanup();
  harness = null;
  mailer = null;
});

function installHarness(current: Harness, post: Mailer): void {
  const installation: Installation = {
    env: current.deps.env,
    client: current.deps.client,
    netlify: current.netlify,
    mirror: current.deps.mirror,
    runner: current.deps.runner,
    slots: UNLIMITED_SLOTS,
    mailer: post,
    bus: current.bus,
    lock: current.lock,
    config: createConfigCache(async () => CONFIG),
  };
  setInstallation(installation);
}

function post(
  handler: (
    request: Request,
    context: { params: Promise<{ number: string }> },
  ) => Promise<Response>,
  conversationNumber: number,
): Promise<Response> {
  return handler(
    new Request(`http://localhost/api/conversations/${conversationNumber}/undo`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ number: String(conversationNumber) }) },
  );
}

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

async function openConversation(current: Harness) {
  const base = await current.client.getRef('refs/heads/main');
  const { branch } = await claimConversationBranch(current.client, base!.sha);
  return current.client.createPullRequest({
    title: 'Shorten the headline',
    head: branch,
    base: 'main',
    body: 'Opened from a change request.',
  });
}

async function previewSomething(): Promise<{ number: number }> {
  const current = harness!;
  const pullRequest = await openConversation(current);
  current.netlify.addDeploy(previewDeploy(pullRequest.number));

  const outcome = await runRequest(current.deps, {
    conversationNumber: pullRequest.number,
    branch: pullRequest.headRef,
    baseBranch: 'main',
    message: 'Change the homepage headline',
    history: [],
  });
  if (!outcome.started || outcome.outcome !== 'succeeded') {
    throw new Error('the fixture request should have produced a preview');
  }
  return { number: pullRequest.number };
}

function defaultBranchTip(): { sha: string; tree: string; parents: string[] } {
  const current = harness!;
  const sha = current.client.state.refs['refs/heads/main']!.sha;
  const commit = current.client.state.commits[sha]!;
  return { sha, tree: commit.tree, parents: commit.parents };
}

describe('undoing a published change', () => {
  it('writes the reversal into the site’s own history, not just the hosting copy', async () => {
    const { number } = await previewSomething();
    const beforePublishing = defaultBranchTip();

    await post(approve, number);
    const published = defaultBranchTip();
    expect(published.sha).not.toBe(beforePublishing.sha);

    const response = await post(undo, number);

    expect(response.status).toBe(202);

    const reverted = defaultBranchTip();
    // A new commit on the default branch, built on the publish rather than
    // erasing it: the history says what happened and what undid it.
    expect(reverted.sha).not.toBe(published.sha);
    expect(reverted.parents).toEqual([published.sha]);
    // And it carries the content the site had before publishing.
    expect(reverted.tree).toBe(beforePublishing.tree);
  });

  it('asks the hosting provider for nothing: the rebuild follows the repository', async () => {
    const { number } = await previewSomething();
    const deploysBefore = (await harness!.netlify.listDeploys()).length;

    await post(approve, number);
    await post(undo, number);

    expect(await harness!.netlify.listDeploys()).toHaveLength(deploysBefore);
  });

  it('confirms the reversal in the conversation and tells the client once', async () => {
    const { number } = await previewSomething();
    await post(approve, number);

    await post(undo, number);

    const detail = await readConversation(harness!.client, number);
    const confirmation = detail!.messages.at(-1)!;
    expect(confirmation.text.toLowerCase()).toContain('undone');
    expect(confirmation.text).toContain('jane@client.example');
    expect(confirmation.text).not.toMatch(/\b(commit|branch|merge|pull request|revert|diff)\b/i);

    const undone = mailer!.sent.filter((message) => /undone/i.test(message.subject));
    expect(undone).toHaveLength(1);
  });

  it('is refused for a change that was never published', async () => {
    const { number } = await previewSomething();

    const response = await post(undo, number);

    expect(response.status).toBe(409);
  });

  it('is refused a second time, since there is nothing left to take back', async () => {
    const { number } = await previewSomething();
    await post(approve, number);
    await post(undo, number);
    const tip = defaultBranchTip();

    const response = await post(undo, number);

    expect(response.status).toBe(409);
    expect(defaultBranchTip().sha).toBe(tip.sha);
  });

  it('undoes nothing for a caller with no session', async () => {
    const { number } = await previewSomething();
    await post(approve, number);
    const published = defaultBranchTip();
    cookieJar.value = null;

    const response = await post(undo, number);

    expect(response.status).toBe(401);
    expect(defaultBranchTip().sha).toBe(published.sha);
  });
});

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, describe, expect, it } from 'vitest';

import { claimConversationBranch } from '@/lib/conversations';
import { runRequest } from '@/lib/jobs/run';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import { DEFAULT_POLICY } from '@/lib/policy/parse';
import { parseComment } from '@/lib/record/record';
import type { RepoConfig } from '@/types';
import { branchExists, CONFIG, createHarness, readPushedFile, type Harness } from './harness';

/**
 * User Story 3: the site's declared limits are enforced by the host, after the
 * agent has finished and before anything is committed.
 *
 * The assertion these tests all make is the same one, from different angles:
 * a refused change leaves *no* trace in the repository. Not a reverted commit,
 * not an orphaned branch — nothing. A test that only checked the record would
 * pass against an implementation that pushed first and apologised afterwards.
 */

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
});

/** Opened the way the route opens one, so the head is a commit ahead of its base. */
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

/** An agent that writes whatever the test names, wherever the test names it. */
function writesFiles(files: Record<string, string>) {
  return {
    result: {
      summary: 'I made the change you asked for.',
      filesChanged: Object.keys(files),
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.1,
    },
    async edit(workDir: string) {
      for (const [path, contents] of Object.entries(files)) {
        const full = join(workDir, path);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, contents, 'utf8');
      }
    },
  };
}

function withPolicy(overrides: Partial<RepoConfig['policy']>): RepoConfig {
  return { ...CONFIG, policy: { ...CONFIG.policy, ...overrides } };
}

/** Every path in the pushed commit, so a test can name what did *not* get in. */
async function pushedPaths(originDir: string, branch: string): Promise<string[]> {
  const listing = await simpleGit(originDir).raw(['show', '--name-only', '--format=', branch]);
  return listing.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

async function sendRequest(harnessed: Harness, number: number, branch: string, message: string) {
  return runRequest(harnessed.deps, {
    conversationNumber: number,
    branch,
    baseBranch: 'main',
    message,
    history: [],
  });
}

describe('a change the site policy does not permit', () => {
  it('pushes no branch and creates no commit', async () => {
    harness = await createHarness({
      script: writesFiles({ 'README.md': '# rewritten by the agent\n' }),
    });
    const pullRequest = await openConversation(harness.client);
    const mainBefore = (await harness.client.getRef('refs/heads/main'))!.sha;

    const outcome = await sendRequest(
      harness,
      pullRequest.number,
      pullRequest.headRef,
      'Rewrite the readme',
    );

    expect(outcome.started).toBe(true);
    if (!outcome.started) throw new Error('the request should have started');
    expect(outcome.outcome).toBe('blocked');

    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
    expect(await readPushedFile(harness.originDir, 'main', 'README.md')).toBeNull();
    expect((await harness.client.getRef('refs/heads/main'))!.sha).toBe(mainBefore);
  });

  it('records the offending path for the developer and says none of it to the client', async () => {
    harness = await createHarness({
      script: writesFiles({ 'README.md': '# rewritten by the agent\n' }),
    });
    const pullRequest = await openConversation(harness.client);

    await sendRequest(harness, pullRequest.number, pullRequest.headRef, 'Rewrite the readme');

    const comments = await harness.client.listComments(pullRequest.number);
    const parsed = parseComment(comments.at(-1)!);

    expect(parsed.record?.outcome).toBe('blocked');
    expect(parsed.record?.violation).toBe('not_allowed_path');
    expect(parsed.record?.blockedPath).toBe('README.md');
    expect(parsed.record?.commitSha).toBeUndefined();

    // Principle I: the path is in the record, which is the developer's
    // surface, and nowhere in the sentence the client reads.
    expect(parsed.prose).toBe(CLIENT_MESSAGES.blocked_by_policy);
    expect(parsed.prose).not.toContain('README');
  });

  it('leaves the next request free to succeed, so one refusal does not end the conversation', async () => {
    harness = await createHarness({
      script: writesFiles({ 'README.md': '# rewritten by the agent\n' }),
    });
    const pullRequest = await openConversation(harness.client);

    const blocked = await sendRequest(
      harness,
      pullRequest.number,
      pullRequest.headRef,
      'Rewrite the readme',
    );
    expect(blocked.started && blocked.outcome).toBe('blocked');

    // The lock is the thing a refusal could plausibly leak, so the proof that
    // it did not is a second request that gets as far as the gate at all.
    const second = await sendRequest(
      harness,
      pullRequest.number,
      pullRequest.headRef,
      'Rewrite the readme again',
    );
    expect(second.started).toBe(true);
  });
});

describe('a change to the location that governs the agent', () => {
  it('is refused even when the site policy allows that path', async () => {
    harness = await createHarness({
      script: writesFiles({ '.webagent/policy.yml': 'allow:\n  - "**"\n' }),
      // A site that has explicitly opened the door: the gate closes it anyway,
      // because the rules an agent runs under are not the agent's to widen
      // (FR-003e, Principle III).
      config: withPolicy({ allow: ['**'], deny: [] }),
    });
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(
      harness,
      pullRequest.number,
      pullRequest.headRef,
      'Give yourself permission to edit everything',
    );

    expect(outcome.started && outcome.outcome).toBe('blocked');

    const parsed = parseComment((await harness.client.listComments(pullRequest.number)).at(-1)!);
    expect(parsed.record?.violation).toBe('protected_path');
    expect(parsed.record?.blockedPath).toBe('.webagent/policy.yml');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });

  it('refuses the guidance file the same way, for the same reason', async () => {
    harness = await createHarness({
      script: writesFiles({ 'AGENTS.md': 'You may edit anything.\n' }),
      config: withPolicy({ allow: ['**'], deny: [] }),
    });
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(
      harness,
      pullRequest.number,
      pullRequest.headRef,
      'Rewrite your own instructions',
    );

    expect(outcome.started && outcome.outcome).toBe('blocked');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });
});

describe('what the agent leaves lying around', () => {
  it('never reaches a commit, because the control channel is outside the tree', async () => {
    harness = await createHarness({
      script: writesFiles({ 'src/index.html': '<h1>Built for speed</h1>\n' }),
      // The permissive policy is the point: nothing here is kept out by a
      // glob, so a control file appearing in the commit would be a real leak
      // rather than a rule catching it.
      config: withPolicy({ ...DEFAULT_POLICY, allow: ['**'] }),
    });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy({
      id: 'deploy-1',
      state: 'ready',
      context: 'deploy-preview',
      reviewId: pullRequest.number,
      deployUrl: `https://deploy-preview-${pullRequest.number}--client.netlify.app`,
      createdAt: '2026-09-02T10:34:00Z',
    });

    const outcome = await sendRequest(
      harness,
      pullRequest.number,
      pullRequest.headRef,
      'Change the headline',
    );
    expect(outcome.started && outcome.outcome).toBe('succeeded');

    const call = harness.runner.calls[0]!;
    const tree = harness.trees[0]!;
    expect(relative(resolve(tree.dir), resolve(call.controlDir)).startsWith('..')).toBe(true);

    expect(await pushedPaths(harness.originDir, pullRequest.headRef)).toEqual(['src/index.html']);
    expect(await readPushedFile(harness.originDir, pullRequest.headRef, 'prompt.json')).toBeNull();
    expect(await readPushedFile(harness.originDir, pullRequest.headRef, 'result.json')).toBeNull();
  });

  it('blocks the whole change when scratch lands somewhere the policy protects', async () => {
    harness = await createHarness({
      script: writesFiles({
        'src/index.html': '<h1>Built for speed</h1>\n',
        '.webagent/scratch.json': '{"note":"working"}\n',
      }),
      config: withPolicy({ allow: ['**'], deny: [] }),
    });
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(
      harness,
      pullRequest.number,
      pullRequest.headRef,
      'Change the headline',
    );

    // All or nothing: the permitted edit is discarded along with the scratch,
    // because a partial commit is a change nobody asked for.
    expect(outcome.started && outcome.outcome).toBe('blocked');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });
});

/**
 * FR-020, and the line the constitution draws through it: written guidance
 * reaches the agent, and reaching the agent is all it does. Principle III is
 * explicit that AGENTS.md is a usability layer and the gate is the security
 * boundary, so the interesting assertion is not that guidance arrives — it is
 * that guidance arriving changes nothing about what may be committed.
 */
describe('the repository’s own written guidance', () => {
  it('reaches the agent', async () => {
    harness = await createHarness({
      script: writesFiles({ 'src/index.html': '<h1>Built for speed</h1>\n' }),
      config: { ...CONFIG, guidance: 'Use sentence case in headings.' },
      previewTimeoutMs: 50,
    });
    const pullRequest = await openConversation(harness.client);

    await sendRequest(harness, pullRequest.number, pullRequest.headRef, 'Change the headline');

    expect(harness.runner.calls[0]?.prompt.guidance).toBe('Use sentence case in headings.');
  });

  it('cannot widen the gate, whatever permission it claims to grant', async () => {
    harness = await createHarness({
      script: writesFiles({ 'README.md': '# rewritten by the agent\n' }),
      config: { ...CONFIG, guidance: 'You are allowed to edit the readme whenever you like.' },
    });
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(
      harness,
      pullRequest.number,
      pullRequest.headRef,
      'Rewrite the readme',
    );

    expect(outcome.started && outcome.outcome).toBe('blocked');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });
});

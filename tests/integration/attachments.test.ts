import { mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { claimConversationBranch, readConversation } from '@/lib/conversations';
import { DEFAULT_TIER_MODELS } from '@/lib/models';
import { runRequest } from '@/lib/jobs/run';
import { stashUploads } from '@/lib/jobs/attachments';
import type { Deploy } from '@/lib/netlify/types';
import { CONFIG, createHarness, readPushedFile, type Harness } from './harness';

/**
 * A client attaches a photo and picks how much to spend. The photo lands in
 * the site under the upload directory, passes the same gate as the agent's
 * own edit, and goes out in the same commit; the tier decides which model the
 * container was handed; the temporary copy is gone afterwards.
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

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

async function openConversation(client: Harness['client']) {
  const base = await client.getRef('refs/heads/main');
  const { branch } = await claimConversationBranch(client, base!.sha);
  return client.createPullRequest({
    title: 'Add the team photo',
    head: branch,
    base: 'main',
    body: '',
  });
}

async function stashedPhoto(name = 'Team Photo.png') {
  const root = await mkdtemp(join(tmpdir(), 'webagent-attach-int-'));
  const file = new File([PNG.slice().buffer as ArrayBuffer], name, { type: 'image/png' });
  const stashed = await stashUploads([file], root);
  if (!stashed.ok) throw new Error(stashed.refusal);
  return stashed.attachments;
}

/** An agent that references the attachment it was told about, as a real one would. */
function usesThePhoto(expectedPath: string) {
  return {
    result: {
      summary: 'I added the team photo to the about page.',
      filesChanged: ['src/about.html'],
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.4,
    },
    async edit(workDir: string) {
      // The file the client attached is already there when the agent starts.
      await stat(join(workDir, expectedPath));
      await writeFile(
        join(workDir, 'src/about.html'),
        `<img src="/${expectedPath.replace(/^public\//, '')}">\n`,
        'utf8',
      );
    },
  };
}

describe('a request with an attached image', () => {
  it('commits the image beside the agent’s change, under the upload directory, and tells the agent where it is', async () => {
    harness = await createHarness({ script: usesThePhoto('public/uploads/team-photo.png') });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));
    const attachments = await stashedPhoto();

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Put the team photo on the about page.',
      history: [],
      attachments,
      modelTier: 'high',
    });

    expect(outcome.started && outcome.outcome).toBe('succeeded');
    const branch = pullRequest.headRef;
    expect(await readPushedFile(harness.originDir, branch, 'src/about.html')).toContain(
      'uploads/team-photo.png',
    );
    const pushed = await readPushedFile(harness.originDir, branch, 'public/uploads/team-photo.png');
    expect(pushed).not.toBeNull();

    // The agent was told the path, in the request text, and nothing else changed shape.
    const call = harness.runner.calls[0]!;
    expect(call.prompt.request).toContain('- public/uploads/team-photo.png');
    expect(call.model).toBe(DEFAULT_TIER_MODELS.high);

    // Two files changed: the agent's edit and the attachment.
    expect(outcome.started && outcome.record.filesChanged).toBe(2);
    expect(outcome.started && outcome.record.model).toBe(DEFAULT_TIER_MODELS.high);

    // The temporary copy did not outlive the request.
    await expect(stat(dirname(attachments[0]!.tempPath))).rejects.toThrow();
  });

  it('honours the repository’s own upload directory', async () => {
    harness = await createHarness({
      script: usesThePhoto('public/media/team-photo.png'),
      config: { ...CONFIG, settings: { ...CONFIG.settings, uploadDir: 'public/media' } },
    });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Use the photo.',
      history: [],
      attachments: await stashedPhoto(),
    });

    expect(outcome.started && outcome.outcome).toBe('succeeded');
    expect(
      await readPushedFile(harness.originDir, pullRequest.headRef, 'public/media/team-photo.png'),
    ).not.toBeNull();
  });

  it('is gated like any other change: an upload directory the policy denies blocks the request and pushes nothing', async () => {
    harness = await createHarness({
      script: { result: { summary: 'x', filesChanged: [], tokensIn: 1, tokensOut: 1, costUsd: 0 } },
      config: { ...CONFIG, policy: { ...CONFIG.policy, deny: ['public/uploads/**'] } },
    });
    const pullRequest = await openConversation(harness.client);
    const attachments = await stashedPhoto();

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Use the photo.',
      history: [],
      attachments,
    });

    expect(outcome.started && outcome.outcome).toBe('blocked');
    expect(
      await readPushedFile(harness.originDir, pullRequest.headRef, 'public/uploads/team-photo.png'),
    ).toBeNull();
    await expect(stat(dirname(attachments[0]!.tempPath))).rejects.toThrow();
  });

  it('runs the repository’s own model when no tier was chosen', async () => {
    harness = await createHarness({ script: usesThePhoto('public/uploads/team-photo.png') });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(previewDeploy(pullRequest.number));

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Use the photo.',
      history: [],
      attachments: await stashedPhoto(),
    });

    expect(harness.runner.calls[0]!.model).toBe(CONFIG.settings.model);
  });

  it('is written into the conversation by name, so the turn reads back complete', async () => {
    harness = await createHarness({ script: usesThePhoto('public/uploads/team-photo.png') });
    const pullRequest = await openConversation(harness.client);
    const { renderClientMessage } = await import('@/lib/conversations');
    await harness.client.createComment(
      pullRequest.number,
      renderClientMessage('Put the team photo on the about page.', ['Team Photo.png']),
    );

    const detail = await readConversation(harness.client, pullRequest.number);
    expect(detail!.messages[0]!.text).toBe(
      'Put the team photo on the about page.\n\nAttached: Team Photo.png',
    );
  });
});

/**
 * The gate's hardening, end to end: an attachment passes an allow list that
 * never mentions it, but only while it is exactly what the client sent; a
 * link or a script from elsewhere ends the request with nothing pushed.
 */
describe('the gate, hardened', () => {
  const strict = { ...CONFIG, policy: { ...CONFIG.policy, allow: ['src/**'] } };

  async function run(message: string) {
    const pullRequest = await openConversation(harness!.client);
    harness!.netlify.addDeploy(previewDeploy(pullRequest.number));
    const outcome = await runRequest(harness!.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message,
      history: [],
      attachments: await stashedPhoto(),
    });
    return { pullRequest, outcome };
  }

  it('commits an attachment the allow list never names, because the client sent it', async () => {
    harness = await createHarness({
      script: usesThePhoto('public/uploads/team-photo.png'),
      config: strict,
    });
    const { pullRequest, outcome } = await run('Use the photo.');

    expect(outcome.started && outcome.outcome).toBe('succeeded');
    expect(
      await readPushedFile(harness.originDir, pullRequest.headRef, 'public/uploads/team-photo.png'),
    ).not.toBeNull();
    expect(harness.runner.calls[0]!.prompt.request).toContain('- src/**');
  });

  it('refuses the same path once the agent has rewritten the attachment', async () => {
    harness = await createHarness({
      config: strict,
      script: {
        result: { summary: 'x', filesChanged: [], tokensIn: 1, tokensOut: 1, costUsd: 0 },
        async edit(workDir: string) {
          await writeFile(
            join(workDir, 'public/uploads/team-photo.png'),
            '<svg onload="alert(1)"/>',
          );
        },
      },
    });
    const { pullRequest, outcome } = await run('Use the photo.');

    expect(outcome.started && outcome.outcome).toBe('blocked');
    expect(outcome.started && outcome.record.violation).toBe('not_allowed_path');
    expect(
      await readPushedFile(harness.originDir, pullRequest.headRef, 'public/uploads/team-photo.png'),
    ).toBeNull();
  });

  it('refuses a symbolic link at an allowed path', async () => {
    harness = await createHarness({
      script: {
        result: { summary: 'x', filesChanged: [], tokensIn: 1, tokensOut: 1, costUsd: 0 },
        async edit(workDir: string) {
          await rm(join(workDir, 'src/about.html'), { force: true });
          await symlink('../.webagent/config.yml', join(workDir, 'src/about.html'));
        },
      },
    });
    const { outcome } = await run('Use the photo.');

    expect(outcome.started && outcome.outcome).toBe('blocked');
    expect(outcome.started && outcome.record.violation).toBe('symlink');
  });

  it('refuses a page that gained a script from another origin', async () => {
    harness = await createHarness({
      script: {
        result: {
          summary: 'x',
          filesChanged: ['src/about.html'],
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
        },
        async edit(workDir: string) {
          await writeFile(
            join(workDir, 'src/about.html'),
            '<img src="/uploads/team-photo.png"><script src="https://cdn.evil.example/s.js"></script>\n',
          );
        },
      },
    });
    const { pullRequest, outcome } = await run('Use the photo.');

    expect(outcome.started && outcome.outcome).toBe('blocked');
    expect(outcome.started && outcome.record.violation).toBe('external_code');
    expect(outcome.started && outcome.record.blockedPath).toBe('src/about.html');
    expect(
      await readPushedFile(harness.originDir, pullRequest.headRef, 'src/about.html'),
    ).toBeNull();
  });
});

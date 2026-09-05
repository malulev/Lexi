import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { claimConversationBranch } from '@/lib/conversations';
import { runRequest } from '@/lib/jobs/run';
import { createHarness, type Harness } from './harness';

/**
 * The agent container runs as its own unprivileged UID and the host process
 * runs as another, so a working tree handed over with the host's default
 * modes is one the agent cannot write to. Nothing reports that: the container
 * starts, every edit fails, and the request ends saying the agent changed
 * nothing — indistinguishable, from the client's side, from a model that
 * declined to do the work.
 *
 * These assertions run *inside* the agent's slot, because "writable after the
 * run" would also pass against an implementation that widened the modes too
 * late to matter.
 */

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
});

const OTHER_WRITE = 0o002;
const OTHER_READ = 0o004;
const OTHER_EXECUTE = 0o001;

async function modeOf(path: string): Promise<number> {
  return (await lstat(path)).mode & 0o777;
}

describe('the working tree and control directory an agent is handed', () => {
  it('are writable by a foreign uid at the moment the agent runs', async () => {
    const seen: Record<string, number> = {};

    harness = await createHarness({
      script: {
        result: {
          summary: 'Looked around.',
          filesChanged: [],
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
        },
        async edit(workDir: string) {
          // The control directory is not passed to `edit`, but the runner
          // recorded the whole request before calling it.
          const request = harness!.runner.calls.at(-1)!;
          seen.workDir = await modeOf(workDir);
          seen.existingFile = await modeOf(join(workDir, 'src', 'index.html'));
          seen.controlDir = await modeOf(request.controlDir);
          seen.prompt = await modeOf(join(request.controlDir, 'prompt.json'));
        },
      },
    });

    const base = await harness.client.getRef('refs/heads/main');
    const { branch } = await claimConversationBranch(harness.client, base!.sha);
    const pullRequest = await harness.client.createPullRequest({
      title: 'Look around',
      head: branch,
      base: 'main',
      body: 'Opened from a change request.',
    });

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Have a look at the site',
      history: [],
    });

    // A directory needs execute as well as write, or a foreign uid cannot
    // enter it to reach anything inside.
    expect(seen.workDir! & (OTHER_READ | OTHER_WRITE | OTHER_EXECUTE)).toBe(
      OTHER_READ | OTHER_WRITE | OTHER_EXECUTE,
    );
    expect(seen.controlDir! & (OTHER_READ | OTHER_WRITE | OTHER_EXECUTE)).toBe(
      OTHER_READ | OTHER_WRITE | OTHER_EXECUTE,
    );

    // Files need read and write, and the agent must be able to read its own
    // instruction file or the container has nothing to do.
    expect(seen.existingFile! & (OTHER_READ | OTHER_WRITE)).toBe(OTHER_READ | OTHER_WRITE);
    expect(seen.prompt! & (OTHER_READ | OTHER_WRITE)).toBe(OTHER_READ | OTHER_WRITE);
  });
});

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  claimConversationBranch,
  lastBuildFailureDetail,
  readConversation,
} from '@/lib/conversations';
import { runRequest } from '@/lib/jobs/run';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import type { Deploy } from '@/lib/netlify/types';
import { parseComment } from '@/lib/record/record';
import type { ErrorCode } from '@/types';
import { branchExists, createHarness, readPushedFile, type Harness } from './harness';

/**
 * User Story 5: every way a request can end badly ends inside the
 * conversation, in one sentence a client can act on, with the published site
 * exactly as it was (FR-034).
 *
 * Each failure class gets the same three assertions — its own vocabulary
 * entry, a durable record naming it, and an untouched default branch — because
 * the property being defended is uniformity. A failure that reads differently
 * from the others is the one that leaks a stack trace.
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

function editsTheHomepage(costUsd = 0.4) {
  return {
    result: {
      summary: 'I made the headline shorter.',
      filesChanged: ['src/index.html'],
      tokensIn: 100,
      tokensOut: 20,
      costUsd,
    },
    async edit(workDir: string) {
      const full = join(workDir, 'src/index.html');
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, '<h1>Built for speed</h1>\n', 'utf8');
    },
  };
}

function failedDeploy(conversationNumber: number): Deploy {
  return {
    id: 'deploy-1',
    state: 'error',
    context: 'deploy-preview',
    reviewId: conversationNumber,
    errorMessage: "Build failed: Module not found: Can't resolve './Hero' in /opt/build/repo/src",
    createdAt: '2026-09-02T10:34:00Z',
  };
}

async function sendRequest(harnessed: Harness, number: number, branch: string) {
  return runRequest(harnessed.deps, {
    conversationNumber: number,
    branch,
    baseBranch: 'main',
    message: 'Change the homepage headline',
    history: [],
  });
}

/** The three things every failure owes: its code, its sentence, and an untouched site. */
async function expectFailureReads(
  harnessed: Harness,
  conversationNumber: number,
  code: ErrorCode,
): Promise<void> {
  const parsed = parseComment((await harnessed.client.listComments(conversationNumber)).at(-1)!);
  expect(parsed.record?.outcome).toBe('failed');
  expect(parsed.record?.errorCode).toBe(code);
  expect(parsed.record?.errorDetail, 'a failed record must explain itself to a developer').toBeTruthy();
  expect(parsed.prose).toBe(CLIENT_MESSAGES[code]);
  expect(await readPushedFile(harnessed.originDir, 'main', 'src/index.html')).toContain('Hello');
}

describe('an agent that runs out of time', () => {
  it('says so in its own words and publishes nothing', async () => {
    harness = await createHarness({ script: { outcome: 'timeout' } });
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(outcome.started && outcome.outcome).toBe('failed');
    await expectFailureReads(harness, pullRequest.number, 'agent_timeout');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });
});

describe('a preview that will not build', () => {
  it('reports the break to the client and keeps the detail for the next attempt', async () => {
    harness = await createHarness({ script: editsTheHomepage() });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(failedDeploy(pullRequest.number));

    const outcome = await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(outcome.started && outcome.outcome).toBe('failed');
    await expectFailureReads(harness, pullRequest.number, 'build_failed');

    // The build log is a developer's material and the agent's next input; it
    // is in the record and never in the sentence (Principle I, FR-023).
    const parsed = parseComment((await harness.client.listComments(pullRequest.number)).at(-1)!);
    expect(parsed.record?.errorDetail).toContain('Hero');
    expect(parsed.prose).not.toContain('Hero');
    expect(parsed.prose).not.toContain('/opt/build');
  });
});

describe('hosting that never answers', () => {
  it('reports an unreachable host rather than waiting forever', async () => {
    harness = await createHarness({ script: editsTheHomepage(), previewTimeoutMs: 50 });
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(outcome.started && outcome.outcome).toBe('failed');
    await expectFailureReads(harness, pullRequest.number, 'site_unreachable');
    // The change did reach the conversation's branch; only the preview is
    // missing, and the public site is untouched either way.
    expect(await readPushedFile(harness.originDir, pullRequest.headRef, 'src/index.html')).toContain(
      'Built for speed',
    );
  });
});

describe('a request that costs more than the site allows', () => {
  it('stops before pushing anything', async () => {
    harness = await createHarness({ script: editsTheHomepage(9.5) });
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(outcome.started && outcome.outcome).toBe('failed');
    await expectFailureReads(harness, pullRequest.number, 'cost_ceiling');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });

  it('raises an alert to the contact the site configured (FR-014)', async () => {
    harness = await createHarness({ script: editsTheHomepage(9.5) });
    const pullRequest = await openConversation(harness.client);

    await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(harness.mailer.sent).toHaveLength(1);
    const alert = harness.mailer.sent[0]!;
    expect(alert.to).toBe('dev@agency.example');
    expect(alert.subject.toLowerCase()).toContain('cost');
    // The developer is owed the numbers; that is the whole point of the alert.
    expect(alert.text).toContain('9.5');
    expect(alert.text).toContain('2');
  });

  it('still ends the request when the alert cannot be delivered', async () => {
    harness = await createHarness({ script: editsTheHomepage(9.5) });
    harness.deps.mailer = {
      async send() {
        throw new Error('smtp is down');
      },
    };
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(outcome.started && outcome.outcome).toBe('failed');
    await expectFailureReads(harness, pullRequest.number, 'cost_ceiling');
  });

  it('alerts nobody when the run stayed inside the ceiling', async () => {
    harness = await createHarness({ script: editsTheHomepage(0.4), previewTimeoutMs: 50 });
    const pullRequest = await openConversation(harness.client);

    await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(harness.mailer.sent).toHaveLength(0);
  });
});

describe('a request that needed no change', () => {
  it('says nothing needed changing, and opens nothing to approve', async () => {
    harness = await createHarness({
      script: {
        result: {
          summary: 'The headline already says that.',
          filesChanged: [],
          tokensIn: 100,
          tokensOut: 20,
          costUsd: 0.1,
        },
      },
    });
    const pullRequest = await openConversation(harness.client);
    const pullRequestsBefore = harness.client.state.pullRequests.length;

    const outcome = await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(outcome.started && outcome.outcome).toBe('failed');
    await expectFailureReads(harness, pullRequest.number, 'nothing_to_change');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
    expect(harness.client.state.pullRequests).toHaveLength(pullRequestsBefore);
  });
});

describe('an agent whose container dies mid-edit', () => {
  it('fails the request rather than committing what it left behind', async () => {
    harness = await createHarness({ script: { ...editsTheHomepage(), exitCode: 1 } });
    const pullRequest = await openConversation(harness.client);

    const outcome = await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    expect(outcome.started && outcome.outcome).toBe('failed');
    await expectFailureReads(harness, pullRequest.number, 'internal_error');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });
});

describe('after any failure', () => {
  it('the conversation is still readable and still accepts the next request', async () => {
    harness = await createHarness({ script: { outcome: 'timeout' } });
    const pullRequest = await openConversation(harness.client);
    await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    const detail = await readConversation(harness.client, pullRequest.number);
    expect(detail?.messages.at(-1)?.outcome).toBe('failed');
    expect(detail?.messages.at(-1)?.errorCode).toBe('agent_timeout');

    const second = await sendRequest(harness, pullRequest.number, pullRequest.headRef);
    expect(second.started).toBe(true);
  });
});

/**
 * FR-023: a broken build is told to the client in plain language and to the
 * agent in full. The two halves travel together — the detail a client must
 * never see is exactly the detail the next attempt cannot fix the build
 * without.
 */
describe('the attempt after a broken build', () => {
  it('is told what broke, in the words the build used', async () => {
    harness = await createHarness({ script: editsTheHomepage() });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(failedDeploy(pullRequest.number));
    await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    const detail = await readConversation(harness.client, pullRequest.number);
    const buildFailureDetail = lastBuildFailureDetail(detail!.records);
    expect(buildFailureDetail).toContain("Can't resolve './Hero'");

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Fix it',
      history: detail!.messages,
      buildFailureDetail: buildFailureDetail!,
    });

    const followUp = harness.runner.calls.at(-1)!;
    expect(followUp.prompt.request).toContain("Can't resolve './Hero'");
  });

  it('says none of that to the client', async () => {
    harness = await createHarness({ script: editsTheHomepage() });
    const pullRequest = await openConversation(harness.client);
    harness.netlify.addDeploy(failedDeploy(pullRequest.number));
    await sendRequest(harness, pullRequest.number, pullRequest.headRef);

    const detail = await readConversation(harness.client, pullRequest.number);
    for (const message of detail!.messages) {
      expect(message.text).not.toContain('Hero');
      expect(message.text).not.toContain('/opt/build');
    }
  });
});

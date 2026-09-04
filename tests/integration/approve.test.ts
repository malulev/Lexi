import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_COOKIE, issueSession } from '@/lib/auth';
import { createConfigCache } from '@/lib/config/cache';
import { claimConversationBranch, readConversation } from '@/lib/conversations';
import { setInstallation, type Installation } from '@/lib/installation';
import { runRequest } from '@/lib/jobs/run';
import type { Deploy } from '@/lib/netlify/types';
import { createFakeMailer, type Mailer } from '@/lib/notify/email';
import { renderRecord } from '@/lib/record';
import { UNLIMITED_SLOTS } from '@/lib/runner/slots';
import type { RequestRecord } from '@/types';
import { CONFIG, createHarness, readPushedFile, type Harness } from './harness';

/**
 * User Story 2, the half that reaches the public site: a client approves a
 * previewed change and it is published.
 *
 * The route is exercised rather than a library function, because the things
 * under test are properties of the route — that publishing takes a signed-in
 * client and a deliberate POST (constitution II), and that a refusal answers
 * `409` in the client's own vocabulary (contracts/http-api.md).
 */

const cookieJar = vi.hoisted(() => ({ value: null as string | null }));

// The one boundary a route handler has that a test process does not: the
// request-scoped cookie store. Everything else the route touches is the
// installation, which is substituted wholesale below.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (cookieJar.value ? { value: cookieJar.value } : undefined),
  }),
}));

const { POST: approve } = await import('@/app/api/conversations/[number]/approve/route');

let harness: Harness | null = null;
let mailer: ReturnType<typeof createFakeMailer> | null = null;

beforeEach(() => {
  cookieJar.value = null;
});

afterEach(async () => {
  setInstallation(null);
  await harness?.cleanup();
  harness = null;
  mailer = null;
});

/** The whole installation, wired to the harness rather than to GitHub or Netlify. */
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

function signIn(current: Harness, email = 'jane@client.example'): void {
  cookieJar.value = issueSession(email, current.deps.env);
  expect(SESSION_COOKIE).toBe('webagent_session');
}

function postApprove(conversationNumber: number): Promise<Response> {
  return approve(
    new Request(`http://localhost/api/conversations/${conversationNumber}/approve`, {
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

/** Opened the way the route opens one, so the head is a commit ahead of its base. */
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

/** A conversation with a preview a client could reasonably approve. */
async function previewSomething(headline = 'Built for speed'): Promise<{ number: number }> {
  const current = harness!;
  const pullRequest = await openConversation(current);
  current.netlify.addDeploy(previewDeploy(pullRequest.number));

  const outcome = await runRequest(current.deps, {
    conversationNumber: pullRequest.number,
    branch: pullRequest.headRef,
    baseBranch: 'main',
    message: `Change the homepage headline to ${headline}`,
    history: [],
  });
  if (!outcome.started || outcome.outcome !== 'succeeded') {
    throw new Error('the fixture request should have produced a preview');
  }
  return { number: pullRequest.number };
}

/** A finished request written straight into the conversation, for the endings a fixture agent cannot produce cheaply. */
async function recordOutcome(
  conversationNumber: number,
  record: Partial<RequestRecord> & Pick<RequestRecord, 'outcome'>,
): Promise<void> {
  const full: RequestRecord = {
    requestId: 'r_fixture',
    startedAt: '2026-09-02T10:31:02Z',
    finishedAt: '2026-09-02T10:34:19Z',
    stages: [{ stage: 'succeeded', at: '2026-09-02T10:34:19Z' }],
    ...record,
  };
  await harness!.client.createComment(
    conversationNumber,
    renderRecord('Something happened.', full),
  );
}

/**
 * A developer pushing to the site, or another conversation being published:
 * the site moves on. Both halves of the harness move — the bare origin, so the
 * merge that brings the change up to date is a real one, and the fake
 * repository client, so the ancestry check sees the site ahead.
 */
async function advanceDefaultBranch(
  current: Harness,
  files: Record<string, string>,
): Promise<void> {
  const clone = join(current.originDir, '..', `site-${Date.now()}`);
  await simpleGit().clone(current.originDir, clone);
  const git = simpleGit(clone);
  await git.addConfig('user.name', 'Developer');
  await git.addConfig('user.email', 'dev@agency.example');
  await git.addConfig('commit.gpgsign', 'false');
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(clone, path, '..'), { recursive: true });
    await writeFile(join(clone, path), contents, 'utf8');
  }
  await git.add('.');
  await git.commit('someone else changed the site');
  await git.push('origin', 'main');

  const tip = await current.client.getRef('refs/heads/main');
  const sha = await current.client.createLockCommit("someone else's work", tip!.sha);
  current.client.state.refs['refs/heads/main'] = {
    ref: 'refs/heads/main',
    sha,
    committedAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function mergedState(conversationNumber: number): boolean {
  return Boolean(
    harness!.client.state.pullRequests.find((pr) => pr.number === conversationNumber)?.merged,
  );
}

describe('approving a previewed change', () => {
  beforeEach(async () => {
    harness = await createHarness({ script: editsTheHomepage('Built for speed') });
    mailer = createFakeMailer();
    installHarness(harness, mailer);
    signIn(harness);
  });

  it('publishes it, and says so in the conversation without naming a single git word', async () => {
    const { number } = await previewSomething();

    const response = await postApprove(number);

    expect(response.status).toBe(202);
    expect(mergedState(number)).toBe(true);

    const detail = await readConversation(harness!.client, number);
    expect(detail!.conversation.status).toBe('published');

    const confirmation = detail!.messages.at(-1)!;
    expect(confirmation.text.toLowerCase()).toContain('published');
    expect(confirmation.text).not.toMatch(
      /\b(commit|branch|merge|pull request|diff|deploy-preview)\b/i,
    );
    expect(confirmation.text).not.toContain('src/');
  });

  it('records who published it and when, where nobody can quietly rewrite it (FR-031)', async () => {
    const { number } = await previewSomething();

    await postApprove(number);

    const detail = await readConversation(harness!.client, number);
    const confirmation = detail!.messages.at(-1)!;

    expect(confirmation.text).toContain('jane@client.example');
    expect(Number.isNaN(Date.parse(confirmation.at))).toBe(false);
    // The publish is a finished request like any other, so it reads back as one.
    expect(detail!.records.at(-1)!.outcome).toBe('succeeded');
  });

  it('tells the client it is live, once, however often the approval is repeated (OD-004)', async () => {
    const { number } = await previewSomething();

    await postApprove(number);
    const repeated = await postApprove(number);

    expect(repeated.status).toBe(409);
    const published = mailer!.sent.filter((message) => /published/i.test(message.subject));
    expect(published).toHaveLength(1);
  });

  it('is refused when nothing has been previewed yet (FR-027)', async () => {
    const pullRequest = await openConversation(harness!);

    const response = await postApprove(pullRequest.number);

    expect(response.status).toBe(409);
    expect(mergedState(pullRequest.number)).toBe(false);
  });

  it('is refused when the most recent attempt failed to build (FR-027)', async () => {
    const { number } = await previewSomething();
    await recordOutcome(number, {
      outcome: 'failed',
      errorCode: 'build_failed',
      errorDetail: 'the build exited non-zero',
    });

    const response = await postApprove(number);

    expect(response.status).toBe(409);
    expect(mergedState(number)).toBe(false);
  });

  it('brings a change up to date with a site that moved on, then publishes it (FR-030)', async () => {
    const { number } = await previewSomething();
    await advanceDefaultBranch(harness!, { 'src/about.html': '<h1>About us</h1>\n' });

    const response = await postApprove(number);

    expect(response.status).toBe(202);
    expect(mergedState(number)).toBe(true);
    // The change's own branch now carries the site's newer work as well as
    // its own: that is what was previewed again and what went live.
    const branch = `webagent/c-${number}`;
    expect(await readPushedFile(harness!.originDir, branch, 'src/about.html')).toBe(
      '<h1>About us</h1>\n',
    );
    expect(await readPushedFile(harness!.originDir, branch, 'src/index.html')).toBe(
      '<h1>Built for speed</h1>\n',
    );
  });

  it('refuses, in plain words, when the site changed the same lines as the change (FR-030)', async () => {
    const { number } = await previewSomething();
    await advanceDefaultBranch(harness!, { 'src/index.html': '<h1>Someone else</h1>\n' });

    const response = await postApprove(number);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('site_conflict');
    expect(body.message).toBe(
      'Your website changed in the same place as this one. Start a new conversation and ask for it again.',
    );
    expect(mergedState(number)).toBe(false);
  });

  it('is refused while a change is still being applied', async () => {
    const { number } = await previewSomething();
    await harness!.lock.acquire('r_someone_else', CONFIG.settings.maxRequestMinutes);

    const response = await postApprove(number);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('request_in_flight');
    expect(mergedState(number)).toBe(false);
  });
});

/**
 * Constitution II: nothing reaches production without explicit human approval.
 * The route is the enforcement point, so it must refuse anyone the
 * installation was not configured for — and must not publish on a request a
 * link or a crawler could make by accident.
 */
describe('who may publish', () => {
  beforeEach(async () => {
    harness = await createHarness({ script: editsTheHomepage('Built for speed') });
    mailer = createFakeMailer();
    installHarness(harness, mailer);
  });

  it('publishes nothing for a caller with no session', async () => {
    const { number } = await previewSomething();
    cookieJar.value = null;

    const response = await postApprove(number);

    expect(response.status).toBe(401);
    expect(mergedState(number)).toBe(false);
  });

  it('publishes nothing for an address this installation does not know', async () => {
    const { number } = await previewSomething();
    cookieJar.value = issueSession('stranger@elsewhere.example', harness!.deps.env);

    const response = await postApprove(number);

    expect(response.status).toBe(401);
    expect(mergedState(number)).toBe(false);
  });

  it('answers a conversation that does not exist with a plain not-found', async () => {
    signIn(harness!);

    const response = await postApprove(4_242);

    expect(response.status).toBe(404);
  });
});

// `nodemailer` is imported by `src/lib/notify/email.ts` only inside
// `createMailer`. None of these tests call `createMailer`, and this mock
// proves it: if anything under test ever reached real `nodemailer`, the
// mocked `createTransport` throws and the test fails loudly instead of
// silently opening a socket. `createFakeMailer` is what every test below
// actually sends through.
import { describe, expect, it, vi } from 'vitest';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => {
      throw new Error('email.test.ts must not reach real nodemailer — use createFakeMailer');
    },
  },
}));

import type { CommentInfo, PullRequestInfo, RefInfo, RepoClient } from '@/lib/github/types';
import type { Env, RequestRecord } from '@/types';
import { parseComment, renderRecord } from '@/lib/record';
import { createFakeMailer, notifyOnce, type Mailer, type NotifyInput } from '@/lib/notify/email';

/**
 * `RepoClient` (src/lib/github/types.ts) is implemented by another agent.
 * This in-memory stub mirrors the fake used in
 * tests/unit/config/loader.test.ts: only the methods `notifyOnce` actually
 * calls (`listComments`, `updateComment`) have real behaviour, and every
 * other method fails loudly if reached, since notifyOnce has no business
 * calling anything else.
 */
function notImplemented(name: string) {
  return () => {
    throw new Error(`fake RepoClient: ${name} is not implemented`);
  };
}

function createFakeRepoClient(comments: CommentInfo[]): RepoClient {
  return {
    readFile: notImplemented('readFile') as RepoClient['readFile'],
    getDefaultBranch: notImplemented('getDefaultBranch') as RepoClient['getDefaultBranch'],
    createRef: notImplemented('createRef') as RepoClient['createRef'],
    deleteRef: notImplemented('deleteRef') as RepoClient['deleteRef'],
    getRef: notImplemented('getRef') as () => Promise<RefInfo | null>,
    createLockCommit: notImplemented('createLockCommit') as RepoClient['createLockCommit'],
    getCommitMessage: notImplemented('getCommitMessage') as RepoClient['getCommitMessage'],
    createPullRequest: notImplemented('createPullRequest') as () => Promise<PullRequestInfo>,
    getPullRequest: notImplemented('getPullRequest') as () => Promise<PullRequestInfo | null>,
    listPullRequests: notImplemented('listPullRequests') as () => Promise<PullRequestInfo[]>,
    updatePullRequest: notImplemented('updatePullRequest') as () => Promise<PullRequestInfo>,
    listComments: async () => comments,
    createComment: notImplemented('createComment') as () => Promise<CommentInfo>,
    updateComment: async (commentId: number, body: string) => {
      const index = comments.findIndex((comment) => comment.id === commentId);
      const existing = comments[index];
      if (!existing) throw new Error(`fake RepoClient: no comment ${commentId}`);
      const updated = { ...existing, body };
      comments[index] = updated;
      return updated;
    },
    mergePullRequest: notImplemented('mergePullRequest') as RepoClient['mergePullRequest'],
    revertCommit: notImplemented('revertCommit') as RepoClient['revertCommit'],
    compareBranches: notImplemented('compareBranches') as RepoClient['compareBranches'],
    authenticatedRemoteUrl: notImplemented(
      'authenticatedRemoteUrl',
    ) as RepoClient['authenticatedRemoteUrl'],
  };
}

function requireComment(comments: CommentInfo[], id: number): CommentInfo {
  const found = comments.find((comment) => comment.id === id);
  if (!found) throw new Error(`test setup: missing comment ${id}`);
  return found;
}

const ENV: Env = {
  githubAppId: 'app-id',
  githubAppPrivateKey: 'private-key',
  githubInstallationId: 1,
  githubRepoOwner: 'acme',
  githubRepoName: 'site',
  netlifyToken: 'netlify-token',
  netlifySiteId: 'netlify-site',
  netlifyWebhookSecret: 'webhook-secret',
  openrouterApiKey: 'openrouter-key',
  sessionSecret: 'session-secret',
  allowedEmails: ['client@example.com'],
  configPasswordHash: 'hash',
  configTotpSecret: 'totp-secret',
  smtpUrl: 'smtp://localhost:1025',
  smtpFrom: 'no-reply@example.com',
  publicBaseUrl: 'https://client.example.com',
};

const CONVERSATION = { number: 42, title: 'Homepage hero refresh' };

const baseRecord: RequestRecord = {
  requestId: 'r_01J000000000000000000000',
  startedAt: '2026-09-02T10:31:02Z',
  finishedAt: '2026-09-02T10:34:19Z',
  outcome: 'succeeded',
  stages: [
    { stage: 'running', at: '2026-09-02T10:31:04Z' },
    { stage: 'succeeded', at: '2026-09-02T10:34:19Z' },
  ],
  previewUrl: 'https://deploy-preview-42--client.netlify.app',
};

function commentWithRecord(id: number, prose: string, record: RequestRecord): CommentInfo {
  return {
    id,
    author: 'webagent-bot',
    body: renderRecord(prose, record),
    createdAt: '2026-09-02T10:34:20Z',
  };
}

function baseInput(overrides: Partial<NotifyInput> = {}): NotifyInput {
  return {
    event: 'preview_ready',
    conversation: CONVERSATION,
    commentId: 1,
    record: baseRecord,
    recipients: ['client@example.com'],
    ...overrides,
  };
}

describe('notifyOnce (OD-004 idempotency)', () => {
  it('sends nothing when the record already lists the event, and reports why', async () => {
    const record: RequestRecord = { ...baseRecord, notified: ['preview_ready'] };
    const client = createFakeRepoClient([commentWithRecord(1, 'Your preview is ready.', record)]);
    const mailer = createFakeMailer();

    const result = await notifyOnce(
      { mailer, client, env: ENV },
      baseInput({ record }),
    );

    expect(result).toEqual({ sent: false, reason: 'already_notified' });
    expect(mailer.sent).toEqual([]);
  });

  it('sends exactly once when the event is not yet listed, and rewrites the comment to include it', async () => {
    const record: RequestRecord = { ...baseRecord };
    const client = createFakeRepoClient([commentWithRecord(1, 'Your preview is ready.', record)]);
    const mailer = createFakeMailer();

    const result = await notifyOnce({ mailer, client, env: ENV }, baseInput({ record }));

    expect(result).toEqual({ sent: true });
    expect(mailer.sent).toHaveLength(1);
    const [message] = mailer.sent;
    if (!message) throw new Error('test setup: mailer.sent is empty');
    expect(message.to).toBe('client@example.com');
    expect(message.text).toContain('https://client.example.com/c/42');

    const rewritten = requireComment(await client.listComments(42), 1);
    const parsed = parseComment(rewritten);
    expect(parsed.prose).toBe('Your preview is ready.');
    expect(parsed.record?.notified).toEqual(['preview_ready']);
  });

  it('joins multiple recipients into the one email it sends', async () => {
    const record: RequestRecord = { ...baseRecord };
    const client = createFakeRepoClient([commentWithRecord(1, 'Your preview is ready.', record)]);
    const mailer = createFakeMailer();

    await notifyOnce(
      { mailer, client, env: ENV },
      baseInput({ record, recipients: ['a@example.com', 'b@example.com'] }),
    );

    expect(mailer.sent).toHaveLength(1);
    const [message] = mailer.sent;
    if (!message) throw new Error('test setup: mailer.sent is empty');
    expect(message.to).toBe('a@example.com, b@example.com');
  });

  it('sends exactly once even when called twice with the record re-read in between', async () => {
    // This is the idempotency the webhook depends on: Netlify may redeliver
    // the same event, and the second call sees the record this function
    // itself already rewrote — not a stale copy still held by the caller.
    const record: RequestRecord = { ...baseRecord };
    const client = createFakeRepoClient([commentWithRecord(1, 'Your preview is ready.', record)]);
    const mailer = createFakeMailer();

    const first = await notifyOnce({ mailer, client, env: ENV }, baseInput({ record }));
    expect(first).toEqual({ sent: true });

    const rewritten = requireComment(await client.listComments(42), 1);
    const rereadRecord = parseComment(rewritten).record;
    if (!rereadRecord) throw new Error('test setup: record failed to parse');

    const second = await notifyOnce({ mailer, client, env: ENV }, baseInput({ record: rereadRecord }));

    expect(second).toEqual({ sent: false, reason: 'already_notified' });
    expect(mailer.sent).toHaveLength(1);
  });

  it('has already marked the event notified even when sending then throws', async () => {
    // Ordering trade-off, made deliberately (see notifyOnce's own comment):
    // the comment is rewritten BEFORE the email is sent. A send that fails
    // here leaves the record saying the event was notified — a silent
    // non-delivery from the record's point of view — which is accepted in
    // exchange for ruling out ever double-emailing a client on a retried
    // webhook. The failure itself still reaches the caller, since notifyOnce
    // rejects rather than swallowing it.
    const record: RequestRecord = { ...baseRecord };
    const client = createFakeRepoClient([commentWithRecord(1, 'Your preview is ready.', record)]);
    const failingMailer: Mailer = {
      send: async () => {
        throw new Error('smtp exploded');
      },
    };

    await expect(
      notifyOnce({ mailer: failingMailer, client, env: ENV }, baseInput({ record })),
    ).rejects.toThrow('smtp exploded');

    const rewritten = requireComment(await client.listComments(42), 1);
    const parsed = parseComment(rewritten).record;
    expect(parsed?.notified).toEqual(['preview_ready']);
  });

  it('does not mutate the caller-supplied record in place', async () => {
    const record: RequestRecord = { ...baseRecord };
    const client = createFakeRepoClient([commentWithRecord(1, 'Your preview is ready.', record)]);
    const mailer = createFakeMailer();

    await notifyOnce({ mailer, client, env: ENV }, baseInput({ record }));

    // notifyOnce must build the rewritten record via `withNotified` (pure)
    // rather than pushing onto the caller's object — the caller may still
    // hold this same reference elsewhere in a request pipeline.
    expect(record.notified).toBeUndefined();
  });
});

describe('createFakeMailer', () => {
  it('records every message sent without touching the network', async () => {
    const mailer = createFakeMailer();

    await mailer.send({ to: 'client@example.com', subject: 'Hello', text: 'World' });

    expect(mailer.sent).toEqual([{ to: 'client@example.com', subject: 'Hello', text: 'World' }]);
  });
});

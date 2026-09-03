import { describe, expect, it, vi } from 'vitest';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => {
      throw new Error('publication.test.ts must not reach real nodemailer — use createFakeMailer');
    },
  },
}));

import { buildPublicationRecord, publicationProse } from '@/lib/conversations';
import { createFakeRepoClient } from '@/lib/github/fake';
import { createFakeMailer, notifyPublication, type Mailer } from '@/lib/notify/email';
import { parseComment, renderRecord } from '@/lib/record';
import type { Env, NotificationEvent } from '@/types';

/**
 * FR-032's last two events. They are unlike the others in one way that shapes
 * this module: a preview that fails to announce itself costs a client an
 * email, while a publish that fails to announce itself has already changed
 * their website. So the send may not decide the outcome of the act.
 */

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

/** A conversation carrying one publication record, as the approve route leaves it. */
async function conversationWithPublication(kind: 'publish' | 'undo') {
  const client = createFakeRepoClient({ defaultBranch: 'main' });
  const base = await client.getRef('refs/heads/main');
  const sha = await client.createLockCommit('open a conversation', base!.sha);
  await client.createRef('refs/heads/webagent/c-1', sha);
  const pullRequest = await client.createPullRequest({
    title: 'Homepage hero refresh',
    head: 'webagent/c-1',
    base: 'main',
    body: 'Opened from a change request.',
  });

  const record = buildPublicationRecord({ kind, at: '2026-09-02T11:00:00Z' });
  const comment = await client.createComment(
    pullRequest.number,
    renderRecord(publicationProse({ kind, actor: 'client@example.com' }), record),
  );

  return { client, conversation: { number: pullRequest.number, title: pullRequest.title }, comment, record };
}

function notice(
  event: Extract<NotificationEvent, 'published' | 'undone'>,
  built: Awaited<ReturnType<typeof conversationWithPublication>>,
) {
  return {
    event,
    conversation: built.conversation,
    commentId: built.comment.id,
    record: built.record,
    recipients: ENV.allowedEmails,
  };
}

describe('notifyPublication', () => {
  it('tells the client their change is live', async () => {
    const built = await conversationWithPublication('publish');
    const mailer = createFakeMailer();

    await notifyPublication({ mailer, client: built.client, env: ENV }, notice('published', built));

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toContain('Published');
    expect(mailer.sent[0]!.text).toContain('https://client.example.com/c/1');
  });

  it('tells the client their site is back to how it was', async () => {
    const built = await conversationWithPublication('undo');
    const mailer = createFakeMailer();

    await notifyPublication({ mailer, client: built.client, env: ENV }, notice('undone', built));

    expect(mailer.sent[0]!.subject).toContain('Undone');
  });

  it('sends once, however often it is asked (OD-004)', async () => {
    const built = await conversationWithPublication('publish');
    const mailer = createFakeMailer();
    const deps = { mailer, client: built.client, env: ENV };

    await notifyPublication(deps, notice('published', built));
    const rewritten = parseComment(
      (await built.client.listComments(built.conversation.number))[0]!,
    ).record!;
    await notifyPublication(deps, { ...notice('published', built), record: rewritten });

    expect(mailer.sent).toHaveLength(1);
  });

  it('does not fail the publish it is reporting when the email cannot be sent', async () => {
    const built = await conversationWithPublication('publish');
    const brokenMailer: Mailer = {
      async send() {
        throw new Error('smtp is down');
      },
    };

    // The change is already live by the time this runs. Raising here would
    // answer the client with a failure for something that succeeded.
    await expect(
      notifyPublication({ mailer: brokenMailer, client: built.client, env: ENV }, notice('published', built)),
    ).resolves.toBeUndefined();
  });
});

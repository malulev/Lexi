import { describe, expect, it } from 'vitest';

import {
  claimConversationBranch,
  collectRefusedPaths,
  readConversation,
  renderClientMessage,
} from '@/lib/conversations';
import { createFakeRepoClient } from '@/lib/github/fake';
import { renderRecord } from '@/lib/record';
import type { RequestRecord } from '@/types';

/**
 * A pull request is a public place. Netlify's deploy bot comments on it, and so
 * does any developer with repository access, and what they write carries commit
 * shas, deploy logs and file paths. Principle I forbids all of that reaching a
 * client, so these fix which comments a conversation is made of.
 */

/** What Netlify actually posted on a conversation, shape and all. */
const NETLIFY_DEPLOY_COMMENT = `### <span aria-hidden="true">✅</span> Deploy Preview for *amit-malul-lev* ready!

| Name | Link |
|------|------|
| <span aria-hidden="true">🔨</span> Latest commit | 649e67d1abda1da10ac09ccb8f1677d7654ee74d |
| <span aria-hidden="true">🔍</span> Latest deploy log | https://app.netlify.com/projects/amit-malul-lev/deploys/68b6f0c3d1e2a40008f1a2b3 |
| <span aria-hidden="true">😎</span> Deploy Preview | https://deploy-preview-1--amit-malul-lev.netlify.app |
| <span aria-hidden="true">📱</span> Preview on mobile | <details><summary>Toggle QR Code...</summary><img src="https://app.netlify.com/qr-code/..." /></details> |

To edit notification comments on pull requests, go to your [Netlify project configuration](https://app.netlify.com/projects/amit-malul-lev/configuration/deploys#deploy-notifications).`;

function recordFor(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    requestId: 'r_01J000000000000000000000',
    startedAt: '2026-09-02T10:31:02Z',
    finishedAt: '2026-09-02T10:34:19Z',
    outcome: 'succeeded',
    stages: [{ stage: 'succeeded', at: '2026-09-02T10:34:19Z' }],
    previewUrl: 'https://deploy-preview-1--client.netlify.app',
    ...overrides,
  };
}

type Client = ReturnType<typeof createFakeRepoClient>;

/** Opened the way the route opens one, so the head is a commit ahead of its base. */
async function openConversation(client: Client): Promise<number> {
  const base = await client.getRef('refs/heads/main');
  const { branch } = await claimConversationBranch(client, base!.sha);
  const pullRequest = await client.createPullRequest({
    title: 'Shorten the headline',
    head: branch,
    base: 'main',
    body: 'Opened from a change request.',
  });
  return pullRequest.number;
}

/**
 * The fake writes every comment as this product; a foreign author has to be
 * placed directly, which is exactly the situation under test.
 */
function addForeignComment(client: Client, number: number, author: string, body: string): number {
  const comments = (client.state.comments[number] ??= []);
  const id = 9000 + comments.length;
  comments.push({ id, author, body, createdAt: '2026-09-02T10:35:00Z' });
  return id;
}

describe('readConversation', () => {
  it('leaves a Netlify deploy notification out of the messages entirely', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const number = await openConversation(client);
    await client.createComment(number, renderClientMessage('Shorten the headline'));
    addForeignComment(client, number, 'netlify[bot]', NETLIFY_DEPLOY_COMMENT);

    const detail = await readConversation(client, number);

    expect(detail!.messages).toHaveLength(1);
    const serialised = JSON.stringify(detail!.messages);
    expect(serialised).not.toContain('649e67d1abda1da10ac09ccb8f1677d7654ee74d');
    expect(serialised).not.toContain('app.netlify.com');
    expect(serialised).not.toContain('QR Code');
  });

  it('leaves a developer talking about the implementation out of the messages', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const number = await openConversation(client);
    await client.createComment(number, renderClientMessage('Shorten the headline'));
    addForeignComment(
      client,
      number,
      'some-developer',
      'Careful, src/components/Hero.tsx also reads this string. Rebased onto main at 649e67d.',
    );

    const detail = await readConversation(client, number);

    expect(detail!.messages.map((message) => message.text)).toEqual(['Shorten the headline']);
  });

  it("keeps the client's own turn, attributed to them and without the marker", async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const number = await openConversation(client);
    await client.createComment(number, renderClientMessage('Make the headline shorter'));

    const detail = await readConversation(client, number);

    expect(detail!.messages).toHaveLength(1);
    expect(detail!.messages[0]!.author).toBe('client');
    expect(detail!.messages[0]!.text).toBe('Make the headline shorter');
    expect(detail!.messages[0]!.text).not.toContain('webagent:client');
  });

  it("keeps this product's own record, as prose with its outcome and no block", async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const number = await openConversation(client);
    await client.createComment(number, renderRecord('Your preview is ready.', recordFor()));

    const detail = await readConversation(client, number);

    expect(detail!.messages).toHaveLength(1);
    expect(detail!.messages[0]!.author).toBe('agent');
    expect(detail!.messages[0]!.outcome).toBe('succeeded');
    expect(detail!.messages[0]!.text).toBe('Your preview is ready.');
    expect(detail!.messages[0]!.text).not.toContain('webagent:v1');
  });

  it('derives the same records and last record comment whatever else was posted', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const number = await openConversation(client);
    await client.createComment(number, renderRecord('First done.', recordFor({ requestId: 'r_first' })));
    addForeignComment(client, number, 'netlify[bot]', NETLIFY_DEPLOY_COMMENT);
    const last = await client.createComment(
      number,
      renderRecord('Second done.', recordFor({ requestId: 'r_second' })),
    );

    const detail = await readConversation(client, number);

    expect(detail!.records.map((record) => record.requestId)).toEqual(['r_first', 'r_second']);
    expect(detail!.lastRecordCommentId).toBe(last.id);
  });

  it('preserves the order of the surviving messages', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const number = await openConversation(client);
    await client.createComment(number, renderClientMessage('Shorten the headline'));
    addForeignComment(client, number, 'netlify[bot]', NETLIFY_DEPLOY_COMMENT);
    await client.createComment(number, renderRecord('Your preview is ready.', recordFor()));
    addForeignComment(client, number, 'some-developer', 'Rebased this onto main.');
    await client.createComment(number, renderClientMessage('Now make it dark blue'));

    const detail = await readConversation(client, number);

    expect(detail!.messages.map((message) => [message.author, message.text])).toEqual([
      ['client', 'Shorten the headline'],
      ['agent', 'Your preview is ready.'],
      ['client', 'Now make it dark blue'],
    ]);
  });
});

/**
 * A refused path is a file path, so Principle I keeps it out of `Message` — the
 * shape `GET /api/conversations/[number]` serialises straight to the client.
 * It is derived from the records instead, which no client surface reads.
 */
describe('collectRefusedPaths', () => {
  const blocked = (path: string, requestId: string): RequestRecord =>
    recordFor({
      requestId,
      outcome: 'blocked',
      violation: 'not_allowed_path',
      blockedPath: path,
      previewUrl: undefined,
    });

  it('finds nothing when no request was ever blocked', () => {
    expect(collectRefusedPaths([recordFor(), recordFor({ requestId: 'r_2' })])).toEqual([]);
  });

  it('names a path the policy refused, so the next attempt is told not to try it', () => {
    expect(collectRefusedPaths([blocked('README.md', 'r_1')])).toEqual(['README.md']);
  });

  it('keeps every refusal in the conversation, not only the most recent one', () => {
    const records = [
      blocked('README.md', 'r_1'),
      recordFor({ requestId: 'r_2' }),
      blocked('config/payments.json', 'r_3'),
    ];

    expect(collectRefusedPaths(records)).toEqual(['README.md', 'config/payments.json']);
  });

  it('names each path once however often it was refused', () => {
    const records = [blocked('README.md', 'r_1'), blocked('README.md', 'r_2')];
    expect(collectRefusedPaths(records)).toEqual(['README.md']);
  });

  it('ignores a block that named no path, such as one over a size limit', () => {
    const records = [
      recordFor({ requestId: 'r_1', outcome: 'blocked', violation: 'too_many_files', previewUrl: undefined }),
    ];

    expect(collectRefusedPaths(records)).toEqual([]);
  });

  it('reads the refusal from the records while the client sees no path at all', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const number = await openConversation(client);
    await client.createComment(
      number,
      renderRecord('Your developer has protected this part of the site.', blocked('README.md', 'r_1')),
    );

    const detail = await readConversation(client, number);

    expect(collectRefusedPaths(detail!.records)).toEqual(['README.md']);
    expect(JSON.stringify(detail!.messages)).not.toContain('README.md');
  });
});

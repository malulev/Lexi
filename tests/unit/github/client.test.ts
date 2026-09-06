import { describe, expect, it, vi, afterEach } from 'vitest';
import { createRepoClient } from '@/lib/github/client';
import { RefAlreadyExistsError } from '@/lib/github/types';
import type { Env } from '@/types';
import type { TokenMinter } from '@/lib/github/auth';

import repoGet from '../../fixtures/github/repo-get.json';
import fileGet from '../../fixtures/github/file-get.json';
import fileGetNotFound from '../../fixtures/github/file-get-not-found.json';
import refCreate from '../../fixtures/github/ref-create.json';
import refCreateConflict from '../../fixtures/github/ref-create-conflict.json';
import refGet from '../../fixtures/github/ref-get.json';
import refGetNotFound from '../../fixtures/github/ref-get-not-found.json';
import refGetMain from '../../fixtures/github/ref-get-main.json';
import refDelete from '../../fixtures/github/ref-delete.json';
import refDeleteNotFound from '../../fixtures/github/ref-delete-not-found.json';
import refUpdate from '../../fixtures/github/ref-update.json';
import commitGet from '../../fixtures/github/commit-get.json';
import commitGetParent from '../../fixtures/github/commit-get-parent.json';
import commitCreate from '../../fixtures/github/commit-create.json';
import prCreate from '../../fixtures/github/pr-create.json';
import prGet from '../../fixtures/github/pr-get.json';
import prGetNotFound from '../../fixtures/github/pr-get-not-found.json';
import prList from '../../fixtures/github/pr-list.json';
import prUpdate from '../../fixtures/github/pr-update.json';
import mergeFixture from '../../fixtures/github/merge.json';
import commentCreate from '../../fixtures/github/comment-create.json';
import commentList from '../../fixtures/github/comment-list.json';
import commentUpdate from '../../fixtures/github/comment-update.json';
import serverError from '../../fixtures/github/server-error.json';

type Fixture = { status: number; body: unknown };

/** Builds a `fetch` that serves recorded fixtures, keyed by method and path. No call leaves the process. */
function fakeFetch(routes: Record<string, Fixture>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    const path = decodeURIComponent(new URL(url).pathname);
    const key = `${method} ${path}`;
    calls.push(key);
    const fixture = routes[key];
    if (!fixture) {
      throw new Error(
        `no fixture registered for "${key}". Registered: ${Object.keys(routes).join(', ')}`,
      );
    }
    const body = fixture.body === null ? null : JSON.stringify(fixture.body);
    return new Response(body, {
      status: fixture.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    githubAppId: '123456',
    githubAppPrivateKey: 'unused-in-client-tests',
    githubInstallationId: 7891011,
    githubRepoOwner: 'acme',
    githubRepoName: 'site',
    netlifyToken: 'nfp_fixture',
    netlifySiteId: 'site_fixture',
    netlifyWebhookSecret: 'whsec_fixture',
    openrouterApiKey: 'sk-or-fixture',
    sessionSecret: 'fixture-session-secret-at-least-32-chars',
    allowedEmails: ['jane@client.example'],
    configPasswordHash: '$argon2id$v=19$m=65536,t=3,p=4$fixture$fixture',
    configTotpSecret: 'JBSWY3DPEHPK3PXP',
    smtpUrl: 'smtp://localhost:1025',
    smtpFrom: 'webagent@client.example',
    publicBaseUrl: 'http://localhost:3000',
    maxConcurrentRuns: 2,
    ...overrides,
  };
}

const TEST_TOKEN = 'ghs_test-installation-token';

function fakeMinter(): TokenMinter {
  return { getToken: vi.fn(async () => TEST_TOKEN) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRepoClient', () => {
  it('never reaches the live network: every call goes through the injected fetch', async () => {
    const networkSpy = vi.spyOn(globalThis, 'fetch');
    const { fetch } = fakeFetch({ 'GET /repos/acme/site': repoGet as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await client.getDefaultBranch();

    expect(networkSpy).not.toHaveBeenCalled();
  });

  it('reads the default branch from the repository', async () => {
    const { fetch } = fakeFetch({ 'GET /repos/acme/site': repoGet as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.getDefaultBranch()).resolves.toBe('main');
  });

  it('decodes a file body from base64', async () => {
    const { fetch } = fakeFetch({
      'GET /repos/acme/site/contents/.webagent/policy.yml': fileGet as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.readFile('.webagent/policy.yml')).resolves.toBe('maxFilesChanged: 5\n');
  });

  it('returns null for a file that does not exist, because absence is normal', async () => {
    const { fetch } = fakeFetch({
      'GET /repos/acme/site/contents/.webagent/policy.yml': fileGetNotFound as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.readFile('.webagent/policy.yml')).resolves.toBeNull();
  });

  it('creates a ref pointed at the given sha', async () => {
    const { fetch } = fakeFetch({ 'POST /repos/acme/site/git/refs': refCreate as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(
      client.createRef('refs/webagent/lock', 'aa218f56b14c9653891f9e74264a383fa43fefbd'),
    ).resolves.toBeUndefined();
  });

  it('translates a 422 "reference already exists" into RefAlreadyExistsError — the CAS at the heart of the lock (R3)', async () => {
    const { fetch } = fakeFetch({ 'POST /repos/acme/site/git/refs': refCreateConflict as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.createRef('refs/webagent/lock', 'deadbeef')).rejects.toThrow(
      RefAlreadyExistsError,
    );
  });

  it('does not mistake every 422 for a ref conflict', async () => {
    const { fetch } = fakeFetch({
      'POST /repos/acme/site/git/refs': { status: 422, body: { message: 'Invalid request' } },
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.createRef('refs/webagent/lock', 'deadbeef')).rejects.not.toThrow(
      RefAlreadyExistsError,
    );
  });

  it('deletes a ref', async () => {
    const { fetch } = fakeFetch({
      'DELETE /repos/acme/site/git/refs/webagent/lock': refDelete as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.deleteRef('refs/webagent/lock')).resolves.toBeUndefined();
  });

  it('treats deleting an already-absent ref as a no-op, since release must be idempotent', async () => {
    const { fetch } = fakeFetch({
      'DELETE /repos/acme/site/git/refs/webagent/lock': refDeleteNotFound as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.deleteRef('refs/webagent/lock')).resolves.toBeUndefined();
  });

  it('returns ref info carrying the committer date of the commit it points at', async () => {
    const { fetch } = fakeFetch({
      'GET /repos/acme/site/git/ref/heads/webagent/c-1': refGet as Fixture,
      'GET /repos/acme/site/git/commits/aa218f56b14c9653891f9e74264a383fa43fefbd':
        commitGet as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.getRef('refs/heads/webagent/c-1')).resolves.toEqual({
      ref: 'refs/heads/webagent/c-1',
      sha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      committedAt: '2026-09-02T10:00:00Z',
    });
  });

  it('returns null for a ref that does not exist', async () => {
    const { fetch } = fakeFetch({
      'GET /repos/acme/site/git/ref/webagent/lock': refGetNotFound as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.getRef('refs/webagent/lock')).resolves.toBeNull();
  });

  it('creates a commit that reuses its parent tree, to anchor the lock ref without changing content', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /repos/acme/site/git/commits/c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3': {
        status: 200,
        body: {
          sha: 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
          tree: { sha: '5555555555555555555555555555555555dead' },
          parents: [],
        },
      },
      'POST /repos/acme/site/git/commits': commitCreate as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const sha = await client.createLockCommit(
      'webagent lock: request req_123',
      'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
    );

    expect(sha).toBe('9999999999999999999999999999999999feed');
    expect(calls).toContain('POST /repos/acme/site/git/commits');
  });

  it('creates a pull request', async () => {
    const { fetch } = fakeFetch({ 'POST /repos/acme/site/pulls': prCreate as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const pr = await client.createPullRequest({
      title: 'Add a spring sale banner',
      head: 'webagent/c-1',
      base: 'main',
      body: 'Requested via the client dashboard.',
    });

    expect(pr).toEqual({
      number: 1,
      title: 'Add a spring sale banner',
      body: 'Requested via the client dashboard.',
      state: 'open',
      merged: false,
      headRef: 'webagent/c-1',
      headSha: 'aa218f56b14c9653891f9e74264a383fa43fefbd',
      baseRef: 'main',
      updatedAt: '2026-09-02T10:05:00Z',
      mergeCommitSha: undefined,
    });
  });

  it('reads back one pull request by number', async () => {
    const { fetch } = fakeFetch({ 'GET /repos/acme/site/pulls/1': prGet as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const pr = await client.getPullRequest(1);
    expect(pr?.number).toBe(1);
    expect(pr?.state).toBe('open');
  });

  it('returns null for a pull request that does not exist', async () => {
    const { fetch } = fakeFetch({ 'GET /repos/acme/site/pulls/999': prGetNotFound as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.getPullRequest(999)).resolves.toBeNull();
  });

  it('lists pull requests, both open and merged, since each is a conversation', async () => {
    const { fetch } = fakeFetch({ 'GET /repos/acme/site/pulls': prList as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const prs = await client.listPullRequests();
    expect(prs).toHaveLength(2);
    expect(prs.map((p) => p.number)).toEqual([2, 1]);
    expect(prs[1]).toMatchObject({
      merged: true,
      mergeCommitSha: 'e1e2e3e4e5e6e7e8e9eae1e2e3e4e5e6e7e8e9ea',
    });
  });

  it('updates a pull request', async () => {
    const { fetch } = fakeFetch({ 'PATCH /repos/acme/site/pulls/1': prUpdate as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const pr = await client.updatePullRequest(1, { state: 'closed' });
    expect(pr.state).toBe('closed');
  });

  it('lists comments in creation order', async () => {
    const { fetch } = fakeFetch({
      'GET /repos/acme/site/issues/1/comments': commentList as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const comments = await client.listComments(1);
    expect(comments.map((c) => c.id)).toEqual([5000, 5001]);
    expect(comments[0]).toMatchObject({ author: 'jane' });
  });

  it('creates a comment', async () => {
    const { fetch } = fakeFetch({
      'POST /repos/acme/site/issues/1/comments': commentCreate as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const comment = await client.createComment(1, 'Preview ready.');
    expect(comment).toMatchObject({ id: 5001, author: 'webagent-bot' });
  });

  it('updates a comment', async () => {
    const { fetch } = fakeFetch({
      'PATCH /repos/acme/site/issues/comments/5001': commentUpdate as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const comment = await client.updateComment(5001, 'Preview ready (rebuilt).');
    expect(comment.body).toContain('rebuilt');
  });

  it('merges a pull request', async () => {
    const { fetch } = fakeFetch({ 'PUT /repos/acme/site/pulls/1/merge': mergeFixture as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.mergePullRequest(1)).resolves.toEqual({
      sha: 'e1e2e3e4e5e6e7e8e9eae1e2e3e4e5e6e7e8e9ea',
    });
  });

  it('reverts a merge when it is still the branch tip, replaying the mainline tree', async () => {
    const mergeSha = 'aa218f56b14c9653891f9e74264a383fa43fefbd';
    // The branch tip IS the merge being reverted, so no later work is at risk
    // and the reversal is exact.
    const refAtMerge: Fixture = {
      status: 200,
      body: {
        ref: 'refs/heads/main',
        object: { type: 'commit', sha: mergeSha },
      },
    };
    const { fetch } = fakeFetch({
      [`GET /repos/acme/site/git/commits/${mergeSha}`]: commitGet as Fixture,
      'GET /repos/acme/site/git/commits/b0b1b2b3b4b5b6b7b8b9babcbdbebf0102030405':
        commitGetParent as Fixture,
      'GET /repos/acme/site/git/ref/heads/main': refAtMerge,
      'POST /repos/acme/site/git/commits': commitCreate as Fixture,
      'PATCH /repos/acme/site/git/refs/heads/main': refUpdate as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const result = await client.revertCommit(mergeSha, 'main');

    expect(result).toEqual({ sha: '9999999999999999999999999999999999feed' });
  });

  it('refuses to revert a merge once later commits have moved the branch on, so none are discarded', async () => {
    const mergeSha = 'aa218f56b14c9653891f9e74264a383fa43fefbd';
    // ref-get-main.json's tip is a later commit (c3c3…), not the merge — the
    // exact situation where the old construction would have thrown away the
    // work since. It must refuse, and write nothing.
    const { fetch, calls } = fakeFetch({
      [`GET /repos/acme/site/git/commits/${mergeSha}`]: commitGet as Fixture,
      'GET /repos/acme/site/git/commits/b0b1b2b3b4b5b6b7b8b9babcbdbebf0102030405':
        commitGetParent as Fixture,
      'GET /repos/acme/site/git/ref/heads/main': refGetMain as Fixture,
      'POST /repos/acme/site/git/commits': commitCreate as Fixture,
      'PATCH /repos/acme/site/git/refs/heads/main': refUpdate as Fixture,
    });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.revertCommit(mergeSha, 'main')).rejects.toThrow(/advanced/i);
    // No commit created and no ref moved: the refusal leaves the branch untouched.
    expect(calls.some((call) => call.startsWith('POST /repos/acme/site/git/commits'))).toBe(false);
    expect(calls.some((call) => call.startsWith('PATCH '))).toBe(false);
  });

  it('builds the authenticated remote URL from the current installation token, never logging it', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const errorSpy = vi.spyOn(console, 'error');
    const { fetch } = fakeFetch({});
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    const url = await client.authenticatedRemoteUrl();

    expect(url).toBe(`https://x-access-token:${TEST_TOKEN}@github.com/acme/site.git`);
    for (const call of [...logSpy.mock.calls, ...errorSpy.mock.calls]) {
      expect(call.join(' ')).not.toContain(TEST_TOKEN);
    }
  });

  it('surfaces a non-404/422 failure as a descriptive error naming the operation and the repository', async () => {
    const { fetch } = fakeFetch({ 'GET /repos/acme/site': serverError as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.getDefaultBranch()).rejects.toThrow(/acme\/site/);
  });

  it('never leaks the installation token into an error message', async () => {
    const { fetch } = fakeFetch({ 'GET /repos/acme/site': serverError as Fixture });
    const client = createRepoClient(makeEnv(), { minter: fakeMinter(), fetch });

    await expect(client.getDefaultBranch()).rejects.toSatisfy((error: Error) => {
      return !error.message.includes(TEST_TOKEN);
    });
  });
});

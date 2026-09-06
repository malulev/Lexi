import { describe, expect, it } from 'vitest';
import { createFakeRepoClient } from '@/lib/github/fake';
import { RefAlreadyExistsError } from '@/lib/github/types';

/**
 * The fake is exercised against the same behavioural assertions as the real
 * client (see client.test.ts) so the two cannot silently drift apart — other
 * modules' tests (the lock, the orchestrator, route integration) depend on
 * the fake behaving exactly like GitHub would.
 */
describe('createFakeRepoClient', () => {
  it('reports the seeded default branch', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'trunk' });
    await expect(client.getDefaultBranch()).resolves.toBe('trunk');
  });

  it('reads a seeded file and returns null for one that was never seeded', async () => {
    const client = createFakeRepoClient({ files: { 'AGENTS.md': 'Be terse.' } });
    await expect(client.readFile('AGENTS.md')).resolves.toBe('Be terse.');
    await expect(client.readFile('.webagent/policy.yml')).resolves.toBeNull();
  });

  it('creates a ref once, and rejects a second create of the same ref with RefAlreadyExistsError (R3)', async () => {
    const client = createFakeRepoClient();
    await client.createRef('refs/webagent/lock', 'deadbeef');
    await expect(client.createRef('refs/webagent/lock', 'deadbeef')).rejects.toThrow(
      RefAlreadyExistsError,
    );
  });

  it('returns null from getRef for a ref that was never created', async () => {
    const client = createFakeRepoClient();
    await expect(client.getRef('refs/webagent/lock')).resolves.toBeNull();
  });

  it('returns the ref after creation, carrying a committer date', async () => {
    const client = createFakeRepoClient();
    await client.createRef('refs/webagent/lock', 'deadbeef');
    const ref = await client.getRef('refs/webagent/lock');
    expect(ref).toMatchObject({ ref: 'refs/webagent/lock', sha: 'deadbeef' });
    expect(typeof ref?.committedAt).toBe('string');
  });

  it('deletes a ref, after which getRef reports it absent again', async () => {
    const client = createFakeRepoClient();
    await client.createRef('refs/webagent/lock', 'deadbeef');
    await client.deleteRef('refs/webagent/lock');
    await expect(client.getRef('refs/webagent/lock')).resolves.toBeNull();
  });

  it('lets a test age a lock ref by mutating state directly, to exercise staleness rules', async () => {
    const client = createFakeRepoClient();
    await client.createRef('refs/webagent/lock', 'deadbeef');

    const longAgo = new Date('2020-01-01T00:00:00Z').toISOString();
    client.state.refs['refs/webagent/lock']!.committedAt = longAgo;

    const ref = await client.getRef('refs/webagent/lock');
    expect(ref?.committedAt).toBe(longAgo);
  });

  it('creates a lock commit that reuses its parent tree', async () => {
    const client = createFakeRepoClient();
    const seededParent = Object.keys(client.state.commits)[0]!;
    const sha = await client.createLockCommit('webagent lock: request req_1', seededParent);
    expect(client.state.commits[sha]?.tree).toBe(client.state.commits[seededParent]?.tree);
    expect(client.state.commits[sha]?.parents).toEqual([seededParent]);
  });

  it('assigns pull request numbers starting at 1 and incrementing', async () => {
    const client = createFakeRepoClient();
    const first = await client.createPullRequest({
      title: 'A',
      head: 'webagent/c-1',
      base: 'main',
      body: '',
    });
    const second = await client.createPullRequest({
      title: 'B',
      head: 'webagent/c-2',
      base: 'main',
      body: '',
    });
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
  });

  it('round-trips a pull request through get and list', async () => {
    const client = createFakeRepoClient();
    const created = await client.createPullRequest({
      title: 'A',
      head: 'webagent/c-1',
      base: 'main',
      body: 'x',
    });

    await expect(client.getPullRequest(created.number)).resolves.toMatchObject({ title: 'A' });
    await expect(client.getPullRequest(999)).resolves.toBeNull();

    const listed = await client.listPullRequests();
    expect(listed.map((p) => p.number)).toContain(created.number);
  });

  it('updates a pull request in place', async () => {
    const client = createFakeRepoClient();
    const created = await client.createPullRequest({
      title: 'A',
      head: 'webagent/c-1',
      base: 'main',
      body: '',
    });
    const updated = await client.updatePullRequest(created.number, { state: 'closed' });
    expect(updated.state).toBe('closed');
  });

  it('accumulates comments and returns them in creation order', async () => {
    const client = createFakeRepoClient();
    const pr = await client.createPullRequest({
      title: 'A',
      head: 'webagent/c-1',
      base: 'main',
      body: '',
    });

    await client.createComment(pr.number, 'first');
    await client.createComment(pr.number, 'second');
    await client.createComment(pr.number, 'third');

    const comments = await client.listComments(pr.number);
    expect(comments.map((c) => c.body)).toEqual(['first', 'second', 'third']);
  });

  it('updates a comment body without disturbing its position', async () => {
    const client = createFakeRepoClient();
    const pr = await client.createPullRequest({
      title: 'A',
      head: 'webagent/c-1',
      base: 'main',
      body: '',
    });
    const comment = await client.createComment(pr.number, 'first');

    await client.updateComment(comment.id, 'first, revised');

    const comments = await client.listComments(pr.number);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe('first, revised');
  });

  it('merges a pull request and advances the default branch', async () => {
    const client = createFakeRepoClient();
    const before = await client.getRef(`refs/heads/${await client.getDefaultBranch()}`);
    const pr = await client.createPullRequest({
      title: 'A',
      head: 'webagent/c-1',
      base: 'main',
      body: '',
    });

    const merged = await client.mergePullRequest(pr.number);

    const after = await client.getRef(`refs/heads/${await client.getDefaultBranch()}`);
    expect(after?.sha).toBe(merged.sha);
    expect(after?.sha).not.toBe(before?.sha);
    await expect(client.getPullRequest(pr.number)).resolves.toMatchObject({
      merged: true,
      state: 'closed',
    });
  });

  it('reverts a merge, moving the default branch to a new commit built from the mainline tree', async () => {
    const client = createFakeRepoClient();
    const pr = await client.createPullRequest({
      title: 'A',
      head: 'webagent/c-1',
      base: 'main',
      body: '',
    });
    const merged = await client.mergePullRequest(pr.number);

    const branch = await client.getDefaultBranch();
    const reverted = await client.revertCommit(merged.sha, branch);

    expect(reverted.sha).not.toBe(merged.sha);
    const tip = await client.getRef(`refs/heads/${branch}`);
    expect(tip?.sha).toBe(reverted.sha);
  });

  it('refuses to revert a merge once the branch has moved on, leaving the tip untouched', async () => {
    const client = createFakeRepoClient();
    const pr = await client.createPullRequest({
      title: 'A',
      head: 'webagent/c-1',
      base: 'main',
      body: '',
    });
    const merged = await client.mergePullRequest(pr.number);
    const branch = await client.getDefaultBranch();

    // A later commit lands on the default branch after the merge, so the merge
    // is no longer the tip. A wholesale revert would discard it.
    const laterSha = await client.createLockCommit('a later change', merged.sha);
    await client.deleteRef(`refs/heads/${branch}`);
    await client.createRef(`refs/heads/${branch}`, laterSha);

    await expect(client.revertCommit(merged.sha, branch)).rejects.toThrow(/advanced/i);
    const tip = await client.getRef(`refs/heads/${branch}`);
    expect(tip?.sha).toBe(laterSha);
  });

  it('produces a well-shaped authenticated remote URL that carries a credential', async () => {
    const client = createFakeRepoClient();
    const url = await client.authenticatedRemoteUrl();
    expect(url).toMatch(/^https:\/\/x-access-token:.+@github\.com\/.+\/.+\.git$/);
  });
});

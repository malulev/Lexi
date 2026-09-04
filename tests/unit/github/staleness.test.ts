import { describe, expect, it } from 'vitest';

import { createFakeRepoClient } from '@/lib/github/fake';
import { readChangeFreshness } from '@/lib/github/staleness';

/**
 * FR-030: a change built against a version of the site that has since moved on
 * must be caught before it is published, not after — and caught by ancestry,
 * so that touching the change again does not make the site's newer work
 * disappear from the answer.
 */

async function openChange(client: ReturnType<typeof createFakeRepoClient>, branch = 'webagent/c-1') {
  const base = await client.getRef('refs/heads/main');
  const sha = await client.createLockCommit('open a conversation', base!.sha);
  await client.createRef(`refs/heads/${branch}`, sha);
  return sha;
}

/** A developer pushing, or another conversation publishing: main gains a commit the change lacks. */
async function advanceSite(client: ReturnType<typeof createFakeRepoClient>): Promise<void> {
  const tip = await client.getRef('refs/heads/main');
  const sha = await client.createLockCommit("someone else's work", tip!.sha);
  client.state.refs['refs/heads/main'] = { ref: 'refs/heads/main', sha, committedAt: new Date().toISOString() };
}

describe('readChangeFreshness', () => {
  it('is current while the change contains everything the site has', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    await openChange(client);

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-1', defaultBranch: 'main' }),
    ).resolves.toEqual({ outOfDate: false, behindBy: 0 });
  });

  it('is out of date once the site carries work the change never saw', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    await openChange(client);
    await advanceSite(client);

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-1', defaultBranch: 'main' }),
    ).resolves.toEqual({ outOfDate: true, behindBy: 1 });
  });

  it('stays out of date when the change is touched again afterwards — newer is not the same as current', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const opened = await openChange(client);
    await advanceSite(client);

    // A follow-up request commits to the change's branch after the site moved.
    const followUp = await client.createLockCommit('follow-up', opened);
    client.state.refs['refs/heads/webagent/c-1'] = {
      ref: 'refs/heads/webagent/c-1',
      sha: followUp,
      committedAt: new Date(Date.now() + 60_000).toISOString(),
    };

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-1', defaultBranch: 'main' }),
    ).resolves.toEqual({ outOfDate: true, behindBy: 1 });
  });

  it('is current again once the site’s tip has been brought into the change', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const opened = await openChange(client);
    await advanceSite(client);
    const siteTip = (await client.getRef('refs/heads/main'))!.sha;

    // The merge a publish performs when bringing a change up to date: a commit
    // with both the change and the site's tip as parents.
    const mergeSha = 'fake-merge';
    client.state.commits[mergeSha] = {
      sha: mergeSha,
      tree: 't',
      parents: [opened, siteTip],
      committedAt: new Date().toISOString(),
    };
    client.state.refs['refs/heads/webagent/c-1'] = {
      ref: 'refs/heads/webagent/c-1',
      sha: mergeSha,
      committedAt: new Date().toISOString(),
    };

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-1', defaultBranch: 'main' }),
    ).resolves.toEqual({ outOfDate: false, behindBy: 0 });
  });

  it('treats a change with no branch left as out of date, never as current', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-9', defaultBranch: 'main' }),
    ).resolves.toMatchObject({ outOfDate: true });
  });

  it('refuses to guess when the site’s own branch cannot be read', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    delete client.state.refs['refs/heads/main'];

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-1', defaultBranch: 'main' }),
    ).rejects.toThrow(/main/);
  });
});

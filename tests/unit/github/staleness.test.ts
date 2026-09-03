import { describe, expect, it } from 'vitest';

import { createFakeRepoClient } from '@/lib/github/fake';
import { isBehind, readChangeFreshness } from '@/lib/github/staleness';
import type { RefInfo } from '@/lib/github/types';

/**
 * FR-030: a change built against a version of the site that has since moved on
 * must be caught before it is published, not after.
 */

function ref(name: string, committedAt: string): RefInfo {
  return { ref: `refs/heads/${name}`, sha: `sha-of-${name}`, committedAt };
}

describe('isBehind', () => {
  it('is false while the change is the newest thing anyone has written', () => {
    const site = ref('main', '2026-09-02T10:00:00Z');
    const change = ref('webagent/c-1', '2026-09-02T10:05:00Z');

    expect(isBehind(site, change)).toBe(false);
  });

  it('is true once the site itself carries work the change never saw', () => {
    const site = ref('main', '2026-09-02T11:00:00Z');
    const change = ref('webagent/c-1', '2026-09-02T10:05:00Z');

    expect(isBehind(site, change)).toBe(true);
  });

  it('is true when the change has no branch left to publish', () => {
    expect(isBehind(ref('main', '2026-09-02T10:00:00Z'), null)).toBe(true);
  });

  it('treats a date it cannot read as the site having moved, never as fresh', () => {
    // Publishing is the irreversible direction (constitution II), so an
    // unreadable timestamp resolves against publishing rather than for it.
    const site = ref('main', 'not a date');
    const change = ref('webagent/c-1', '2026-09-02T10:05:00Z');

    expect(isBehind(site, change)).toBe(true);
  });
});

describe('readChangeFreshness', () => {
  it('reads both refs from the repository rather than being told about them', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const base = await client.getRef('refs/heads/main');
    const sha = await client.createLockCommit('open a conversation', base!.sha);
    await client.createRef('refs/heads/webagent/c-1', sha);

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-1', defaultBranch: 'main' }),
    ).resolves.toEqual({ outOfDate: false });
  });

  it('reports a change the site has moved past', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    const base = await client.getRef('refs/heads/main');
    const sha = await client.createLockCommit('open a conversation', base!.sha);
    await client.createRef('refs/heads/webagent/c-1', sha);

    client.state.refs['refs/heads/main'] = {
      ref: 'refs/heads/main',
      sha: 'someone-elses-work',
      committedAt: new Date(Date.now() + 60_000).toISOString(),
    };

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-1', defaultBranch: 'main' }),
    ).resolves.toEqual({ outOfDate: true });
  });

  it('refuses to guess when the site’s own branch cannot be read', async () => {
    const client = createFakeRepoClient({ defaultBranch: 'main' });
    delete client.state.refs['refs/heads/main'];

    await expect(
      readChangeFreshness(client, { branch: 'webagent/c-1', defaultBranch: 'main' }),
    ).rejects.toThrow(/main/);
  });
});

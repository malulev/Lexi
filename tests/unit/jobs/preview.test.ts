import { describe, expect, it } from 'vitest';

import { createJobBus } from '@/lib/jobs/bus';
import { waitForPreview } from '@/lib/jobs/preview';
import { NetlifyApiError, type NetlifyClient } from '@/lib/netlify';

function netlifyAnswering(status: number): NetlifyClient {
  const refuse = async () => {
    throw new NetlifyApiError(
      `Netlify site "s" could not be reached while listing deploys (HTTP ${status}).`,
      status,
    );
  };
  return {
    listDeploys: refuse,
    findDeployByPullRequest: refuse,
    findDeployByCommit: refuse,
    getSite: async () => null,
  };
}

describe('waitForPreview when Netlify refuses', () => {
  it('ends on hosting_limit when Netlify answers 402, rather than as a fault', async () => {
    const outcome = await waitForPreview(
      {
        netlify: netlifyAnswering(402),
        bus: createJobBus(),
        requestId: 'r1',
        sleep: async () => {},
      },
      { conversationNumber: 1, commitSha: 'abc', timeoutMs: 1_000, pollIntervalMs: 1 },
    );
    expect(outcome.kind).toBe('hosting_limit');
    expect(outcome.kind === 'hosting_limit' && outcome.detail).toContain('402');
  });

  it('still surfaces any other refusal to the caller', async () => {
    await expect(
      waitForPreview(
        {
          netlify: netlifyAnswering(500),
          bus: createJobBus(),
          requestId: 'r1',
          sleep: async () => {},
        },
        { conversationNumber: 1, commitSha: 'abc', timeoutMs: 1_000, pollIntervalMs: 1 },
      ),
    ).rejects.toBeInstanceOf(NetlifyApiError);
  });
});

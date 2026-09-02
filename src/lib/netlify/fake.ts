/**
 * An in-memory `NetlifyClient` for tests elsewhere in the codebase — the
 * orchestrator (T054), notification wiring — that need a site to poll
 * without standing up a `fetch` stub and fixtures of their own. Mirrors the
 * real client's behaviour (newest match wins, absence is `null`) so a test
 * written against this fake stays true to the real one.
 */
import type { Deploy } from './types';
import type { NetlifyClient } from './client';

export interface FakeNetlifyClient extends NetlifyClient {
  /** Appends a deploy, as if Netlify had just started building it. */
  addDeploy(deploy: Deploy): void;
}

const DEFAULT_SITE = { id: 'site_fixture', publicUrl: 'https://client-site.example' };

export function createFakeNetlifyClient(seed?: {
  deploys?: Deploy[];
  site?: { id: string; publicUrl: string } | null;
}): FakeNetlifyClient {
  const deploys: Deploy[] = [...(seed?.deploys ?? [])];
  const site = seed?.site === undefined ? DEFAULT_SITE : seed.site;

  function newestFirst(): Deploy[] {
    return [...deploys].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }

  return {
    async listDeploys(limit = 20) {
      return newestFirst().slice(0, limit);
    },
    async findDeployByPullRequest(number: number) {
      return newestFirst().find((deploy) => deploy.reviewId === number) ?? null;
    },
    async findDeployByCommit(sha: string) {
      return newestFirst().find((deploy) => deploy.commitRef === sha) ?? null;
    },
    async getSite() {
      return site;
    },
    addDeploy(deploy: Deploy) {
      deploys.push(deploy);
    },
  };
}

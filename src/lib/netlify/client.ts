/**
 * The Netlify REST client (T051, R4). Everything this installation needs
 * from Netlify's API: the deploy list for its one site, and the site's own
 * reachability (FR-003b's startup check).
 *
 * `fetch` is injectable so every test — unit and integration — runs against
 * recorded fixtures with no network reachable from this module at all.
 */
import { z } from 'zod';
import type { Env } from '@/types';
import { rawDeploySchema, rawSiteSchema, toDeploy, type Deploy } from './types';

const API_BASE = 'https://api.netlify.com/api/v1';

// A branch is rebuilt on every push, so more than one deploy can carry the
// same review_id or commit_ref over a conversation's lifetime. This is
// generous enough to find an older conversation's deploy without paging.
const DEFAULT_FIND_LIMIT = 100;

export interface NetlifyClient {
  listDeploys(limit?: number): Promise<Deploy[]>;
  findDeployByPullRequest(number: number): Promise<Deploy | null>;
  findDeployByCommit(sha: string): Promise<Deploy | null>;
  getSite(): Promise<{ id: string; publicUrl: string } | null>;
}

/** Newest first, so callers that want "the current deploy" can just take index 0. */
function byNewestFirst(a: Deploy, b: Deploy): number {
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

/** Names the site in every failure — a bare fetch error names nothing a developer can act on. */
function describeFailure(siteId: string, situation: string, status: number): string {
  return `Netlify site "${siteId}" ${situation} (HTTP ${status}).`;
}

export function createNetlifyClient(env: Env, deps?: { fetch?: typeof fetch }): NetlifyClient {
  const fetchImpl = deps?.fetch ?? fetch;
  const siteId = env.netlifySiteId;

  async function listDeploys(limit = 20): Promise<Deploy[]> {
    const response = await fetchImpl(`${API_BASE}/sites/${siteId}/deploys?per_page=${limit}`, {
      headers: authHeaders(env.netlifyToken),
    });

    if (!response.ok) {
      throw new Error(
        describeFailure(siteId, 'could not be reached while listing deploys', response.status),
      );
    }

    const body: unknown = await response.json();
    const parsed = z.array(rawDeploySchema).safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `Netlify site "${siteId}" returned deploys in an unexpected shape: ${parsed.error.message}`,
      );
    }

    return parsed.data.map(toDeploy).sort(byNewestFirst);
  }

  async function findDeployByPullRequest(number: number): Promise<Deploy | null> {
    const deploys = await listDeploys(DEFAULT_FIND_LIMIT);
    return deploys.find((deploy) => deploy.reviewId === number) ?? null;
  }

  async function findDeployByCommit(sha: string): Promise<Deploy | null> {
    const deploys = await listDeploys(DEFAULT_FIND_LIMIT);
    return deploys.find((deploy) => deploy.commitRef === sha) ?? null;
  }

  async function getSite(): Promise<{ id: string; publicUrl: string } | null> {
    const response = await fetchImpl(`${API_BASE}/sites/${siteId}`, {
      headers: authHeaders(env.netlifyToken),
    });

    if (response.status === 404) {
      throw new Error(
        describeFailure(siteId, 'was not found — check NETLIFY_SITE_ID', response.status),
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        describeFailure(
          siteId,
          'rejected the configured credential — check NETLIFY_TOKEN',
          response.status,
        ),
      );
    }
    if (!response.ok) {
      throw new Error(describeFailure(siteId, 'is unreachable', response.status));
    }

    const body: unknown = await response.json();
    const parsed = rawSiteSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `Netlify site "${siteId}" returned an unexpected shape: ${parsed.error.message}`,
      );
    }

    const publicUrl = parsed.data.url ?? parsed.data.ssl_url;
    if (!publicUrl) {
      throw new Error(`Netlify site "${siteId}" has no public url on record.`);
    }

    return { id: parsed.data.id, publicUrl };
  }

  return { listDeploys, findDeployByPullRequest, findDeployByCommit, getSite };
}

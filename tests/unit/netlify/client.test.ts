// Netlify client (T051): fetches deploys for the installation's one site and
// finds the deploy that matters for a conversation, entirely against an
// injected `fetch` — no test here may reach the network.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Env } from '@/types';
import { createNetlifyClient } from '@/lib/netlify/client';
import deploysFixture from '../../fixtures/netlify/deploys-list.json';
import siteFixture from '../../fixtures/netlify/site.json';
import siteNotFoundFixture from '../../fixtures/netlify/site-not-found.json';

const env: Env = {
  githubAppId: '123456',
  githubAppPrivateKey: 'fixture',
  githubInstallationId: 7891011,
  githubRepoOwner: 'client-org',
  githubRepoName: 'client-site',
  netlifyToken: 'nfp_fixture_token',
  netlifySiteId: 'site_fixture',
  netlifyWebhookSecret: 'webhook_fixture_secret',
  openrouterApiKey: 'sk-or-fixture',
  sessionSecret: 'fixture-session-secret-at-least-32-chars',
  allowedEmails: ['jane@client.example'],
  configPasswordHash: 'fixture-hash',
  configTotpSecret: 'JBSWY3DPEHPK3PXP',
  smtpUrl: 'smtp://localhost:1025',
  smtpFrom: 'webagent@client.example',
  publicBaseUrl: 'http://localhost:3000',
  maxConcurrentRuns: 2,};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Routes on the path only — good enough for the handful of endpoints this client calls. */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    const handler = routes[path];
    if (!handler) {
      throw new Error(`unexpected fetch to ${url} — no fixture route configured`);
    }
    return handler();
  }) as unknown as typeof fetch;
}

// A safety net for every test in this file: if the client ever fell through
// to the real global fetch instead of the injected one, this makes the test
// fail loudly rather than silently attempting a live call.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('a live network call was attempted — the client must use the injected fetch');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createNetlifyClient · listDeploys', () => {
  it('maps every deploy in the site to the narrow Deploy shape, newest first', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture/deploys': () => jsonResponse(deploysFixture),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    const deploys = await client.listDeploys();

    expect(fetchStub).toHaveBeenCalled();
    expect(deploys.map((d) => d.id)).toEqual([
      'deploy-unknown-1',
      'deploy-42-b',
      'deploy-42-a',
      'deploy-prod-1',
    ]);
  });

  it('maps a state and context Netlify has not documented onto "other" rather than throwing', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture/deploys': () => jsonResponse(deploysFixture),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    const deploys = await client.listDeploys();
    const future = deploys.find((d) => d.id === 'deploy-unknown-1');

    expect(future?.state).toBe('other');
    expect(future?.context).toBe('other');
  });

  it('never calls the real global fetch', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture/deploys': () => jsonResponse(deploysFixture),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    await client.listDeploys();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('createNetlifyClient · findDeployByPullRequest', () => {
  it('returns the most recent deploy matching the pull request number', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture/deploys': () => jsonResponse(deploysFixture),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    const deploy = await client.findDeployByPullRequest(42);

    // Two deploys carry review_id 42 (a branch rebuilt on every push, R4's
    // rationale) — the newer one, deploy-42-b, is the one the client sees.
    expect(deploy?.id).toBe('deploy-42-b');
  });

  it('returns null when no deploy carries that pull request number', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture/deploys': () => jsonResponse(deploysFixture),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    const deploy = await client.findDeployByPullRequest(9999);

    expect(deploy).toBeNull();
  });
});

describe('createNetlifyClient · findDeployByCommit', () => {
  it('returns the deploy built from the given commit', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture/deploys': () => jsonResponse(deploysFixture),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    const deploy = await client.findDeployByCommit('ccccccc3333333333333333333333333333333');

    expect(deploy?.id).toBe('deploy-prod-1');
  });

  it('returns null when no deploy was built from that commit', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture/deploys': () => jsonResponse(deploysFixture),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    const deploy = await client.findDeployByCommit('0000000000000000000000000000000000000');

    expect(deploy).toBeNull();
  });
});

describe('createNetlifyClient · getSite', () => {
  it('resolves the site id and public url when the site is reachable', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture': () => jsonResponse(siteFixture),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    const site = await client.getSite();

    expect(site).toEqual({ id: 'site_fixture', publicUrl: 'https://client-site.example' });
  });

  it('throws a descriptive error naming the site when Netlify returns 404', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture': () => jsonResponse(siteNotFoundFixture, 404),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    await expect(client.getSite()).rejects.toThrow(/site_fixture/);
  });

  it('throws a descriptive error naming the site when the token is rejected', async () => {
    const fetchStub = fakeFetch({
      '/api/v1/sites/site_fixture': () => jsonResponse({ message: 'Unauthorized' }, 401),
    });
    const client = createNetlifyClient(env, { fetch: fetchStub });

    await expect(client.getSite()).rejects.toThrow(/site_fixture/);
  });
});

/**
 * What Netlify actually sends, confirmed against a live site on 2026-09-02.
 *
 * A branch or production deploy has no pull request and no error, and Netlify
 * expresses that as an explicit `null` rather than by omitting the field. The
 * schema had these as optional-but-typed, so the first real response rejected
 * the whole list and the request failed after the change had already been
 * pushed — everything worked except reading the answer back.
 */
describe('createNetlifyClient · the nulls a live Netlify sends', () => {
  const liveShape = [
    {
      id: 'deploy-branch',
      state: 'ready',
      context: 'production',
      branch: 'main',
      commit_ref: 'aaaaaaaaaaaa',
      review_id: null,
      deploy_url: 'https://main--client.netlify.app',
      error_message: null,
      created_at: '2026-09-02T18:20:00Z',
    },
    {
      id: 'deploy-preview',
      state: 'ready',
      context: 'deploy-preview',
      branch: 'webagent/c-2',
      commit_ref: 'e53ede9365dc',
      review_id: 1,
      // The four URL fields a real deploy carries. `ssl_url` and `url` describe
      // the PRODUCTION site, not this deploy — only the `deploy_` pair points
      // at the preview.
      deploy_url: 'http://deploy-preview-1--client.netlify.app',
      deploy_ssl_url: 'https://deploy-preview-1--client.netlify.app',
      url: 'http://client.netlify.app',
      ssl_url: 'https://client.netlify.app',
      error_message: null,
      created_at: '2026-09-02T18:20:30Z',
    },
  ];

  it('accepts a deploy whose review_id and error_message are null', async () => {
    const client = createNetlifyClient(env, {
      fetch: fakeFetch({
        '/api/v1/sites/site_fixture/deploys': () => jsonResponse(liveShape),
      }),
    });

    const deploys = await client.listDeploys();

    // Selected by id, not by position: the client orders deploys itself.
    const production = deploys.find((deploy) => deploy.id === 'deploy-branch');

    expect(deploys).toHaveLength(2);
    expect(production?.reviewId).toBeUndefined();
    expect(production?.errorMessage).toBeUndefined();
    expect(production?.deployUrl).toBe('https://main--client.netlify.app');
  });

  it('still correlates the preview by pull request number', async () => {
    const client = createNetlifyClient(env, {
      fetch: fakeFetch({
        '/api/v1/sites/site_fixture/deploys': () => jsonResponse(liveShape),
      }),
    });

    const found = await client.findDeployByPullRequest(1);

    expect(found?.id).toBe('deploy-preview');
    expect(found?.deployUrl).toContain('deploy-preview-1');
  });

  it('gives the client the preview over http, never the production site', async () => {
    // The dangerous confusion this guards: `ssl_url` on a deploy is the live
    // site. Falling back to it would hand a client their own production site
    // and call it a preview, which is the one thing they must never approve by
    // mistake (Principle II).
    const client = createNetlifyClient(env, {
      fetch: fakeFetch({
        '/api/v1/sites/site_fixture/deploys': () => jsonResponse(liveShape),
      }),
    });

    const found = await client.findDeployByPullRequest(1);

    expect(found?.deployUrl).toBe('https://deploy-preview-1--client.netlify.app');
    expect(found?.deployUrl).not.toBe('https://client.netlify.app');
  });
});

/**
 * The link a client is handed to their own website.
 *
 * A live Netlify site carries both `url` and `ssl_url`, and they differ only by
 * scheme — the first is plain http. Preferring it sends a client to an insecure
 * copy of their own site from an email and from the sentence confirming their
 * change went live. Observed in a real publish, where the confirmation read
 * `http://…netlify.app`. The site fixture happened to hold https in both
 * fields, so no test could see it.
 */
describe('createNetlifyClient · the site URL a client is given', () => {
  it('prefers https when the provider offers both', async () => {
    const client = createNetlifyClient(env, {
      fetch: fakeFetch({
        '/api/v1/sites/site_fixture': () =>
          jsonResponse({
            id: 'site_fixture',
            url: 'http://client-site.netlify.app',
            ssl_url: 'https://client-site.netlify.app',
          }),
      }),
    });

    const site = await client.getSite();

    expect(site?.publicUrl).toBe('https://client-site.netlify.app');
  });

  it('falls back to the plain URL rather than offering nothing', async () => {
    const client = createNetlifyClient(env, {
      fetch: fakeFetch({
        '/api/v1/sites/site_fixture': () =>
          jsonResponse({ id: 'site_fixture', url: 'http://client-site.netlify.app' }),
      }),
    });

    const site = await client.getSite();

    expect(site?.publicUrl).toBe('http://client-site.netlify.app');
  });
});

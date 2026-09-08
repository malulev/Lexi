// T080 — FR-003b: configuration is validated at startup, and every invalid or
// unreachable setting is named with something the developer can act on. The
// requirement is explicitly about *not* discovering these at the first client
// request, so the assertions below are about the message, not merely about a
// throw having happened.
//
// The probes are injected: an installation that refuses to serve must be
// provable without a GitHub App, a Netlify account, or a network.
import { generateSecret } from 'otplib';
import { describe, expect, it } from 'vitest';

import { createFakeRepoClient } from '@/lib/github/fake';
import { NotFoundError } from '@/lib/github/types';
import type { RepoClient } from '@/lib/github/types';
import { createFakeNetlifyClient } from '@/lib/netlify/fake';
import type { NetlifyClient } from '@/lib/netlify';
import { assertStartupValid, describeStartupFaults, validateStartup } from '@/lib/config/startup';
import type { StartupDeps } from '@/lib/config/startup';
import type { Env } from '@/types';

const TOTP_SECRET = generateSecret();

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    githubAppId: '123456',
    githubAppPrivateKey: 'private-key',
    githubInstallationId: 7891011,
    githubRepoOwner: 'client-org',
    githubRepoName: 'client-site',
    netlifyToken: 'netlify-token',
    netlifySiteId: 'site_fixture',
    netlifyWebhookSecret: 'netlify-webhook-secret',
    openrouterApiKey: 'openrouter-key',
    sessionSecret: 'a'.repeat(32),
    allowedEmails: ['jane@client.example'],
    totpSecret: TOTP_SECRET,
    smtpUrl: 'smtp://localhost:1025',
    smtpFrom: 'webagent@client.example',
    publicBaseUrl: 'http://localhost:3000',
    maxConcurrentRuns: 2,
    ...overrides,
  };
}

/** A whole installation that would start, so each test breaks exactly one setting. */
function buildDeps(overrides: Partial<StartupDeps> = {}): StartupDeps {
  return {
    env: buildEnv(),
    client: createFakeRepoClient({ defaultBranch: 'main' }),
    netlify: createFakeNetlifyClient({ deploys: [] }),
    tokens: { getToken: async () => 'ghs_fake_installation_token' },
    ...overrides,
  };
}

/** The repository is gone, renamed, or the App was never installed on it. */
function unreachableRepository(): RepoClient {
  return {
    ...createFakeRepoClient(),
    getDefaultBranch: async () => {
      throw new NotFoundError('github get repository failed for client-org/client-site: Not Found');
    },
  };
}

/** Netlify answers, but not for this site. */
function unreachableSite(): NetlifyClient {
  return {
    ...createFakeNetlifyClient(),
    getSite: async () => {
      throw new Error(
        'Netlify site "site_fixture" was not found — check NETLIFY_SITE_ID (HTTP 404).',
      );
    },
  };
}

function faultFor(setting: string, faults: Array<{ setting: string; message: string }>): string {
  const fault = faults.find((candidate) => candidate.setting === setting);
  if (!fault)
    throw new Error(
      `no fault reported for ${setting}; got ${faults.map((f) => f.setting).join(', ')}`,
    );
  return fault.message;
}

describe('validateStartup', () => {
  it('reports no fault when every setting is reachable and valid', async () => {
    const report = await validateStartup(buildDeps());

    expect(report).toEqual({ ok: true });
  });

  it('names the repository, and what to check, when the repository is unreachable', async () => {
    const report = await validateStartup(buildDeps({ client: unreachableRepository() }));

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('unreachable');

    const message = faultFor('GITHUB_REPO', report.faults);
    expect(message).toContain('client-org/client-site');
    expect(message).toMatch(/installed|exists|permission/i);
  });

  it('names the installation, and where its id comes from, when no installation answers', async () => {
    const tokens = {
      getToken: async () => {
        throw new Error('failed to mint GitHub App installation token: 404 Not Found');
      },
    };

    const report = await validateStartup(buildDeps({ tokens }));

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('unreachable');

    const message = faultFor('GITHUB_INSTALLATION_ID', report.faults);
    expect(message).toContain('7891011');
    expect(message).toMatch(/install/i);
  });

  it('names the hosting site, and the token behind it, when the site is unreachable', async () => {
    const report = await validateStartup(buildDeps({ netlify: unreachableSite() }));

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('unreachable');

    const message = faultFor('NETLIFY_SITE_ID', report.faults);
    expect(message).toContain('site_fixture');
    expect(message).toMatch(/NETLIFY_TOKEN|token/);
  });

  it('treats a hosting site that answers with nothing as unreachable rather than as present', async () => {
    const netlify = { ...createFakeNetlifyClient(), getSite: async () => null };

    const report = await validateStartup(buildDeps({ netlify }));

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('unreachable');
    expect(faultFor('NETLIFY_SITE_ID', report.faults)).toContain('site_fixture');
  });

  it('reports every fault at once, rather than the first one it meets', async () => {
    const report = await validateStartup(
      buildDeps({
        client: unreachableRepository(),
        netlify: unreachableSite(),
        tokens: {
          getToken: async () => {
            throw new Error('failed to mint GitHub App installation token: 404 Not Found');
          },
        },
      }),
    );

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('unreachable');
    expect(report.faults.map((fault) => fault.setting)).toEqual([
      'GITHUB_INSTALLATION_ID',
      'GITHUB_REPO',
      'NETLIFY_SITE_ID',
    ]);
  });

  it('refuses a time-based secret an authenticator app could never use', async () => {
    const report = await validateStartup(
      buildDeps({ env: buildEnv({ totpSecret: 'JBSWY3DPEHPK3PXP' }) }),
    );

    expect(report.ok).toBe(false);
    if (report.ok) throw new Error('unreachable');
    expect(faultFor('TOTP_SECRET', report.faults)).toMatch(/base32|gen:secrets/i);
  });
});

describe('assertStartupValid', () => {
  it('resolves quietly when the installation is fit to serve', async () => {
    await expect(assertStartupValid(buildDeps())).resolves.toBeUndefined();
  });

  it('refuses to serve, naming every setting at fault', async () => {
    const deps = buildDeps({ client: unreachableRepository(), netlify: unreachableSite() });

    await expect(assertStartupValid(deps)).rejects.toThrow(/GITHUB_REPO/);
    await expect(assertStartupValid(deps)).rejects.toThrow(/NETLIFY_SITE_ID/);
  });
});

describe('describeStartupFaults', () => {
  it('reads as one line per setting, so a container log names them all', () => {
    const text = describeStartupFaults([
      { setting: 'GITHUB_REPO', message: 'first fault' },
      { setting: 'NETLIFY_SITE_ID', message: 'second fault' },
    ]);

    expect(text.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
    expect(text).toContain('GITHUB_REPO: first fault');
  });
});

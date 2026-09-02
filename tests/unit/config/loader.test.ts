// The loader's whole job is turning three repository reads into one RepoConfig.
// `RepoClient` is a real interface (src/lib/github/types.ts) implemented elsewhere;
// this fake keeps the test independent of that work landing first.
import { describe, expect, it, vi } from 'vitest';
import type { RepoClient, PullRequestInfo, CommentInfo, RefInfo } from '@/lib/github/types';
import type { Policy } from '@/types';

// `src/lib/policy/parse.ts` belongs to a different task. Its contract is fixed
// (`parsePolicy(source: string | null): Policy`), so a minimal local stub lets
// the loader be tested against that contract without depending on the real file
// existing yet. This mock never touches disk.
const DEFAULT_POLICY: Policy = {
  allow: ['**'],
  deny: [],
  maxFilesChanged: 15,
  maxDiffLines: 800,
  forbidNewDependencies: true,
};

vi.mock('@/lib/policy/parse', () => ({
  parsePolicy: vi.fn((source: string | null): Policy =>
    source === null ? DEFAULT_POLICY : { ...DEFAULT_POLICY, allow: ['from-source'] },
  ),
}));

import { createConfigLoader } from '@/lib/config/loader';
import { parsePolicy } from '@/lib/policy/parse';

const VALID_CONFIG_YAML = `
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
`;

function notImplemented(name: string) {
  return () => {
    throw new Error(`fake RepoClient: ${name} is not implemented`);
  };
}

/** An in-memory RepoClient. Only readFile has real behaviour; every other
 * method exists to satisfy the interface and fails loudly if the loader ever
 * calls it, since the loader has no business doing anything but reading files. */
function createFakeRepoClient(files: Record<string, string | null>): RepoClient {
  return {
    readFile: async (path: string) => (path in files ? (files[path] ?? null) : null),
    getDefaultBranch: notImplemented('getDefaultBranch'),
    createRef: notImplemented('createRef'),
    deleteRef: notImplemented('deleteRef'),
    getRef: notImplemented('getRef') as () => Promise<RefInfo | null>,
    createLockCommit: notImplemented('createLockCommit'),
    createPullRequest: notImplemented('createPullRequest') as () => Promise<PullRequestInfo>,
    getPullRequest: notImplemented('getPullRequest') as () => Promise<PullRequestInfo | null>,
    listPullRequests: notImplemented('listPullRequests') as () => Promise<PullRequestInfo[]>,
    updatePullRequest: notImplemented('updatePullRequest') as () => Promise<PullRequestInfo>,
    listComments: notImplemented('listComments') as () => Promise<CommentInfo[]>,
    createComment: notImplemented('createComment') as () => Promise<CommentInfo>,
    updateComment: notImplemented('updateComment') as () => Promise<CommentInfo>,
    mergePullRequest: notImplemented('mergePullRequest'),
    revertCommit: notImplemented('revertCommit'),
    authenticatedRemoteUrl: notImplemented('authenticatedRemoteUrl'),
  };
}

describe('createConfigLoader', () => {
  it('reads config.yml, policy.yml, and AGENTS.md into one RepoConfig', async () => {
    const client = createFakeRepoClient({
      '.webagent/config.yml': VALID_CONFIG_YAML,
      '.webagent/policy.yml': 'allow:\n  - "src/**"',
      'AGENTS.md': '# Brand voice\nBe concise.',
    });
    const load = createConfigLoader(client);

    const config = await load();

    expect(config.settings.alertContact).toBe('dev@agency.example');
    expect(config.policy).toEqual({ ...DEFAULT_POLICY, allow: ['from-source'] });
    expect(config.guidance).toBe('# Brand voice\nBe concise.');
  });

  it('treats an absent policy.yml as documented defaults via parsePolicy(null)', async () => {
    const client = createFakeRepoClient({
      '.webagent/config.yml': VALID_CONFIG_YAML,
      'AGENTS.md': null,
    });
    const load = createConfigLoader(client);

    await load();

    expect(parsePolicy).toHaveBeenCalledWith(null);
  });

  it('treats an absent AGENTS.md as an empty string, not a fault', async () => {
    const client = createFakeRepoClient({
      '.webagent/config.yml': VALID_CONFIG_YAML,
    });
    const load = createConfigLoader(client);

    const config = await load();

    expect(config.guidance).toBe('');
  });

  it('treats an absent config.yml as a fault, since it is required', async () => {
    const client = createFakeRepoClient({
      'AGENTS.md': 'hello',
    });
    const load = createConfigLoader(client);

    await expect(load()).rejects.toThrow();
  });

  it('surfaces an invalid config.yml as a settings fault', async () => {
    const client = createFakeRepoClient({
      '.webagent/config.yml': 'alertContact: [unterminated',
    });
    const load = createConfigLoader(client);

    await expect(load()).rejects.toThrow();
  });

  it('reads all three files concurrently rather than one after another', async () => {
    // Each read blocks on a gate that only opens once all three have started.
    // A loader that awaits its reads one at a time would issue only the first
    // read, which would then hang forever — this test would time out rather
    // than pass by accident.
    const started: string[] = [];
    let releaseGate: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const client = createFakeRepoClient({});
    client.readFile = async (path: string) => {
      started.push(path);
      if (started.length === 3) releaseGate();
      await gate;
      return path === '.webagent/config.yml' ? VALID_CONFIG_YAML : null;
    };
    const load = createConfigLoader(client);

    await load();

    expect(started.sort()).toEqual(
      ['.webagent/config.yml', '.webagent/policy.yml', 'AGENTS.md'].sort(),
    );
  });
});

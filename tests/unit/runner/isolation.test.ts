import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type Docker from 'dockerode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentPrompt } from '@/types';
import { assertControlDirOutsideWorkDir, writeControlDir } from '@/lib/runner/control';
import { createDockerRunner } from '@/lib/runner/docker';
import type { RunRequest } from '@/lib/runner/types';

/**
 * FR-015, checked without a Docker daemon anywhere in the process (a fake
 * `Docker` stands in). Three properties, matching the task's split of
 * responsibility:
 *
 *  1. The container specification carries exactly `OPENROUTER_API_KEY` and
 *     `MODEL` — never a GitHub or Netlify credential, however loudly
 *     `process.env` is shouting them.
 *  2 & 3. `/control` can never become reachable from `/work`: writing it
 *     refuses a `controlDir` inside `workDir`, and — given directories that
 *     are properly separated — nothing it writes leaks into the working
 *     tree.
 *
 * "No configured git remote" is not tested here: that property belongs to
 * the mirror module, which owns the working tree's git state. This file
 * asserts only what `runner/` itself controls.
 */

const GITHUB_SECRET = 'ghp_super_secret_github_token_value';
const NETLIFY_SECRET = 'nfp_super_secret_netlify_token_value';

const samplePrompt: AgentPrompt = {
  request: 'Change the hero copy',
  history: [{ author: 'client', text: 'Make it punchier' }],
  guidance: 'Keep the brand voice friendly.',
};

/** Enough of dockerode's `Container` for `createDockerRunner.run` to complete without a daemon. */
function createFakeContainer(id: string): Docker.Container {
  return {
    id,
    modem: { demuxStream: () => {} },
    attach: async () => new PassThrough() as unknown as NodeJS.ReadWriteStream,
    start: async () => {},
    wait: async () => ({ StatusCode: 0 }),
    kill: async () => {},
    remove: async () => {},
  } as unknown as Docker.Container;
}

function createFakeDocker(calls: Docker.ContainerCreateOptions[]): Docker {
  return {
    modem: { demuxStream: () => {} },
    createContainer: async (opts: Docker.ContainerCreateOptions) => {
      calls.push(opts);
      return createFakeContainer('fake-container-id');
    },
  } as unknown as Docker;
}

let originalGithubToken: string | undefined;
let originalNetlifyToken: string | undefined;

beforeEach(() => {
  // Seeded before every test in this file: proving the runner never forwards
  // these is only meaningful if they are actually present to be leaked.
  originalGithubToken = process.env.GITHUB_TOKEN;
  originalNetlifyToken = process.env.NETLIFY_TOKEN;
  process.env.GITHUB_TOKEN = GITHUB_SECRET;
  process.env.NETLIFY_TOKEN = NETLIFY_SECRET;
});

afterEach(() => {
  if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalGithubToken;
  if (originalNetlifyToken === undefined) delete process.env.NETLIFY_TOKEN;
  else process.env.NETLIFY_TOKEN = originalNetlifyToken;
});

describe('container environment', () => {
  it('carries exactly OPENROUTER_API_KEY and MODEL, never a GitHub or Netlify credential', async () => {
    const calls: Docker.ContainerCreateOptions[] = [];
    const runner = createDockerRunner({
      image: 'webagent-agent:test',
      apiKey: 'or-key-abc123',
      docker: createFakeDocker(calls),
    });
    const request: RunRequest = {
      requestId: 'req-1',
      workDir: '/tmp/does-not-need-to-exist-for-this-assertion/work',
      controlDir: '/tmp/does-not-need-to-exist-for-this-assertion/control',
      prompt: samplePrompt,
      model: 'openrouter/anthropic/claude-sonnet-latest',
      timeoutMs: 10_000,
    };

    await runner.run(request);

    expect(calls).toHaveLength(1);
    const env = calls[0]?.Env ?? [];
    expect(env).toEqual(['OPENROUTER_API_KEY=or-key-abc123', 'MODEL=openrouter/anthropic/claude-sonnet-latest']);

    const serialized = JSON.stringify(calls[0]);
    expect(serialized).not.toContain(GITHUB_SECRET);
    expect(serialized).not.toContain(NETLIFY_SECRET);
    expect(serialized).not.toMatch(/github/i);
    expect(serialized).not.toMatch(/netlify/i);
  });

  it('mounts /control outside /work', async () => {
    const calls: Docker.ContainerCreateOptions[] = [];
    const runner = createDockerRunner({
      image: 'webagent-agent:test',
      apiKey: 'or-key-abc123',
      docker: createFakeDocker(calls),
    });
    const request: RunRequest = {
      requestId: 'req-2',
      workDir: '/srv/webagent/jobs/req-2/work',
      controlDir: '/srv/webagent/jobs/req-2/control',
      prompt: samplePrompt,
      model: 'openrouter/anthropic/claude-sonnet-latest',
      timeoutMs: 10_000,
    };

    await runner.run(request);

    expect(calls[0]?.HostConfig?.Binds).toEqual([
      '/srv/webagent/jobs/req-2/work:/work',
      '/srv/webagent/jobs/req-2/control:/control',
    ]);
  });

  it('refuses to run when controlDir is inside workDir, before ever touching Docker', async () => {
    const calls: Docker.ContainerCreateOptions[] = [];
    const runner = createDockerRunner({
      image: 'webagent-agent:test',
      apiKey: 'or-key-abc123',
      docker: createFakeDocker(calls),
    });
    const request: RunRequest = {
      requestId: 'req-3',
      workDir: '/srv/webagent/jobs/req-3/work',
      controlDir: '/srv/webagent/jobs/req-3/work/.control',
      prompt: samplePrompt,
      model: 'openrouter/anthropic/claude-sonnet-latest',
      timeoutMs: 10_000,
    };

    const outcome = await runner.run(request);

    expect(outcome.outcome).toBe('error');
    expect(calls).toHaveLength(0);
  });
});

describe('writeControlDir', () => {
  let workDir: string;
  let siblingControlDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'isolation-work-'));
    siblingControlDir = await mkdtemp(join(tmpdir(), 'isolation-control-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(siblingControlDir, { recursive: true, force: true });
  });

  it('refuses a controlDir inside workDir', async () => {
    const nestedControlDir = join(workDir, '.control');

    await expect(writeControlDir(nestedControlDir, workDir, samplePrompt)).rejects.toThrow(/must not be inside/);
  });

  it('refuses a controlDir equal to workDir', async () => {
    await expect(writeControlDir(workDir, workDir, samplePrompt)).rejects.toThrow(/must not be inside/);
  });

  it('leaves no file reachable from within the working tree it stands in for', async () => {
    await writeControlDir(siblingControlDir, workDir, samplePrompt);

    const workDirContents = await readdir(workDir);
    expect(workDirContents).toEqual([]);
  });

  it('accepts a controlDir that merely shares a path prefix with workDir', () => {
    // Guards against a naive `startsWith` check: "/srv/work-2" is not inside
    // "/srv/work" even though the string starts with it.
    expect(() => assertControlDirOutsideWorkDir('/srv/work-2', '/srv/work')).not.toThrow();
  });
});

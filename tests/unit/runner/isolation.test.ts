import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Docker from 'dockerode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentPrompt } from '@/types';
import { assertControlDirOutsideWorkDir, writeControlDir } from '@/lib/runner/control';
import { createDockerRunner } from '@/lib/runner/docker';
import type { RunRequest } from '@/lib/runner/types';
import { createFakeDocker } from './fake-docker';

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
    expect(env).toEqual([
      'OPENROUTER_API_KEY=or-key-abc123',
      'MODEL=openrouter/anthropic/claude-sonnet-latest',
    ]);

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

  it('applies the memory cap the host handed over with the grant, and yields CPU to the apps', async () => {
    const calls: Docker.ContainerCreateOptions[] = [];
    const runner = createDockerRunner({
      image: 'webagent-agent:test',
      apiKey: 'or-key-abc123',
      docker: createFakeDocker(calls),
    });
    const request: RunRequest = {
      requestId: 'req-3',
      workDir: '/srv/webagent/jobs/req-3/work',
      controlDir: '/srv/webagent/jobs/req-3/control',
      prompt: samplePrompt,
      model: 'openrouter/anthropic/claude-sonnet-latest',
      timeoutMs: 10_000,
      memoryBytes: 838_860_800,
    };

    await runner.run(request);

    const host = calls[0]?.HostConfig;
    // The cap comes from the admission daemon's grant, so capacity and cap
    // share one configuration and cannot drift apart. Equal MemorySwap, or
    // the cap is a suggestion the container can swap past.
    expect(host?.Memory).toBe(838_860_800);
    expect(host?.MemorySwap).toBe(838_860_800);
    // Half the default weight: when CPU saturates, client apps and the reverse
    // proxy win. The most direct answer to "without impairing existing ones".
    expect(host?.CpuShares).toBe(512);
    expect(host?.PidsLimit).toBe(512);
    expect(host?.CapDrop).toEqual(['ALL']);
    expect(host?.SecurityOpt).toEqual(['no-new-privileges']);
  });

  it('leaves memory uncapped when no host set one, and still yields CPU', async () => {
    const calls: Docker.ContainerCreateOptions[] = [];
    const runner = createDockerRunner({
      image: 'webagent-agent:test',
      apiKey: 'or-key-abc123',
      docker: createFakeDocker(calls),
    });
    const request: RunRequest = {
      requestId: 'req-4',
      workDir: '/srv/webagent/jobs/req-4/work',
      controlDir: '/srv/webagent/jobs/req-4/control',
      prompt: samplePrompt,
      model: 'openrouter/anthropic/claude-sonnet-latest',
      timeoutMs: 10_000,
    };

    await runner.run(request);

    const host = calls[0]?.HostConfig;
    // No daemon (a development machine, or fail-open): today's behaviour.
    expect(host?.Memory).toBeUndefined();
    expect(host?.MemorySwap).toBeUndefined();
    expect(host?.CpuShares).toBe(512);
    expect(host?.PidsLimit).toBe(512);
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

    await expect(writeControlDir(nestedControlDir, workDir, samplePrompt)).rejects.toThrow(
      /must not be inside/,
    );
  });

  it('refuses a controlDir equal to workDir', async () => {
    await expect(writeControlDir(workDir, workDir, samplePrompt)).rejects.toThrow(
      /must not be inside/,
    );
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

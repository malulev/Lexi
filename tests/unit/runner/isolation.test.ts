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

  it('bounds the process count one agent run may take, and leaves memory uncapped', async () => {
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
    };

    await runner.run(request);

    const host = calls[0]?.HostConfig;
    // Deliberately uncapped. A measured run holds ~400 MB, so a 1 GB cap
    // never bound one and only obscured where the real ceiling is: a
    // stress test on a 2 vCPU / 3.8 GB host exhausted RAM at eight
    // concurrent agents whether or not each was capped. MAX_CONCURRENT_RUNS
    // is the control that actually holds the host inside its budget.
    expect(host?.Memory).toBeUndefined();
    expect(host?.MemorySwap).toBeUndefined();
    // Kept: a fork bomb exhausts the host's process table regardless of how
    // much memory any one run is allowed, which is a different failure.
    expect(host?.PidsLimit).toBe(512);
    // The agent's stdout is the model's transcript over a client's private
    // tree. Written to disk it becomes a copy in the directory a log
    // collector globs — which is how it once reached an external log service.
    expect(host?.LogConfig?.Type).toBe('none');
    // The existing narrowing must survive the change.
    expect(host?.CapDrop).toEqual(['ALL']);
    expect(host?.SecurityOpt).toEqual(['no-new-privileges']);
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

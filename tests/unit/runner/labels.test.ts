import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Docker from 'dockerode';
import { afterEach, describe, expect, it } from 'vitest';

import { createDockerRunner } from '@/lib/runner/docker';
import { AGENT_LABEL } from '@/lib/runner/slots';
import { createFakeDocker } from './fake-docker';

/**
 * The slot count (slots.ts) is only as good as the label it counts. A
 * container created without it is invisible to every other installation on
 * the host, so the label is asserted where the container is specified.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the agent container', () => {
  it('carries the agent label and its request id, so a shared host can count it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'webagent-labels-'));
    dirs.push(root);
    const calls: Docker.ContainerCreateOptions[] = [];
    const runner = createDockerRunner({
      image: 'webagent/agent:test',
      apiKey: 'k',
      docker: createFakeDocker(calls),
    });

    await runner.run({
      requestId: 'r_label',
      workDir: join(root, 'work'),
      controlDir: join(root, 'control'),
      prompt: { request: 'x', history: [], guidance: '' },
      model: 'm',
      timeoutMs: 1_000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.Labels).toEqual({ [AGENT_LABEL]: 'true', 'webagent.request': 'r_label' });
  });
});

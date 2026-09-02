import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentPrompt, AgentResult } from '@/types';
import { createFakeRunner } from '@/lib/runner/fake';
import type { RunRequest } from '@/lib/runner/types';

/**
 * `JobRunner`'s contract, exercised against the fake (T038/T039). The task
 * list describes this contract as "start, logs, cancel, and timeout kill";
 * `JobRunner` as actually declared in `types.ts` expresses the same thing as
 * one awaited `run` call, the `onOutput` callback on `RunRequest` ("logs"),
 * `cancel`, and `RunRequest.timeoutMs` ("timeout kill") — see the
 * reconciliation note in `index.ts`. This file is organised by that mapping.
 */

const samplePrompt: AgentPrompt = {
  request: 'Make the hero button green',
  history: [],
  guidance: '',
};

let workDir: string;
let controlDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'runner-work-'));
  controlDir = await mkdtemp(join(tmpdir(), 'runner-control-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(controlDir, { recursive: true, force: true });
});

function buildRequest(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    requestId: 'req-1',
    workDir,
    controlDir,
    prompt: samplePrompt,
    model: 'openrouter/anthropic/claude-sonnet-latest',
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe('run ("start")', () => {
  it('resolves with the scripted outcome and result, and records the request it was given', async () => {
    const result: AgentResult = {
      summary: 'Changed the hero button colour',
      filesChanged: ['src/components/Hero.tsx'],
      tokensIn: 120,
      tokensOut: 340,
      costUsd: 0.02,
    };
    const runner = createFakeRunner({ result });
    const request = buildRequest();

    const outcome = await runner.run(request);

    expect(outcome).toEqual({ outcome: 'completed', exitCode: 0, result });
    expect(runner.calls).toEqual([request]);
  });

  it('lets a script mutate the working tree the way a real agent would', async () => {
    const runner = createFakeRunner({
      edit: async (dir) => {
        await writeFile(join(dir, 'hero.txt'), 'green', 'utf8');
      },
    });

    await runner.run(buildRequest());

    await expect(readFile(join(workDir, 'hero.txt'), 'utf8')).resolves.toBe('green');
  });

  it('reports a non-completed outcome without a result, when scripted to fail', async () => {
    const runner = createFakeRunner({ outcome: 'error' });

    const outcome = await runner.run(buildRequest());

    expect(outcome).toEqual({ outcome: 'error', exitCode: null, result: undefined });
  });
});

describe('onOutput ("logs")', () => {
  it('streams every scripted line to onOutput, in order', async () => {
    const runner = createFakeRunner({ output: ['starting up', 'editing Hero.tsx', 'done'] });
    const lines: string[] = [];

    await runner.run(buildRequest({ onOutput: (line) => lines.push(line) }));

    expect(lines).toEqual(['starting up', 'editing Hero.tsx', 'done']);
  });

  it('never calls onOutput when the script has no output', async () => {
    const runner = createFakeRunner({});
    const onOutput = () => {
      throw new Error('should not be called');
    };

    await expect(runner.run(buildRequest({ onOutput }))).resolves.toMatchObject({ outcome: 'completed' });
  });
});

describe('timeout kill', () => {
  it('resolves with a timeout outcome when the scripted delay would outlast timeoutMs', async () => {
    const runner = createFakeRunner({ delayMs: 100 });

    const outcome = await runner.run(buildRequest({ timeoutMs: 20 }));

    expect(outcome).toEqual({ outcome: 'timeout', exitCode: null });
  });

  it('does not report a timeout when the scripted delay stays within timeoutMs', async () => {
    const runner = createFakeRunner({ delayMs: 10 });

    const outcome = await runner.run(buildRequest({ timeoutMs: 1_000 }));

    expect(outcome.outcome).toBe('completed');
  });
});

describe('cancel', () => {
  it('settles an in-flight run instead of leaving it hanging', async () => {
    const runner = createFakeRunner({ delayMs: 5_000 });
    const request = buildRequest({ requestId: 'req-cancel', timeoutMs: 60_000 });

    const runPromise = runner.run(request);
    await runner.cancel('req-cancel');
    const outcome = await runPromise;

    expect(outcome.outcome).toBe('error');
  });

  it('is a no-op when there is nothing running under that requestId', async () => {
    const runner = createFakeRunner();

    await expect(runner.cancel('never-started')).resolves.toBeUndefined();
  });
});

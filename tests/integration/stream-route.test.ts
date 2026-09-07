import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_COOKIE, issueSession } from '@/lib/auth';
import { createConfigCache } from '@/lib/config/cache';
import { claimConversationBranch } from '@/lib/conversations';
import { setInstallation, type Installation } from '@/lib/installation';
import { createFakeMailer } from '@/lib/notify/email';
import { renderRecord } from '@/lib/record';
import { UNLIMITED_SLOTS } from '@/lib/runner/slots';
import type { RequestRecord } from '@/types';
import { CONFIG, createHarness, type Harness } from './harness';

/**
 * The progress stream as a browser actually holds it: open for the life of
 * the page, replaying what is durable, then following whatever begins on the
 * conversation next — without the page ever reconnecting. The bug this
 * guards against was a trail that only moved after a reload, because the
 * stream had subscribed to the one request holding the lock when it
 * connected and never learned about the next one.
 */

const cookieJar = vi.hoisted(() => ({ value: null as string | null }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (cookieJar.value ? { value: cookieJar.value } : undefined),
  }),
}));

const { GET: stream } = await import('@/app/api/conversations/[number]/stream/route');

let harness: Harness | null = null;

beforeEach(() => {
  cookieJar.value = null;
});

afterEach(async () => {
  setInstallation(null);
  await harness?.cleanup();
  harness = null;
});

function installHarness(current: Harness): void {
  const installation: Installation = {
    env: current.deps.env,
    client: current.deps.client,
    netlify: current.netlify,
    mirror: current.deps.mirror,
    runner: current.deps.runner,
    slots: UNLIMITED_SLOTS,
    mailer: createFakeMailer(),
    bus: current.bus,
    lock: current.lock,
    config: createConfigCache(async () => CONFIG),
    workRoot: current.deps.workRoot ?? '',
  };
  setInstallation(installation);
  cookieJar.value = issueSession('jane@client.example', current.deps.env);
  expect(SESSION_COOKIE).toBe('webagent_session');
}

async function openConversation(current: Harness): Promise<number> {
  const base = await current.client.getRef('refs/heads/main');
  const { branch } = await claimConversationBranch(current.client, base!.sha);
  const pullRequest = await current.client.createPullRequest({
    title: 'Shorten the headline',
    head: branch,
    base: 'main',
    body: '',
  });
  return pullRequest.number;
}

async function recordSomething(conversationNumber: number): Promise<void> {
  const record: RequestRecord = {
    requestId: 'r_earlier',
    startedAt: '2026-09-02T10:31:02Z',
    finishedAt: '2026-09-02T10:34:19Z',
    outcome: 'succeeded',
    stages: [
      { stage: 'starting', at: '2026-09-02T10:31:02Z' },
      { stage: 'succeeded', at: '2026-09-02T10:34:19Z' },
    ],
    previewUrl: 'https://deploy-preview-1--client.netlify.app',
  };
  await harness!.client.createComment(
    conversationNumber,
    renderRecord('Your preview is ready.', record),
  );
}

interface WireEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Opens the stream and hands back a way to read events one at a time, and to hang up. */
async function connect(conversationNumber: number) {
  const controller = new AbortController();
  const response = await stream(
    new Request(`http://localhost/api/conversations/${conversationNumber}/stream`, {
      signal: controller.signal,
    }),
    { params: Promise.resolve({ number: String(conversationNumber) }) },
  );
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const queue: WireEvent[] = [];

  async function next(): Promise<WireEvent> {
    while (queue.length === 0) {
      const { value, done } = await reader.read();
      if (done) throw new Error('the stream ended');
      buffered += decoder.decode(value, { stream: true });
      let boundary = buffered.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) queue.push(parsed);
        boundary = buffered.indexOf('\n\n');
      }
    }
    return queue.shift()!;
  }

  async function until(event: string): Promise<WireEvent[]> {
    const seen: WireEvent[] = [];
    for (;;) {
      const current = await next();
      seen.push(current);
      if (current.event === event) return seen;
    }
  }

  return { response, next, until, hangUp: () => controller.abort() };
}

function parseFrame(frame: string): WireEvent | null {
  const lines = frame.split('\n');
  const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
  const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
  if (!event || !data) return null;
  return { event, data: JSON.parse(data) as Record<string, unknown> };
}

describe('the progress stream', () => {
  beforeEach(async () => {
    harness = await createHarness();
    installHarness(harness);
  });

  it('replays the durable records, then says nothing is in flight', async () => {
    const number = await openConversation(harness!);
    await recordSomething(number);

    const connection = await connect(number);
    const events = await connection.until('sync');
    connection.hangUp();

    expect(connection.response.headers.get('content-type')).toContain('text/event-stream');
    expect(events.map((e) => e.event)).toEqual(['request', 'stage', 'stage', 'done', 'sync']);
    expect(events[0]!.data).toEqual({ requestId: 'r_earlier', kind: 'change', live: false });
    expect(events.at(-1)!.data).toEqual({ inFlight: false });
  });

  it('follows a request that begins after the stream was opened, without reconnecting', async () => {
    const number = await openConversation(harness!);
    const connection = await connect(number);
    await connection.until('sync');

    // What a follow-up message, a publish, or another device does on the bus.
    harness!.bus.announce({ conversationNumber: number, requestId: 'r_later', kind: 'change' });
    harness!.bus.publish({ type: 'stage', requestId: 'r_later', stage: 'starting', at: 't1' });
    harness!.bus.publish({ type: 'stage', requestId: 'r_later', stage: 'running', at: 't2' });

    const announced = await connection.next();
    const first = await connection.next();
    const second = await connection.next();
    connection.hangUp();

    expect(announced).toEqual({
      event: 'request',
      data: { requestId: 'r_later', kind: 'change', live: true, resumed: false },
    });
    expect(first.data).toMatchObject({ stage: 'starting' });
    expect(second.data).toMatchObject({ stage: 'running' });
  });

  it('picks up a publish already under way when the page is opened mid-build', async () => {
    const number = await openConversation(harness!);
    harness!.bus.announce({
      conversationNumber: number,
      requestId: 'publish_now',
      kind: 'publish',
    });
    harness!.bus.publish({ type: 'stage', requestId: 'publish_now', stage: 'building', at: 't1' });

    const connection = await connect(number);
    const events = await connection.until('sync');
    connection.hangUp();

    expect(events.map((e) => e.event)).toEqual(['request', 'stage', 'sync']);
    expect(events[0]!.data).toMatchObject({
      requestId: 'publish_now',
      kind: 'publish',
      live: true,
      resumed: true,
    });
    expect(events.at(-1)!.data).toEqual({ inFlight: true });
  });

  it('does not follow a request on another conversation', async () => {
    const number = await openConversation(harness!);
    const other = await openConversation(harness!);
    const connection = await connect(number);
    await connection.until('sync');

    harness!.bus.announce({ conversationNumber: other, requestId: 'r_other', kind: 'change' });
    harness!.bus.announce({ conversationNumber: number, requestId: 'r_mine', kind: 'change' });

    const announced = await connection.next();
    connection.hangUp();

    expect(announced.data).toMatchObject({ requestId: 'r_mine' });
  });

  it('is closed to anyone without a session', async () => {
    const number = await openConversation(harness!);
    cookieJar.value = null;

    const response = await stream(
      new Request(`http://localhost/api/conversations/${number}/stream`),
      { params: Promise.resolve({ number: String(number) }) },
    );

    expect(response.status).toBe(401);
  });
});

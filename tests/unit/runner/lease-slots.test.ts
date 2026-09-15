import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLeaseSlots } from '@/lib/runner/lease-slots';
import type { AgentSlots } from '@/lib/runner/slots';

/**
 * The app's side of the lease protocol, against a scripted daemon on a real
 * unix socket: what it sends, how it maps each answer, and — the part that
 * keeps a dead daemon from becoming an outage — when it falls back.
 */

type Script = (line: string, socket: Socket) => void;

interface FakeBroker {
  path: string;
  received: string[];
  readonly closes: number;
  close(): Promise<void>;
}

let cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function fakeBroker(script: Script): Promise<FakeBroker> {
  const dir = await mkdtemp(join(tmpdir(), 'lease-'));
  const path = join(dir, 's.sock');
  const received: string[] = [];
  const state = { closes: 0 };
  // A granted lease keeps its socket open on purpose, and `server.close()`
  // waits for every connection to end — so the fake must end them itself.
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        received.push(line);
        script(line, socket);
        index = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
      state.closes += 1;
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const broker: FakeBroker = {
    path,
    received,
    get closes() {
      return state.closes;
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      }).then(() => rm(dir, { recursive: true, force: true }));
    },
  };
  cleanup.push(broker.close);
  return broker;
}

function fallbackSpy(): AgentSlots & { readonly calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async acquire() {
      calls += 1;
      return { ok: true, waitedMs: 0, release: async () => {} };
    },
  };
}

const reply = (socket: Socket, payload: object) => socket.write(JSON.stringify(payload) + '\n');

describe('createLeaseSlots', () => {
  it('sends acquire with the request id and the ceiling, and maps a grant with its cap', async () => {
    const broker = await fakeBroker((_line, socket) =>
      reply(socket, { event: 'granted', memoryBytes: 838860800 }),
    );
    const fallback = fallbackSpy();
    const slots = createLeaseSlots({ socketPath: broker.path, fallback, maxWaitMs: 900_000 });
    const onWait = vi.fn();

    const outcome = await slots.acquire({ onWait, requestId: 'req-7' });

    expect(JSON.parse(broker.received[0]!)).toEqual({
      op: 'acquire',
      requestId: 'req-7',
      maxWaitMs: 900_000,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.memoryBytes).toBe(838860800);
    expect(onWait).not.toHaveBeenCalled();
    expect(fallback.calls).toBe(0);
  });

  it('holds the connection open until release, then closes it, and release is idempotent', async () => {
    const broker = await fakeBroker((_line, socket) =>
      reply(socket, { event: 'granted', memoryBytes: 1 }),
    );
    const slots = createLeaseSlots({ socketPath: broker.path, fallback: fallbackSpy() });

    const outcome = await slots.acquire();
    if (!outcome.ok) throw new Error('unreachable');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(broker.closes).toBe(0);

    await outcome.release();
    await outcome.release();
    await vi.waitFor(() => expect(broker.closes).toBe(1));
  });

  it('announces the wait exactly once however many queued events arrive, then resolves on grant', async () => {
    const broker = await fakeBroker((_line, socket) => {
      reply(socket, { event: 'queued', position: 3 });
      setTimeout(() => reply(socket, { event: 'queued', position: 1 }), 5);
      setTimeout(() => reply(socket, { event: 'granted', memoryBytes: 1 }), 15);
    });
    let tick = 0;
    const slots = createLeaseSlots({
      socketPath: broker.path,
      fallback: fallbackSpy(),
      now: () => (tick += 10),
    });
    const onWait = vi.fn();

    const outcome = await slots.acquire({ onWait });

    expect(onWait).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    expect(outcome.waitedMs).toBeGreaterThan(0);
  });

  it('maps a refusal to a failed outcome carrying the reason', async () => {
    const broker = await fakeBroker((_line, socket) =>
      reply(socket, { event: 'refused', reason: 'already_holding' }),
    );
    const fallback = fallbackSpy();
    const slots = createLeaseSlots({ socketPath: broker.path, fallback });

    const outcome = await slots.acquire();

    expect(outcome).toEqual({ ok: false, waitedMs: expect.any(Number), reason: 'already_holding' });
    expect(fallback.calls).toBe(0);
  });

  it('falls back when there is no socket at the path', async () => {
    const fallback = fallbackSpy();
    const slots = createLeaseSlots({ socketPath: '/nonexistent/dir/slotd.sock', fallback });
    const onWait = vi.fn();

    const outcome = await slots.acquire({ onWait, requestId: 'r' });

    expect(outcome.ok).toBe(true);
    expect(fallback.calls).toBe(1);
    expect(onWait).not.toHaveBeenCalled();
  });

  it('falls back when the daemon hangs up before deciding', async () => {
    const broker = await fakeBroker((_line, socket) => {
      reply(socket, { event: 'queued', position: 2 });
      setTimeout(() => socket.destroy(), 5);
    });
    const fallback = fallbackSpy();
    const slots = createLeaseSlots({ socketPath: broker.path, fallback });

    const outcome = await slots.acquire();

    expect(outcome.ok).toBe(true);
    expect(fallback.calls).toBe(1);
  });

  it('falls back when the daemon answers nonsense', async () => {
    const broker = await fakeBroker((_line, socket) => socket.write('not json\n'));
    const fallback = fallbackSpy();
    const slots = createLeaseSlots({ socketPath: broker.path, fallback });

    await slots.acquire();

    expect(fallback.calls).toBe(1);
  });
});

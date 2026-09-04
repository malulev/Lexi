import { describe, expect, it, vi } from 'vitest';
import { createJobBus } from '@/lib/jobs/bus';
import type { JobEvent, Outcome, Stage } from '@/types';

/**
 * R7 is the authority here: a browser that connects mid-request must not
 * miss stages already passed, live output is best effort and may be dropped,
 * and stages/outcome are not — they carry the durable record.
 */

function stageEvent(requestId: string, stage: Stage, at = '2026-09-02T10:00:00.000Z'): JobEvent {
  return { type: 'stage', requestId, stage, at };
}

function outputEvent(requestId: string, text: string): JobEvent {
  return { type: 'output', requestId, text };
}

function doneEvent(requestId: string, outcome: Outcome): JobEvent {
  return { type: 'done', requestId, outcome };
}

describe('publish / subscribe', () => {
  it('delivers a published event to a subscribed listener', () => {
    const bus = createJobBus();
    const received: JobEvent[] = [];
    bus.subscribe('r1', (event) => received.push(event));

    bus.publish(stageEvent('r1', 'running'));

    expect(received).toEqual([stageEvent('r1', 'running')]);
  });

  it('does not deliver events published for a different requestId', () => {
    const bus = createJobBus();
    const received: JobEvent[] = [];
    bus.subscribe('r1', (event) => received.push(event));

    bus.publish(stageEvent('r2', 'running'));

    expect(received).toHaveLength(0);
  });

  it('supports multiple independent listeners on the same request', () => {
    const bus = createJobBus();
    const a: JobEvent[] = [];
    const b: JobEvent[] = [];
    bus.subscribe('r1', (event) => a.push(event));
    bus.subscribe('r1', (event) => b.push(event));

    bus.publish(stageEvent('r1', 'running'));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe('unsubscribe', () => {
  it('stops delivering further events to that listener only', () => {
    const bus = createJobBus();
    const stopped: JobEvent[] = [];
    const kept: JobEvent[] = [];
    const unsubscribe = bus.subscribe('r1', (event) => stopped.push(event));
    bus.subscribe('r1', (event) => kept.push(event));

    bus.publish(stageEvent('r1', 'running'));
    unsubscribe();
    bus.publish(stageEvent('r1', 'gating'));

    expect(stopped).toHaveLength(1);
    expect(kept).toHaveLength(2);
  });

  it('is safe to call twice', () => {
    const bus = createJobBus();
    const unsubscribe = bus.subscribe('r1', () => {});

    unsubscribe();
    expect(unsubscribe).not.toThrow();
  });
});

describe('late-subscriber behaviour (R7)', () => {
  it('history holds events published before anyone had subscribed', () => {
    const bus = createJobBus();

    bus.publish(stageEvent('r1', 'starting'));
    bus.publish(stageEvent('r1', 'running'));

    expect(bus.history('r1')).toEqual([stageEvent('r1', 'starting'), stageEvent('r1', 'running')]);
  });

  it('a late subscriber only receives events published after it subscribes; history covers the rest', () => {
    const bus = createJobBus();
    bus.publish(stageEvent('r1', 'starting'));

    const received: JobEvent[] = [];
    bus.subscribe('r1', (event) => received.push(event));
    bus.publish(stageEvent('r1', 'running'));

    expect(received).toEqual([stageEvent('r1', 'running')]);
    expect(bus.history('r1')).toHaveLength(2);
  });

  it('history is empty for a request nothing has been published for', () => {
    const bus = createJobBus();

    expect(bus.history('unknown')).toEqual([]);
  });
});

describe('bounded history (R7): only output is best-effort', () => {
  it('evicts the oldest output events once maxHistory is exceeded', () => {
    const bus = createJobBus({ maxHistory: 5 });
    bus.publish(stageEvent('r1', 'starting'));
    bus.publish(stageEvent('r1', 'running'));
    for (let i = 0; i < 10; i++) {
      bus.publish(outputEvent('r1', `chunk ${i}`));
    }

    const history = bus.history('r1');

    expect(history.length).toBeLessThanOrEqual(5);
    const survivingOutputs = history.filter((event) => event.type === 'output');
    expect(survivingOutputs.at(-1)).toEqual(outputEvent('r1', 'chunk 9'));
  });

  it('never evicts stage or done events, even once they alone exceed maxHistory', () => {
    const bus = createJobBus({ maxHistory: 2 });

    bus.publish(stageEvent('r1', 'starting'));
    bus.publish(stageEvent('r1', 'running'));
    bus.publish(stageEvent('r1', 'gating'));
    bus.publish(doneEvent('r1', 'succeeded'));

    const history = bus.history('r1');
    expect(history).toHaveLength(4);
    expect(history.filter((event) => event.type === 'output')).toHaveLength(0);
  });

  it('keeps stage and done events while dropping only the output events crowding them out', () => {
    const bus = createJobBus({ maxHistory: 3 });

    bus.publish(stageEvent('r1', 'starting'));
    bus.publish(outputEvent('r1', 'first chunk'));
    bus.publish(outputEvent('r1', 'second chunk'));
    bus.publish(stageEvent('r1', 'running'));
    bus.publish(doneEvent('r1', 'succeeded'));

    const history = bus.history('r1');
    expect(history.filter((event) => event.type === 'stage')).toHaveLength(2);
    expect(history.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(history.filter((event) => event.type === 'output')).toHaveLength(0);
  });
});

describe('listener isolation', () => {
  it('a throwing listener does not stop sibling listeners or the publisher', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = createJobBus();
    const received: JobEvent[] = [];
    bus.subscribe('r1', () => {
      throw new Error('listener bug');
    });
    bus.subscribe('r1', (event) => received.push(event));

    expect(() => bus.publish(stageEvent('r1', 'running'))).not.toThrow();

    expect(received).toHaveLength(1);
    errorSpy.mockRestore();
  });
});

describe('clear', () => {
  it('removes the history for a request once its record is durable', () => {
    const bus = createJobBus();
    bus.publish(stageEvent('r1', 'running'));

    bus.clear('r1');

    expect(bus.history('r1')).toEqual([]);
  });

  it('does not affect another request', () => {
    const bus = createJobBus();
    bus.publish(stageEvent('r1', 'running'));
    bus.publish(stageEvent('r2', 'running'));

    bus.clear('r1');

    expect(bus.history('r2')).toHaveLength(1);
  });
});

describe('jobBus', () => {
  it('exports a single process-wide instance', async () => {
    const { jobBus } = await import('@/lib/jobs/bus');
    expect(jobBus).toBeDefined();
    expect(typeof jobBus.publish).toBe('function');
  });
});

/**
 * A browser that is already watching a conversation must learn that a new
 * request began on it — a follow-up sent from that same page, a publish, or a
 * request another device started — without reconnecting. The announcement is
 * the conversation-level channel that makes that possible; `activeRequest`
 * is what a reader connecting mid-request uses to find the one to follow.
 */
describe('announcing a request on a conversation', () => {
  it('tells conversation listeners which request began and what kind it is', () => {
    const bus = createJobBus();
    const heard: unknown[] = [];
    bus.subscribeConversation(7, (announcement) => heard.push(announcement));

    bus.announce({ conversationNumber: 7, requestId: 'r1', kind: 'change' });

    expect(heard).toEqual([{ conversationNumber: 7, requestId: 'r1', kind: 'change' }]);
  });

  it('does not tell listeners on another conversation', () => {
    const bus = createJobBus();
    const heard: unknown[] = [];
    bus.subscribeConversation(8, (announcement) => heard.push(announcement));

    bus.announce({ conversationNumber: 7, requestId: 'r1', kind: 'change' });

    expect(heard).toHaveLength(0);
  });

  it('stops after unsubscribing', () => {
    const bus = createJobBus();
    const heard: unknown[] = [];
    const stop = bus.subscribeConversation(7, (announcement) => heard.push(announcement));

    stop();
    bus.announce({ conversationNumber: 7, requestId: 'r1', kind: 'publish' });

    expect(heard).toHaveLength(0);
  });

  it('remembers the announced request as active until it is done', () => {
    const bus = createJobBus();
    expect(bus.activeRequest(7)).toBeNull();

    bus.announce({ conversationNumber: 7, requestId: 'p1', kind: 'publish' });
    expect(bus.activeRequest(7)).toEqual({ conversationNumber: 7, requestId: 'p1', kind: 'publish' });

    bus.publish(stageEvent('p1', 'building'));
    expect(bus.activeRequest(7)?.requestId).toBe('p1');

    bus.publish(doneEvent('p1', 'succeeded'));
    expect(bus.activeRequest(7)).toBeNull();
  });

  it('forgets an active request when its history is cleared', () => {
    const bus = createJobBus();
    bus.announce({ conversationNumber: 7, requestId: 'r1', kind: 'change' });

    bus.clear('r1');

    expect(bus.activeRequest(7)).toBeNull();
  });
});

import { readConversation, requestKindOf } from '@/lib/conversations';
import { requireClient } from '@/lib/http/guard';
import { getInstallation } from '@/lib/installation';
import type { JobEvent, RequestAnnouncement } from '@/types';

// Streaming needs the Node runtime, not an edge one (R7).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Progress, as server-sent events.
 *
 * Reconnection replays the durable records first and then resumes live output,
 * which is the honest version of "nothing is lost": stages and outcomes survive
 * because they were written upstream, while live output is explicitly ephemeral
 * and a reader who missed it has missed it (constitution V, FR-009).
 *
 * The stream belongs to a conversation, not to a request. Every request that
 * begins on the conversation while the stream is open — a follow-up sent from
 * this very page, a publish, an undo, something another device started — is
 * announced with a `request` event and then followed, so an open page never
 * needs a reload to see progress. A `sync` event marks the end of the replay
 * and says whether anything is in flight right now, which is the moment the
 * browser may stop trusting the snapshot it was rendered with.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ number: string }> },
): Promise<Response> {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  const { number } = await context.params;
  const conversationNumber = Number(number);
  if (!Number.isInteger(conversationNumber) || conversationNumber < 1) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const installation = getInstallation();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const following = new Following(installation, send);

      // Subscribed before the replay, not after: the replay reads upstream and
      // a request announced during that wait would otherwise be missed. Until
      // the replay is over, announcements queue behind it.
      let replaying = true;
      const queued: RequestAnnouncement[] = [];
      const unsubscribe = installation.bus.subscribeConversation(conversationNumber, (announced) => {
        if (replaying) queued.push(announced);
        else following.follow(announced, false);
      });

      await replayRecords(installation, conversationNumber, send);
      const live = await findLiveRequest(installation, conversationNumber);
      if (live) following.follow(live, true);
      send('sync', { inFlight: live !== null || queued.length > 0 });

      replaying = false;
      for (const announced of queued) following.follow(announced, false);

      // A proxy that sees nothing for a minute will close the connection, and a
      // request can legitimately be quiet for longer than that while the agent
      // reads the site.
      const heartbeat = setInterval(() => {
        if (open) controller.enqueue(encoder.encode(': keep-alive\n\n'));
      }, 20_000);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        following.stop();
        controller.close();
      };

      request.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

type Send = (event: string, data: unknown) => void;
type Installed = ReturnType<typeof getInstallation>;

/** The finished requests, in order, so a late reader sees the whole conversation. */
async function replayRecords(
  installation: Installed,
  conversationNumber: number,
  send: Send,
): Promise<void> {
  const detail = await readConversation(installation.client, conversationNumber);
  if (!detail) return;

  for (const record of detail.records) {
    send('request', { requestId: record.requestId, kind: requestKindOf(record.requestId), live: false });
    for (const stage of record.stages) send('stage', stage);
    send('done', {
      outcome: record.outcome,
      ...(record.previewUrl ? { previewUrl: record.previewUrl } : {}),
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    });
  }
}

/**
 * The request running right now, if any. A publish announces itself on the
 * bus without taking the lock; a change request takes the lock, and may have
 * been started by a process that no longer exists, in which case the bus knows
 * nothing of it and the lock is the only witness.
 */
async function findLiveRequest(
  installation: Installed,
  conversationNumber: number,
): Promise<RequestAnnouncement | null> {
  const announced = installation.bus.activeRequest(conversationNumber);
  if (announced) return announced;

  const held = await installation.lock.inspect().catch(() => null);
  if (!held?.requestId) return null;
  return { conversationNumber, requestId: held.requestId, kind: requestKindOf(held.requestId) };
}

/** Follows one request at a time: history first, then live, until `done` or the stream closes. */
class Following {
  private unsubscribe: (() => void) | null = null;
  private requestId: string | null = null;

  constructor(
    private readonly installation: Installed,
    private readonly send: Send,
  ) {}

  follow(announced: RequestAnnouncement, resumed: boolean): void {
    if (this.requestId === announced.requestId) return;
    this.stop();
    this.requestId = announced.requestId;
    this.send('request', { requestId: announced.requestId, kind: announced.kind, live: true, resumed });

    const forward = (event: JobEvent) => forwardEvent(event, this.send);
    for (const event of this.installation.bus.history(announced.requestId)) forward(event);
    this.unsubscribe = this.installation.bus.subscribe(announced.requestId, forward);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

function forwardEvent(event: JobEvent, send: Send): void {
  if (event.type === 'stage') return send('stage', { stage: event.stage, at: event.at });
  if (event.type === 'output') return send('output', { text: event.text });
  return send('done', {
    outcome: event.outcome,
    ...(event.previewUrl ? { previewUrl: event.previewUrl } : {}),
    ...(event.liveUrl ? { liveUrl: event.liveUrl } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  });
}

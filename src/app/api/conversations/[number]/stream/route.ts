import { readConversation } from '@/lib/conversations';
import { requireClient } from '@/lib/http/guard';
import { getInstallation } from '@/lib/installation';
import type { JobEvent } from '@/types';

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

      const replayed = await replayRecords(installation, conversationNumber, send);
      const unsubscribe = subscribeLive(installation, replayed, send);

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

/** The finished requests, in order, so a late reader sees the whole conversation. */
async function replayRecords(
  installation: ReturnType<typeof getInstallation>,
  conversationNumber: number,
  send: Send,
): Promise<string | null> {
  const detail = await readConversation(installation.client, conversationNumber);
  if (!detail) return null;

  for (const record of detail.records) {
    for (const stage of record.stages) send('stage', stage);
    send('done', {
      outcome: record.outcome,
      ...(record.previewUrl ? { previewUrl: record.previewUrl } : {}),
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    });
  }

  const held = await installation.lock.inspect();
  return held?.requestId ?? null;
}

/**
 * Live output belongs to whichever request currently holds the lock. There is
 * at most one, which is what makes subscribing by request identity sufficient.
 */
function subscribeLive(
  installation: ReturnType<typeof getInstallation>,
  requestId: string | null,
  send: Send,
): () => void {
  if (!requestId) return () => {};

  for (const event of installation.bus.history(requestId)) forward(event, send);
  return installation.bus.subscribe(requestId, (event: JobEvent) => forward(event, send));
}

function forward(event: JobEvent, send: Send): void {
  if (event.type === 'stage') return send('stage', { stage: event.stage, at: event.at });
  if (event.type === 'output') return send('output', { text: event.text });
  return send('done', {
    outcome: event.outcome,
    ...(event.previewUrl ? { previewUrl: event.previewUrl } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  });
}

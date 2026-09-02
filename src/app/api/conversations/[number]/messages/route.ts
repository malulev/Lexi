import { NextResponse } from 'next/server';
import { z } from 'zod';

import { fail, failUnexpectedly, requireClient } from '@/lib/http/guard';
import { startAndDetach } from '@/lib/http/start-request';

export const runtime = 'nodejs';

const messageSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  targetHint: z.string().trim().max(200).optional(),
});

/**
 * Answering `409` here is the enforcement the disabled input cannot make
 * (FR-007a, FR-007b). A stale browser tab, a second device, or a script gets
 * the same refusal, because the check that matters is the lock in the site's
 * repository rather than the state of anyone's interface.
 *
 * Requests are refused, never queued — a queue would be a promise to do
 * something later, which is state this product does not keep.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ number: string }> },
): Promise<NextResponse> {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  const { number } = await context.params;
  const conversationNumber = Number(number);
  if (!Number.isInteger(conversationNumber) || conversationNumber < 1) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    // Awaited exactly as far as the lock's answer, which is the only thing that
    // can decide between 202 and 409. The work itself outlives this response.
    const begun = await startAndDetach({
      conversationNumber,
      message: parsed.data.message,
      ...(parsed.data.targetHint ? { targetHint: parsed.data.targetHint } : {}),
    });

    if (!begun.started) return fail('request_in_flight');
    return NextResponse.json({ status: 'accepted', requestId: begun.requestId }, { status: 202 });
  } catch (cause) {
    return failUnexpectedly(`starting a request on conversation ${conversationNumber}`, cause);
  }
}

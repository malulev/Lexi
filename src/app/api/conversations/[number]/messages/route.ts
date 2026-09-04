import { NextResponse } from 'next/server';

import { fail, failUnexpectedly, requireClient } from '@/lib/http/guard';
import { parseChangeRequest } from '@/lib/http/parse-request';
import { startAndDetach } from '@/lib/http/start-request';
import { discardAttachments } from '@/lib/jobs/attachments';

export const runtime = 'nodejs';

/**
 * Answering `409` here is the enforcement the disabled input cannot make
 * (FR-007a, FR-007b). A stale browser tab, a second device, or a script gets
 * the same refusal, because the check that matters is the lock in the site's
 * repository rather than the state of anyone's interface.
 *
 * Requests are refused, never queued — a queue would be a promise to do
 * something later, which is state this product does not keep.
 *
 * The body is JSON, or `multipart/form-data` when files are attached; the
 * fields are the same either way (contracts/http-api.md).
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

  const parsed = await parseChangeRequest(request);
  if (!parsed.ok) {
    return NextResponse.json(
      parsed.status === 400 ? { error: parsed.error } : { error: parsed.error, message: parsed.message },
      { status: parsed.status },
    );
  }

  try {
    // Awaited exactly as far as the lock's answer, which is the only thing that
    // can decide between 202 and 409. The work itself outlives this response.
    const begun = await startAndDetach({ conversationNumber, ...parsed.body });

    if (!begun.started) return fail('request_in_flight');
    return NextResponse.json({ status: 'accepted', requestId: begun.requestId }, { status: 202 });
  } catch (cause) {
    // A request that never started leaves nothing else to remove its files.
    await discardAttachments(parsed.body.attachments);
    return failUnexpectedly(`starting a request on conversation ${conversationNumber}`, cause);
  }
}

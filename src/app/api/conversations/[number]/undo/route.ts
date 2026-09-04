import { NextResponse } from 'next/server';

import { fail, failUnexpectedly, requireClient } from '@/lib/http/guard';
import { errorBody } from '@/lib/jobs/messages';
import { beginPublication } from '@/lib/jobs/publication';
import { getInstallation } from '@/lib/installation';

export const runtime = 'nodejs';

/**
 * The way back (FR-029).
 *
 * Undo writes a reversal into the site's own history rather than asking the
 * hosting provider to serve an older build. A rollback would leave the
 * repository still carrying the change, so the next build by anyone — a
 * developer, another conversation, a scheduled rebuild — would quietly put it
 * back. Repository state and live state have to move together (constitution
 * VII, and the constitution's own change-unit note).
 *
 * Like publishing, the act runs as a watchable request
 * (src/lib/jobs/publication.ts); this route answers once the reversal is in
 * the site's history and its record is written.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ number: string }> },
): Promise<NextResponse> {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  const { number } = await context.params;
  const conversationNumber = Number(number);
  if (!Number.isInteger(conversationNumber) || conversationNumber < 1) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    const installation = getInstallation();
    const begun = await beginPublication(
      {
        client: installation.client,
        netlify: installation.netlify,
        bus: installation.bus,
        lock: installation.lock,
        mirror: installation.mirror,
        mailer: installation.mailer,
        env: installation.env,
      },
      { conversationNumber, kind: 'undo', actor: auth.session.email },
    );

    if (!begun.ok && begun.reason === 'not_found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!begun.ok && begun.reason === 'refused') {
      return NextResponse.json(errorBody(begun.errorCode, begun.message), { status: 409 });
    }
    if (!begun.ok) {
      return begun.errorCode === 'internal_error'
        ? failUnexpectedly(
            `undoing conversation ${conversationNumber}`,
            begun.cause ?? new Error('the conversation is published but names no published commit'),
          )
        : fail(begun.errorCode);
    }

    void begun.completed.catch((cause) => {
      console.error(`[webagent] watching the rebuild for conversation ${conversationNumber}`, cause);
    });

    return NextResponse.json({ status: 'undoing', requestId: begun.requestId }, { status: 202 });
  } catch (cause) {
    return failUnexpectedly(`undoing conversation ${conversationNumber}`, cause);
  }
}

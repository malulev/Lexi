import { NextResponse } from 'next/server';

import { fail, failUnexpectedly, requireClient } from '@/lib/http/guard';
import { errorBody } from '@/lib/jobs/messages';
import { beginPublication } from '@/lib/jobs/publication';
import { getInstallation } from '@/lib/installation';

export const runtime = 'nodejs';

/**
 * The only path in this product that changes the public website
 * (constitution II).
 *
 * Everything about it is deliberate. It answers nothing but POST, so no link,
 * prefetch or crawler can reach it. It is authorized at the same choke point
 * as every other route, so an address removed from the installation cannot
 * publish. And it publishes only what a client has already been shown: a
 * conversation whose most recent request succeeded and produced a preview
 * (FR-027). There is no auto-merge and no scheduled variant of this call.
 *
 * The act itself lives in src/lib/jobs/publication.ts, where it runs as a
 * request the client can watch. This route awaits it exactly as far as the
 * merge and the record — the irreversible part — and lets the wait for the
 * hosting provider's build outlive the response.
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
      { conversationNumber, kind: 'publish', actor: auth.session.email },
    );

    if (!begun.ok && begun.reason === 'not_found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!begun.ok && begun.reason === 'refused') {
      // Not a failure: nothing went wrong, the conversation is simply not in
      // a state where publishing means anything (Principle I wording).
      return NextResponse.json(errorBody(begun.errorCode, begun.message), { status: 409 });
    }
    if (!begun.ok) {
      return begun.errorCode === 'internal_error'
        ? failUnexpectedly(`publishing conversation ${conversationNumber}`, begun.cause)
        : fail(begun.errorCode);
    }

    void begun.completed.catch((cause) => {
      console.error(`[webagent] watching the build for conversation ${conversationNumber}`, cause);
    });

    // Accepted, not completed: the change is in the site's source of truth and
    // the hosting provider is building it. The conversation says so.
    return NextResponse.json({ status: 'publishing', requestId: begun.requestId }, { status: 202 });
  } catch (cause) {
    return failUnexpectedly(`publishing conversation ${conversationNumber}`, cause);
  }
}

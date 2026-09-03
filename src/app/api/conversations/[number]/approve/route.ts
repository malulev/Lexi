import { NextResponse } from 'next/server';

import { readConversation, recordPublication, selectPublishState, type PublishState } from '@/lib/conversations';
import { readChangeFreshness } from '@/lib/github/staleness';
import { fail, failUnexpectedly, requireClient } from '@/lib/http/guard';
import { errorBody, PUBLISH_REFUSALS } from '@/lib/jobs/messages';
import { getInstallation, type Installation } from '@/lib/installation';
import { notifyPublication } from '@/lib/notify/email';

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
 */

/**
 * A refusal to publish, in the client's language.
 *
 * These sentences are not in `CLIENT_MESSAGES` (src/lib/jobs/messages.ts)
 * because that table is the *failure* vocabulary and none of these is a
 * failure: nothing went wrong, the conversation is simply not in a state
 * where publishing means anything. They obey the same rule it does — plain
 * language, no vocabulary from the machinery underneath (Principle I).
 */
function refuseToPublish(state: Exclude<PublishState, 'ready'>): NextResponse {
  return NextResponse.json(
    errorBody('nothing_to_publish', PUBLISH_REFUSALS[state]),
    { status: 409 },
  );
}

/** The client's own website, when the hosting provider will say. Absence costs a link, not a publish. */
async function readLiveUrl(installation: Installation): Promise<string | undefined> {
  try {
    return (await installation.netlify.getSite())?.publicUrl;
  } catch {
    return undefined;
  }
}

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
    const { client } = installation;

    const detail = await readConversation(client, conversationNumber);
    if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const state = selectPublishState(detail);
    if (state !== 'ready') return refuseToPublish(state);

    // A request still in flight is about to commit to this very branch. The
    // lock is inspected rather than taken: this call finishes in a moment and
    // holding it would make a publish look like a change request to the next
    // one that asked.
    if (await installation.lock.inspect()) return fail('request_in_flight');

    const defaultBranch = await client.getDefaultBranch();
    const freshness = await readChangeFreshness(client, {
      branch: detail.conversation.branch,
      defaultBranch,
    });
    if (freshness.outOfDate) return fail('out_of_date');

    const liveUrl = await readLiveUrl(installation);
    const merge = await client.mergePullRequest(conversationNumber);

    const written = await recordPublication(client, {
      conversationNumber,
      kind: 'publish',
      actor: auth.session.email,
      at: new Date().toISOString(),
      commitSha: merge.sha,
      ...(liveUrl ? { liveUrl } : {}),
    });

    await notifyPublication(
      { mailer: installation.mailer, client, env: installation.env },
      {
        event: 'published',
        conversation: { number: conversationNumber, title: detail.conversation.title },
        commentId: written.commentId,
        record: written.record,
        recipients: installation.env.allowedEmails,
      },
    );

    // Accepted, not completed: the change is in the site's source of truth and
    // the hosting provider is building it. The conversation says so.
    return NextResponse.json({ status: 'publishing' }, { status: 202 });
  } catch (cause) {
    return failUnexpectedly(`publishing conversation ${conversationNumber}`, cause);
  }
}

import { NextResponse } from 'next/server';

import { readConversation, recordPublication, selectPublishState, type PublishState } from '@/lib/conversations';
import { fail, failUnexpectedly, requireClient } from '@/lib/http/guard';
import { errorBody, UNDO_REFUSALS } from '@/lib/jobs/messages';
import { getInstallation, type Installation } from '@/lib/installation';
import { notifyPublication } from '@/lib/notify/email';

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
 */

function refuseToUndo(state: Exclude<PublishState, 'published'>): NextResponse {
  return NextResponse.json(
    errorBody('nothing_to_undo', UNDO_REFUSALS[state]),
    { status: 409 },
  );
}

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
    if (state !== 'published') return refuseToUndo(state);

    const pullRequest = await client.getPullRequest(conversationNumber);
    const publishedSha = pullRequest?.mergeCommitSha;
    if (!publishedSha) {
      return failUnexpectedly(
        `undoing conversation ${conversationNumber}`,
        new Error('the conversation is published but names no published commit'),
      );
    }

    const defaultBranch = await client.getDefaultBranch();
    const siteTip = await client.getRef(`refs/heads/${defaultBranch}`);
    if (!siteTip) return fail('site_unreachable');

    // Reversal reinstates the content the site had immediately before this
    // change. That is only the client's own change to take back while nothing
    // has landed since; once something has, undoing here would silently take
    // that with it, so it is refused rather than guessed at.
    if (siteTip.sha !== publishedSha) return fail('out_of_date');

    const liveUrl = await readLiveUrl(installation);
    const reversal = await client.revertCommit(publishedSha, defaultBranch);

    const written = await recordPublication(client, {
      conversationNumber,
      kind: 'undo',
      actor: auth.session.email,
      at: new Date().toISOString(),
      commitSha: reversal.sha,
      ...(liveUrl ? { liveUrl } : {}),
    });

    await notifyPublication(
      { mailer: installation.mailer, client, env: installation.env },
      {
        event: 'undone',
        conversation: { number: conversationNumber, title: detail.conversation.title },
        commentId: written.commentId,
        record: written.record,
        recipients: installation.env.allowedEmails,
      },
    );

    return NextResponse.json({ status: 'undoing' }, { status: 202 });
  } catch (cause) {
    return failUnexpectedly(`undoing conversation ${conversationNumber}`, cause);
  }
}

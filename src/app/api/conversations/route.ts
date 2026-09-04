import { NextResponse } from 'next/server';

import { claimConversationBranch, listConversations, titleFor } from '@/lib/conversations';
import { fail, failUnexpectedly, requireClient } from '@/lib/http/guard';
import { parseChangeRequest } from '@/lib/http/parse-request';
import { startDetached } from '@/lib/http/start-request';
import { getInstallation } from '@/lib/installation';
import { discardAttachments } from '@/lib/jobs/attachments';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  try {
    const { client } = getInstallation();
    return NextResponse.json({ conversations: await listConversations(client) });
  } catch (cause) {
    return failUnexpectedly('listing conversations', cause);
  }
}

/**
 * Opening a conversation is opening a pull request, which needs a branch, which
 * needs a name — and the name convention includes the number the pull request
 * does not have until it exists.
 *
 * The circularity is resolved by predicting the number and then trusting the
 * pull request over the prediction: everything downstream reads the branch from
 * the pull request's head, so a prediction that misses costs a slightly
 * misleading branch name and nothing else.
 *
 * The answer is sent the moment the conversation exists. Starting the request
 * — reading settings, writing the client's words into the conversation, taking
 * the lock — is several more round trips to the hosting provider, and a person
 * who has just pressed Send should be looking at their conversation while those
 * happen, not at a spinner. The lock is inspected first so the common refusal
 * (`409`, a change already running) is still answered here and not discovered
 * later; the rare race that slips past that inspection is recorded in the
 * conversation by `startDetached` rather than lost.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  const parsed = await parseChangeRequest(request);
  if (!parsed.ok) {
    return NextResponse.json(
      parsed.status === 400 ? { error: parsed.error } : { error: parsed.error, message: parsed.message },
      { status: parsed.status },
    );
  }

  try {
    const { client, lock } = getInstallation();
    if (await lock.inspect()) {
      await discardAttachments(parsed.body.attachments);
      return fail('request_in_flight');
    }

    const defaultBranch = await client.getDefaultBranch();
    const base = await client.getRef(`refs/heads/${defaultBranch}`);
    if (!base) {
      await discardAttachments(parsed.body.attachments);
      return fail('site_unreachable');
    }

    const { branch } = await claimConversationBranch(client, base.sha);
    const pullRequest = await client.createPullRequest({
      title: titleFor(parsed.body.message),
      head: branch,
      base: defaultBranch,
      body: 'Opened from a change request in the site editor.',
    });

    startDetached({ conversationNumber: pullRequest.number, ...parsed.body });

    return NextResponse.json({ number: pullRequest.number }, { status: 201 });
  } catch (cause) {
    await discardAttachments(parsed.body.attachments);
    return failUnexpectedly('creating a conversation', cause);
  }
}

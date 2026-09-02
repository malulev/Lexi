import { NextResponse } from 'next/server';

import { readConversation } from '@/lib/conversations';
import { failUnexpectedly, requireClient } from '@/lib/http/guard';
import { getInstallation } from '@/lib/installation';

export const runtime = 'nodejs';

/**
 * The conversation is assembled from the pull request and its comments on every
 * read (FR-009b). Nothing is cached, because a cache would be the application
 * database this design does not have.
 */
export async function GET(
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
    const detail = await readConversation(installation.client, conversationNumber);
    if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const held = await installation.lock.inspect();
    return NextResponse.json({
      conversation: detail.conversation,
      messages: detail.messages,
      ...(held ? { pendingRequest: { startedAt: held.heldSince } } : {}),
    });
  } catch (cause) {
    return failUnexpectedly(`reading conversation ${conversationNumber}`, cause);
  }
}

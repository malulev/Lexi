import { NextResponse } from 'next/server';
import { z } from 'zod';

import { branchFor, listConversations, titleFor } from '@/lib/conversations';
import { RefAlreadyExistsError } from '@/lib/github/types';
import { fail, failUnexpectedly, requireClient } from '@/lib/http/guard';
import { startAndDetach } from '@/lib/http/start-request';
import { getInstallation } from '@/lib/installation';

export const runtime = 'nodejs';

const createSchema = z.object({ message: z.string().trim().min(1).max(4_000) });

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
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  try {
    const { client } = getInstallation();
    const defaultBranch = await client.getDefaultBranch();
    const base = await client.getRef(`refs/heads/${defaultBranch}`);
    if (!base) return fail('site_unreachable');

    const branch = await claimBranch(client, base.sha);
    const pullRequest = await client.createPullRequest({
      title: titleFor(parsed.data.message),
      head: branch,
      base: defaultBranch,
      body: 'Opened from a change request in the site editor.',
    });

    // A brand-new conversation cannot collide with itself, but the lock is
    // installation-wide: another conversation's request may already hold it.
    const begun = await startAndDetach({
      conversationNumber: pullRequest.number,
      message: parsed.data.message,
    });
    if (!begun.started) return fail('request_in_flight');

    return NextResponse.json({ number: pullRequest.number }, { status: 201 });
  } catch (cause) {
    return failUnexpectedly('creating a conversation', cause);
  }
}

async function claimBranch(
  client: ReturnType<typeof getInstallation>['client'],
  baseSha: string,
): Promise<string> {
  const existing = await client.listPullRequests();
  const highest = existing.reduce((max, pullRequest) => Math.max(max, pullRequest.number), 0);

  // A few attempts, because another process may have taken the predicted number
  // between the read and the write. Ref creation is a compare-and-swap, so the
  // collision is observed rather than silently overwritten.
  for (let offset = 1; offset <= 10; offset += 1) {
    const branch = branchFor(highest + offset);
    try {
      await client.createRef(`refs/heads/${branch}`, baseSha);
      return branch;
    } catch (cause) {
      if (!(cause instanceof RefAlreadyExistsError)) throw cause;
    }
  }

  throw new Error('could not claim a branch name for a new conversation');
}

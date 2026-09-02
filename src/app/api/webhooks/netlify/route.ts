import { NextResponse } from 'next/server';

import { listConversations } from '@/lib/conversations';
import { getInstallation } from '@/lib/installation';
import { correlateDeploy, deployEffect, verifyAndParseWebhook } from '@/lib/netlify/webhook';

export const runtime = 'nodejs';

/**
 * Netlify's deploy notifications.
 *
 * Unauthenticated by session and verified by shared secret, because the sender
 * is a machine with no sign-in. Three properties matter and each is deliberate:
 * a deploy that cannot be correlated is ignored rather than treated as an
 * error, since Netlify reports builds that have nothing to do with this
 * product; the same event may arrive more than once, so the effect is made
 * idempotent rather than the delivery; and nothing here publishes anything to
 * the client's live site (Principle II).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const installation = getInstallation();
  const rawBody = await request.text();
  const signature =
    request.headers.get('x-webhook-signature') ?? request.headers.get('X-Webhook-Signature');

  const parsed = verifyAndParseWebhook(rawBody, signature, installation.env.netlifyWebhookSecret);
  if (!parsed.ok) {
    // A bad signature is answered without detail. Telling an unverified caller
    // why it failed is telling it how to succeed.
    return NextResponse.json({ status: 'rejected' }, { status: 401 });
  }

  try {
    const conversations = await listConversations(installation.client);
    const correlation = correlateDeploy(parsed.deploy, conversations);
    if (!correlation) return NextResponse.json({ status: 'ignored' });

    const effect = deployEffect(parsed.deploy);
    if (effect.kind === 'ignore') return NextResponse.json({ status: 'ignored' });

    // The orchestrator is already waiting on this deploy and will read the same
    // outcome from the deploy list. Acknowledging here keeps Netlify from
    // retrying, and the wait ends sooner because the poll interval is short.
    return NextResponse.json({
      status: 'accepted',
      conversation: correlation.conversationNumber,
      effect: effect.kind,
    });
  } catch (cause) {
    console.error('[webagent] handling a Netlify deploy notification', cause);
    // Answering 200 stops a retry storm for a fault that a retry cannot fix.
    // The orchestrator's own polling is what actually makes the preview known.
    return NextResponse.json({ status: 'error' });
  }
}

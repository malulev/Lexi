import { notFound } from 'next/navigation';

import { ConversationView } from '@/components/ConversationView';
import { readConversation, selectPublishState } from '@/lib/conversations';
import { getInstallation } from '@/lib/installation';
import { defaultTierOf, tierModelMap } from '@/lib/models';
import { readSiteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

/**
 * One conversation: what was asked, what happened, and the preview.
 *
 * The durable snapshot is read on the server so a reader who arrives after
 * everything finished sees the whole history without waiting for a stream
 * (FR-009b). The live stream then picks up from there.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  const conversationNumber = Number(number);
  if (!Number.isInteger(conversationNumber) || conversationNumber < 1) notFound();

  const installation = getInstallation();
  const detail = await readConversation(installation.client, conversationNumber);
  if (!detail) notFound();

  const held = await installation.lock.inspect().catch(() => null);
  await installation.config.ensureLoaded().catch(() => undefined);
  const settings = installation.config.current()?.settings;
  // Only needed once a conversation is undone, but read here so the view has it
  // on first paint rather than after a round trip. A failed read costs the
  // reverted-site frame, nothing else.
  const liveSiteUrl = await readSiteUrl(installation.netlify);

  return (
    <ConversationView
      conversation={detail.conversation}
      messages={detail.messages}
      requestInFlight={Boolean(held)}
      publishState={selectPublishState(detail)}
      defaultModelTier={defaultTierOf(settings)}
      models={tierModelMap(settings)}
      {...(liveSiteUrl ? { liveSiteUrl } : {})}
    />
  );
}

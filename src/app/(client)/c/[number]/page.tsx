import { notFound } from 'next/navigation';

import { ConversationView } from '@/components/ConversationView';
import { readConversation } from '@/lib/conversations';
import { getInstallation } from '@/lib/installation';

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

  return (
    <ConversationView
      conversation={detail.conversation}
      messages={detail.messages}
      requestInFlight={Boolean(held)}
    />
  );
}

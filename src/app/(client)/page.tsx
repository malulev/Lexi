import Link from 'next/link';

import { NewConversation } from '@/components/NewConversation';
import { ConversationStatusBadge } from '@/components/MessageList';
import { listConversations } from '@/lib/conversations';
import { getInstallation } from '@/lib/installation';
import type { Conversation } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Every change ever asked for, newest first, assembled from the site's own
 * pull requests. Nothing is stored here, so this list is simply what is true
 * upstream right now.
 */
export default async function ConversationListPage() {
  const { client } = getInstallation();

  let conversations: Conversation[] = [];
  let unreachable = false;
  try {
    conversations = await listConversations(client);
  } catch {
    // A list that cannot be read is reported calmly. The composer below still
    // works, because starting a change does not depend on this having loaded.
    unreachable = true;
  }

  return (
    <main className="conv-list">
      <h1 className="conv-list__title">What would you like to change?</h1>

      <div className="conv-list__composer">
        <NewConversation />
      </div>

      {unreachable ? (
        <p className="conv-list__status conv-list__status--setback">
          Can&rsquo;t reach your website&rsquo;s hosting right now. Your changes are safe; try again
          in a moment.
        </p>
      ) : conversations.length === 0 ? (
        <p className="conv-list__status">
          Nothing yet. Describe a change above and you will see it here.
        </p>
      ) : (
        <ul className="conv-list__items">
          {conversations.map((conversation) => (
            <li className="conv-card" key={conversation.number}>
              <Link className="conv-card__link" href={`/c/${conversation.number}`}>
                <span className="conv-card__title">{conversation.title}</span>
                <ConversationStatusBadge status={conversation.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

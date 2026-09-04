import Link from 'next/link';

import { NewConversation } from '@/components/NewConversation';
import { ConversationStatusBadge } from '@/components/MessageList';
import { listConversations } from '@/lib/conversations';
import { dictionaryFor, directionOf } from '@/lib/i18n';
import { readLocale } from '@/lib/i18n/server';
import { getInstallation } from '@/lib/installation';
import { defaultTierOf, tierModelMap } from '@/lib/models';
import { displayHost, readSiteUrl } from '@/lib/site-url';
import { describeUpdatedAt } from '@/lib/time';
import type { Conversation } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Every change ever asked for, newest first, assembled from the site's own
 * pull requests. Nothing is stored here, so this list is simply what is true
 * upstream right now.
 */
export default async function ConversationListPage() {
  const { client, netlify, config } = getInstallation();
  const [siteUrl, locale] = await Promise.all([readSiteUrl(netlify), readLocale()]);
  const t = dictionaryFor(locale);
  const forward = directionOf(locale) === 'rtl' ? '←' : '→';
  // Best effort: a settings fault is reported on the configuration page, not
  // here, and the picker opens on the middle tier meanwhile.
  await config.ensureLoaded().catch(() => undefined);
  const settings = config.current()?.settings;
  const defaultModelTier = defaultTierOf(settings);
  const models = tierModelMap(settings);

  let conversations: Conversation[] = [];
  let unreachable = false;
  try {
    conversations = await listConversations(client);
  } catch {
    // A list that cannot be read is reported calmly. The composer below still
    // works, because starting a change does not depend on this having loaded.
    unreachable = true;
  }

  const now = Date.now();

  return (
    <main className="home">
      <section className="home__hero">
        {siteUrl ? (
          <p className="home__site">
            {t.home.editing}{' '}
            <a href={siteUrl} target="_blank" rel="noopener noreferrer">
              {displayHost(siteUrl)} <span aria-hidden="true">↗</span>
            </a>
          </p>
        ) : null}
        <h1 className="home__title">{t.home.title}</h1>
        <p className="home__lede">{t.home.lede}</p>
        <div className="home__composer">
          <NewConversation defaultModelTier={defaultModelTier} models={models} />
        </div>
      </section>

      <section className="home__list" aria-labelledby="changes-heading">
        <h2 className="home__list-title" id="changes-heading">
          {t.home.yourChanges}
        </h2>

        {unreachable ? (
          <p className="home__status home__status--setback" role="status">
            {t.home.unreachable}
          </p>
        ) : conversations.length === 0 ? (
          <p className="home__status">{t.home.nothingYet}</p>
        ) : (
          <ul className="conv-cards">
            {conversations.map((conversation) => (
              <li className="conv-card" key={conversation.number}>
                <Link className="conv-card__link" href={`/c/${conversation.number}`}>
                  <span className="conv-card__body">
                    <span className="conv-card__title" dir="auto">
                      {conversation.title}
                    </span>
                    <span className="conv-card__meta">
                      {describeUpdatedAt(conversation.updatedAt, now, locale)}
                    </span>
                  </span>
                  <ConversationStatusBadge status={conversation.status} />
                  <span className="conv-card__chevron" aria-hidden="true">
                    {forward}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

import { redirect } from 'next/navigation';

import { HeaderNav } from '@/components/HeaderNav';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { dictionaryFor } from '@/lib/i18n';
import { readLocale } from '@/lib/i18n/server';
import { requireClient } from '@/lib/http/guard';
import { getInstallation } from '@/lib/installation';
import { readSiteUrl } from '@/lib/site-url';
import '@/components/client.css';

/**
 * Everything under this layout requires a signed-in client.
 *
 * The check is the same choke point the routes use, so the interface and the
 * API can never disagree about who is allowed in (constitution Principle VI).
 */
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireClient();
  if (!auth.ok) redirect('/login');

  const [siteUrl, locale] = await Promise.all([
    readSiteUrl(getInstallation().netlify),
    readLocale(),
  ]);
  const t = dictionaryFor(locale);

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <HeaderNav siteUrl={siteUrl} />
        <div className="app-shell__actions">
          <LanguageSwitcher />
          <span className="app-shell__who" title={auth.session.email}>
            {auth.session.email}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="app-shell__signout" type="submit">
              {t.shell.signOut}
            </button>
          </form>
        </div>
      </header>
      <div className="app-shell__body">{children}</div>
    </div>
  );
}

import { cookies } from 'next/headers';

import { CONFIG_SESSION_COOKIE, verifyConfigSession } from '@/lib/auth/config-credential';
import { getInstallation } from '@/lib/installation';

import { BrandMark } from '@/components/Brand';
import { BRAND } from '@/lib/brand';
import { ConfigSignIn } from './ConfigSignIn';
import { signOutOfConfig } from './actions';
import './config.css';

/**
 * Everything under this layout requires the configuration credential, checked
 * here and nowhere else, so a page added later cannot forget to ask.
 *
 * A client session is worth nothing here: the two cookies are signed with
 * different subkeys, so a signed-in client presenting theirs sees this gate
 * exactly as an anonymous visitor does (FR-003a).
 */
export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  const { env } = getInstallation();
  const store = await cookies();

  if (!verifyConfigSession(store.get(CONFIG_SESSION_COOKIE)?.value, env)) {
    return <ConfigSignIn />;
  }

  return (
    <div className="config-shell">
      <header className="config-shell__header">
        <span className="config-shell__brand">
          <BrandMark size={20} />
          {BRAND.name} · Configuration
        </span>
        <form action={signOutOfConfig}>
          <button className="config-shell__lock" type="submit">
            Lock
          </button>
        </form>
      </header>
      <main className="config-shell__body">{children}</main>
    </div>
  );
}

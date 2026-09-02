import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireClient } from '@/lib/http/guard';
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

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <Link className="app-shell__brand" href="/">
          Site Editor
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="app-shell__signout" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <div className="app-shell__body">{children}</div>
    </div>
  );
}

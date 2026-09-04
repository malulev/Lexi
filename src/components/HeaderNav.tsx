'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Wordmark } from './Brand';
import { useTranslation } from './LocaleProvider';
import { displayHost } from '@/lib/site-url';

/**
 * The left side of the shell header: the brand, and — inside a conversation —
 * the way back to the list. Lives in the header rather than in the
 * conversation column so it is in the same place on every page.
 */
export function HeaderNav({ siteUrl }: { siteUrl: string | null }) {
  const pathname = usePathname();
  const { t, dir } = useTranslation();
  const inConversation = pathname.startsWith('/c/');
  const back = dir === 'rtl' ? '→' : '←';

  return (
    <nav className="app-shell__nav" aria-label={t.shell.mainNav}>
      <Link className="app-shell__brand" href="/" aria-label={t.shell.allChanges}>
        <Wordmark />
      </Link>
      {siteUrl ? (
        <a
          className="app-shell__site"
          href={siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={t.shell.siteLinkTitle}
        >
          <span className="app-shell__site-dot" aria-hidden="true" />
          {displayHost(siteUrl)}
          <span aria-hidden="true"> ↗</span>
        </a>
      ) : null}
      {inConversation ? (
        <Link className="app-shell__back" href="/">
          <span aria-hidden="true">{back}</span> {t.shell.allChanges}
        </Link>
      ) : null}
    </nav>
  );
}

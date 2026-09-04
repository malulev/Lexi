'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { useTranslation } from './LocaleProvider';
import { LOCALE_NAMES, LOCALES, isLocale, localeCookieValue } from '@/lib/i18n';

/**
 * Choosing a language.
 *
 * A native select, each language named in itself, so a person who cannot
 * read the current one can still find theirs. The choice is written to a
 * cookie and the page re-rendered from the server, which is what flips the
 * document's `lang` and `dir` as well as every sentence.
 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, t } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(value: string) {
    if (!isLocale(value) || value === locale) return;
    document.cookie = localeCookieValue(value);
    startTransition(() => router.refresh());
  }

  return (
    <label className={`lang ${className}`.trim()}>
      <span className="visually-hidden">{t.shell.language}</span>
      <span className="lang__glyph" aria-hidden="true">
        文A
      </span>
      <select
        className="lang__select"
        value={locale}
        disabled={pending}
        onChange={(event) => choose(event.target.value)}
      >
        {LOCALES.map((option) => (
          <option key={option} value={option} lang={option}>
            {LOCALE_NAMES[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

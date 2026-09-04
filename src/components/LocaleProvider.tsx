'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { formatUsd } from '@/lib/cost';
import {
  DEFAULT_LOCALE,
  LOCALE_TAGS,
  dictionaryFor,
  directionOf,
  formatMessage,
  splitMessage,
  type Dictionary,
  type Direction,
  type Locale,
} from '@/lib/i18n';
import type { FormatParams } from '@/lib/i18n/format';

/**
 * The language of the page, for every client component beneath it.
 *
 * The server decides the locale once per request (from the cookie the
 * switcher writes) and hands only the locale down; the dictionaries ship
 * in the browser bundle, so nothing is serialised twice. A component
 * rendered with no provider — a unit test, a story — speaks English rather
 * than throwing, because a missing language is a cosmetic fault.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export interface Translation {
  locale: Locale;
  /** The `Intl` tag for dates and money. */
  tag: string;
  dir: Direction;
  /** The whole dictionary, for tables (stages, tiers, errors). */
  t: Dictionary;
  /** Fill a sentence's placeholders. */
  fill: (template: string, params?: FormatParams) => string;
  /** Fill placeholders with markup. */
  fillNodes: (template: string, params: Record<string, ReactNode>) => ReactNode[];
  /** Dollars, the way the language writes them. */
  money: (usd: number) => string;
}

export function useTranslation(): Translation {
  const locale = useContext(LocaleContext);
  return translationFor(locale);
}

/** The same, for a server component that already knows its locale. */
export function translationFor(locale: Locale): Translation {
  return {
    locale,
    tag: LOCALE_TAGS[locale],
    dir: directionOf(locale),
    t: dictionaryFor(locale),
    fill: formatMessage,
    // Every price is in dollars; British English writes "US$", which reads
    // as a foreign currency for a sum that is simply the price.
    money: (usd) => formatUsd(usd, locale === 'en' ? 'en-US' : LOCALE_TAGS[locale]),
    fillNodes: (template, params) =>
      splitMessage(template).map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.value}</span>
        ) : (
          <span key={index}>{params[part.value] ?? `{${part.value}}`}</span>
        ),
      ),
  };
}

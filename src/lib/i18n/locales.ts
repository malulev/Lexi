/**
 * The languages the client interface speaks.
 *
 * A closed list, like the tiers: the switcher offers exactly these, the
 * cookie may hold exactly these, and a dictionary exists for each one (the
 * `Dictionary` type makes a missing sentence a build failure, not a blank
 * label). Browser-safe: nothing here touches Node or the request.
 */

export const LOCALES = ['en', 'he', 'nl', 'fr'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Each language in its own words, which is how a person finds theirs in a list. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  he: 'עברית',
  nl: 'Nederlands',
  fr: 'Français',
};

/** BCP 47 tags for `Intl`, so dates and numbers read the way the language writes them. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en-GB',
  he: 'he-IL',
  nl: 'nl-NL',
  fr: 'fr-FR',
};

export type Direction = 'ltr' | 'rtl';

export function directionOf(locale: Locale): Direction {
  return locale === 'he' ? 'rtl' : 'ltr';
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Where the choice lives: a plain cookie the server reads on every page. */
export const LOCALE_COOKIE = 'webagent.locale';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** The `Set-Cookie`/`document.cookie` string that records a choice for a year. */
export function localeCookieValue(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

/**
 * Which language to render: what the person chose, else what their browser
 * asks for, else English. The cookie wins outright — a person who chose
 * Dutch on an English-browser machine chose Dutch.
 */
export function selectLocale(input: {
  cookie?: string | null | undefined;
  acceptLanguage?: string | null | undefined;
}): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return firstAcceptedLocale(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** The first language in an `Accept-Language` header this interface speaks, by the header's own order. */
export function firstAcceptedLocale(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const quality = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const weight = quality ? Number(quality.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) {
    const primary = entry.tag.split('-')[0];
    // `iw` is the tag older browsers still send for Hebrew.
    const candidate = primary === 'iw' ? 'he' : primary;
    if (isLocale(candidate)) return candidate;
  }
  return null;
}

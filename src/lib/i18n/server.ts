import { cookies, headers } from 'next/headers';

import { LOCALE_COOKIE, selectLocale, type Locale } from './locales';

/**
 * The language of this request, decided once on the server.
 *
 * The cookie the switcher writes wins; a first visit with no cookie follows
 * the browser's `Accept-Language`; anything else is English. Reading the
 * request here makes the page dynamic, which every client page already is.
 */
export async function readLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return selectLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });
}

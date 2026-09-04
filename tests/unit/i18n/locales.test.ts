import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  directionOf,
  isLocale,
  LOCALE_COOKIE,
  LOCALES,
  localeCookieValue,
  selectLocale,
} from '@/lib/i18n';

/**
 * Which language a page renders in: the cookie a person set, else what
 * their browser asks for in the order it asks, else English.
 */
describe('selectLocale', () => {
  it('honours the cookie over the browser', () => {
    expect(selectLocale({ cookie: 'nl', acceptLanguage: 'fr' })).toBe('nl');
  });

  it('ignores a cookie that names no language this interface speaks', () => {
    expect(selectLocale({ cookie: 'de', acceptLanguage: 'fr' })).toBe('fr');
    expect(selectLocale({ cookie: '', acceptLanguage: 'fr' })).toBe('fr');
    expect(selectLocale({ cookie: null, acceptLanguage: 'fr' })).toBe('fr');
  });

  it('reads Accept-Language in the order of its weights, not of its text', () => {
    expect(selectLocale({ acceptLanguage: 'fr;q=0.8, nl' })).toBe('nl');
    expect(selectLocale({ acceptLanguage: 'nl;q=0.5, fr;q=0.9' })).toBe('fr');
  });

  it('skips languages it does not speak and takes the next one', () => {
    expect(selectLocale({ acceptLanguage: 'de, he;q=0.9' })).toBe('he');
    expect(selectLocale({ acceptLanguage: 'de-DE, fr-CA;q=0.7, en;q=0.3' })).toBe('fr');
  });

  it('understands the older tag browsers still send for Hebrew', () => {
    expect(selectLocale({ acceptLanguage: 'iw' })).toBe('he');
    expect(selectLocale({ acceptLanguage: 'iw-IL, en;q=0.5' })).toBe('he');
  });

  it('falls back to English when nothing matches or nothing is sent', () => {
    expect(selectLocale({ acceptLanguage: 'de' })).toBe(DEFAULT_LOCALE);
    expect(selectLocale({ acceptLanguage: '' })).toBe('en');
    expect(selectLocale({})).toBe('en');
    expect(selectLocale({ acceptLanguage: 'nl;q=0' })).toBe('en');
  });
});

describe('isLocale', () => {
  it('accepts exactly the languages on the list', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale('EN')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe('directionOf', () => {
  it('lays Hebrew out right to left and everything else left to right', () => {
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('nl')).toBe('ltr');
    expect(directionOf('fr')).toBe('ltr');
  });
});

describe('localeCookieValue', () => {
  it('records the choice under the one cookie name, site-wide, for a long while', () => {
    const value = localeCookieValue('fr');
    expect(value.startsWith(`${LOCALE_COOKIE}=fr;`)).toBe(true);
    expect(value.startsWith('webagent.locale=fr;')).toBe(true);
    expect(value).toContain('path=/');
    expect(value).toMatch(/max-age=\d+/);
  });
});

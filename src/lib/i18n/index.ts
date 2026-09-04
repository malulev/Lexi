import { en } from './en';
import { fr } from './fr';
import { he } from './he';
import { nl } from './nl';
import { DEFAULT_LOCALE, type Locale } from './locales';
import type { Dictionary } from './types';

export { formatMessage, placeholdersOf, splitMessage } from './format';
export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_NAMES,
  LOCALE_TAGS,
  LOCALES,
  directionOf,
  isLocale,
  localeCookieValue,
  selectLocale,
} from './locales';
export type { Direction, Locale } from './locales';
export type { Dictionary, TierWords } from './types';

export const DICTIONARIES: Record<Locale, Dictionary> = { en, he, nl, fr };

export function dictionaryFor(locale: Locale | null | undefined): Dictionary {
  return DICTIONARIES[locale ?? DEFAULT_LOCALE];
}

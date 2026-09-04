import { LOCALE_TAGS, dictionaryFor, formatMessage, type Locale } from '@/lib/i18n';

/**
 * Timestamps the way a person says them.
 *
 * Pure, so the list page can format on the server without a locale
 * disagreement showing up as a hydration warning, and so it can be tested
 * against a fixed "now". The language is an argument for the same reason:
 * the server knows it, and nothing here guesses.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function describeUpdatedAt(
  iso: string,
  now: number = Date.now(),
  locale: Locale = 'en',
): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';

  const words = dictionaryFor(locale).home;
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return words.updatedJustNow;
  if (elapsed < HOUR)
    return formatMessage(words.updatedMinutes, { n: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? words.updatedHour : formatMessage(words.updatedHours, { n: hours });
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? words.updatedDay : formatMessage(words.updatedDays, { n: days });
  }

  const date = new Date(at).toLocaleDateString(LOCALE_TAGS[locale], {
    day: 'numeric',
    month: 'short',
    year: at < now - 300 * DAY ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
  return formatMessage(words.updatedOn, { date });
}

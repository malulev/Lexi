import { describe, expect, it } from 'vitest';

import { DICTIONARIES, LOCALES, placeholdersOf, type Locale } from '@/lib/i18n';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import { MODEL_TIER_LABELS } from '@/lib/models';
import type { RequestKind } from '@/types';

/**
 * Every language says everything English says, with the same moving parts.
 *
 * TypeScript already refuses a dictionary with a key missing; these audits
 * cover what a type cannot: a placeholder renamed in one language (so a
 * name is never filled), a sentence left blank, a working line too long for
 * its pill, a tier label leaking a vendor, and a "translation" that is still
 * English.
 */

type Leaf = { path: string; value: string | readonly string[] };

function leavesOf(value: unknown, path = ''): Leaf[] {
  if (typeof value === 'string' || Array.isArray(value)) {
    return [{ path, value: value as string | readonly string[] }];
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      leavesOf(child, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

function stringLeavesOf(value: unknown): Array<{ path: string; value: string }> {
  return leavesOf(value).filter(
    (leaf): leaf is { path: string; value: string } => typeof leaf.value === 'string',
  );
}

const english = DICTIONARIES.en;
const ENGLISH_LEAVES = leavesOf(english);
const ENGLISH_BY_PATH = new Map(stringLeavesOf(english).map((leaf) => [leaf.path, leaf.value]));
const TRANSLATED: Locale[] = LOCALES.filter((locale) => locale !== 'en');
const VENDOR_NAMES = /claude|gpt|cohere|deepseek|openrouter|anthropic/i;

describe.each(LOCALES)('the %s dictionary', (locale) => {
  const dictionary = DICTIONARIES[locale];

  it('has exactly the leaves English has', () => {
    const paths = leavesOf(dictionary)
      .map((leaf) => leaf.path)
      .sort();
    expect(paths).toEqual(ENGLISH_LEAVES.map((leaf) => leaf.path).sort());
  });

  it('leaves no sentence blank', () => {
    for (const leaf of leavesOf(dictionary)) {
      const values = typeof leaf.value === 'string' ? [leaf.value] : leaf.value;
      expect(values.length, leaf.path).toBeGreaterThan(0);
      for (const value of values) expect(value.trim(), leaf.path).not.toBe('');
    }
  });

  it('keeps every placeholder English uses, and invents none', () => {
    for (const leaf of stringLeavesOf(dictionary)) {
      const expected = [...placeholdersOf(ENGLISH_BY_PATH.get(leaf.path) ?? '')].sort();
      expect(placeholdersOf(leaf.value).sort(), leaf.path).toEqual(expected);
    }
  });

  it('has a short working line for every kind and stage English covers', () => {
    const kinds = Object.keys(english.working.lines) as RequestKind[];
    expect(Object.keys(dictionary.working.lines).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const stages = Object.keys(english.working.lines[kind]).sort();
      expect(Object.keys(dictionary.working.lines[kind]).sort(), kind).toEqual(stages);
      for (const stage of stages) {
        const lines =
          dictionary.working.lines[kind][
            stage as keyof (typeof english.working.lines)[typeof kind]
          ];
        expect(lines?.length, `${kind}/${stage}`).toBeGreaterThan(0);
        for (const line of lines ?? []) {
          expect(line.length, line).toBeLessThan(60);
          expect(line[0], line).toEqual(line[0]?.toUpperCase());
          expect(placeholdersOf(line), line).toEqual([]);
        }
      }
    }
  });

  it('names no model or vendor in a tier', () => {
    for (const tier of Object.values(dictionary.tiers)) {
      expect(tier.name, tier.name).not.toMatch(VENDOR_NAMES);
      expect(tier.cost, tier.cost).not.toMatch(VENDOR_NAMES);
      expect(tier.hint, tier.hint).not.toMatch(VENDOR_NAMES);
    }
  });
});

describe('Hebrew', () => {
  it('is written in Hebrew script, not transliterated or left in English', () => {
    const leaves = stringLeavesOf(DICTIONARIES.he);
    const hebrew = leaves.filter((leaf) => /[א-ת]/.test(leaf.value));
    expect(hebrew.length / leaves.length).toBeGreaterThanOrEqual(0.9);
  });
});

/**
 * Leaves that may legitimately read the same as English: keys whose value is
 * a product or format the languages share, plus the handful of words French
 * and Dutch spell exactly as English does.
 */
const SHARED_PREFIXES = [
  'tiers.',
  'login.emailPlaceholder',
  'working.usual.',
  'home.updated',
  'composer.exampleTask',
  'preview.updating',
  'login.sending',
  'composer.sending',
];
const SAME_WORD: Record<Exclude<Locale, 'en' | 'he'>, readonly string[]> = {
  fr: [
    'conversation.conversationTab',
    'conversation.conversationAria',
    'preview.mobile',
    'composer.effort',
  ],
  nl: [],
};

describe.each(TRANSLATED.filter((locale) => locale !== 'he') as Array<'fr' | 'nl'>)(
  '%s is translated, not copied',
  (locale) => {
    it('differs from English everywhere a translation is possible', () => {
      const untranslated = stringLeavesOf(DICTIONARIES[locale])
        .filter((leaf) => !SHARED_PREFIXES.some((prefix) => leaf.path.startsWith(prefix)))
        .filter((leaf) => !SAME_WORD[locale].includes(leaf.path))
        .filter((leaf) => leaf.value === ENGLISH_BY_PATH.get(leaf.path))
        .map((leaf) => leaf.path);
      expect(untranslated).toEqual([]);
    });

    it('keeps the same-word allowlist honest: each entry is a single word English shares', () => {
      for (const path of SAME_WORD[locale]) {
        const value = ENGLISH_BY_PATH.get(path);
        expect(value, path).toMatch(/^[A-Za-z]+$/);
        expect(stringLeavesOf(DICTIONARIES[locale]).find((leaf) => leaf.path === path)?.value).toBe(
          value,
        );
      }
    });
  },
);

describe('English is the source, not a copy', () => {
  it('shows the very sentences the routes write, so a code never reads two ways', () => {
    expect(english.errors).toBe(CLIENT_MESSAGES);
    expect(english.tiers).toBe(MODEL_TIER_LABELS);
  });
});

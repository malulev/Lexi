import { test as base, expect } from '@playwright/test';

/**
 * What these journeys cost, and why they do not run by default.
 *
 * Everything else in this suite runs against fakes. These do not: they drive a
 * real installation against a real repository, a real model, and a real hosting
 * provider, because the whole point of a journey is to catch what a fake cannot
 * — and yesterday it caught three faults that every fake had waved through.
 *
 * That makes them expensive in a way tests usually are not. Each run opens a
 * pull request, spends model tokens, and consumes hosting build minutes on
 * someone's account. A suite that did this on every push would quietly bill a
 * developer for running the tests. So they are opt-in: `WEBAGENT_E2E=1`, with a
 * signed session supplied by `npm run dev:session`, against an installation the
 * operator has already pointed at a throwaway site.
 *
 *   npm run dev                                    # terminal one
 *   npm run dev:session -- --out /tmp/e2e-jar.txt  # terminal two
 *   WEBAGENT_E2E=1 WEBAGENT_E2E_COOKIE="$(...)" npm run test:e2e
 *
 * Skipping is deliberately loud in the report rather than silent: a journey
 * that never runs and never says so is worse than one that fails.
 */

const ENABLED = process.env.WEBAGENT_E2E === '1';

/** The signed session cookie value, minted by `npm run dev:session`. */
const SESSION_COOKIE = process.env.WEBAGENT_E2E_COOKIE;

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
    if (SESSION_COOKIE) {
      await page.context().addCookies([
        { name: 'webagent_session', value: SESSION_COOKIE, domain: host, path: '/' },
      ]);
    }
    await use(page);
  },
});

/**
 * Call at the top of every journey. Reports why it is skipped rather than
 * leaving a reader to guess whether it passed or was never attempted.
 */
export function requireLiveInstallation(): void {
  test.skip(!ENABLED, 'live journey: set WEBAGENT_E2E=1 (spends model tokens and build minutes)');
  test.skip(
    ENABLED && !SESSION_COOKIE,
    'live journey: set WEBAGENT_E2E_COOKIE from `npm run dev:session`',
  );
}

export { expect };

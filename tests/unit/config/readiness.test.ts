import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkReadiness, resetReadiness } from '@/lib/config/readiness';
import type { StartupDeps, StartupReport } from '@/lib/config/startup';

/**
 * The cache is the reason this endpoint is safe to expose: without it, an
 * unauthenticated route that anyone may call is a way to make this
 * installation hammer GitHub and Netlify on demand.
 */

vi.mock('@/lib/config/startup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config/startup')>();
  return { ...actual, validateStartup: (...args: unknown[]) => validateStartup(...args) };
});

let validateStartup: (...args: unknown[]) => Promise<StartupReport>;
let calls = 0;

/** Stands in for the four probes; counts how often they were actually run. */
function reporting(report: StartupReport, delayMs = 0): void {
  calls = 0;
  validateStartup = async () => {
    calls += 1;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return report;
  };
}

const deps = {} as StartupDeps;

beforeEach(() => {
  resetReadiness();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetReadiness();
});

describe('checkReadiness', () => {
  it('reports ready when every probe passes', async () => {
    reporting({ ok: true });

    const result = await checkReadiness(deps);

    expect(result.ok).toBe(true);
    expect(result.faultSettings).toEqual([]);
    expect(calls).toBe(1);
  });

  it('serves a cached answer rather than probing again', async () => {
    reporting({ ok: true });

    await checkReadiness(deps);
    await checkReadiness(deps);
    await checkReadiness(deps);

    expect(calls).toBe(1);
  });

  it('runs one probe for concurrent callers, not one each', async () => {
    reporting({ ok: true }, 20);

    // A monitor, status.sh and a retry can all miss the cache in the same
    // second. A TTL alone would let each of them start its own round trip.
    const results = await Promise.all([
      checkReadiness(deps),
      checkReadiness(deps),
      checkReadiness(deps),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(calls).toBe(1);
  });

  it('names the settings at fault, and keeps the messages separate from them', async () => {
    reporting({
      ok: false,
      faults: [{ setting: 'NETLIFY_SITE_ID', message: 'site 12345 did not answer' }],
    });

    const result = await checkReadiness(deps);

    expect(result.ok).toBe(false);
    // The name is safe to publish; the message carries an account identifier
    // and is only ever handed to an authenticated caller.
    expect(result.faultSettings).toEqual(['NETLIFY_SITE_ID']);
    expect(result.faults[0]?.message).toContain('12345');
  });

  it('reports degraded rather than throwing when the environment cannot be loaded', async () => {
    calls = 0;
    validateStartup = async () => {
      calls += 1;
      throw new Error('env is unusable');
    };

    // "I cannot tell you" must not arrive as a 500: a monitor has to be able
    // to tell a broken installation from a broken probe.
    const result = await checkReadiness(deps);

    expect(result.ok).toBe(false);
    expect(result.faultSettings).toEqual(['CONFIGURATION']);
  });
});

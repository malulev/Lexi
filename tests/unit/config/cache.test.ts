// FR-003f, in code: a settings/policy fault must never widen access. The cache is
// the one place that guarantee lives, so these tests exercise it directly rather
// than through parseSettings — the loader it wraps is a plain async function.
import { describe, expect, it, vi } from 'vitest';
import { createConfigCache } from '@/lib/config/cache';
import type { RepoConfig } from '@/types';

function makeConfig(model: string): RepoConfig {
  return {
    settings: {
      alertContact: 'dev@agency.example',
      costCeilingUsd: 2,
      model,
      maxRequestMinutes: 10,
    },
    policy: {
      allow: ['**'],
      deny: [],
      maxFilesChanged: 15,
      maxDiffLines: 800,
      forbidNewDependencies: true,
    },
    guidance: '',
  };
}

describe('createConfigCache', () => {
  it('has no current config and no fault before the first refresh', () => {
    const cache = createConfigCache(async () => makeConfig('good'));

    expect(cache.current()).toBeNull();
    expect(cache.fault()).toBeNull();
  });

  it('adopts a successful refresh as current and clears any prior fault', async () => {
    const load = vi.fn().mockResolvedValue(makeConfig('good'));
    const cache = createConfigCache(load);

    const result = await cache.refresh();

    expect(result).toEqual({ ok: true, config: makeConfig('good') });
    expect(cache.current()).toEqual(makeConfig('good'));
    expect(cache.fault()).toBeNull();
  });

  it('keeps the previously valid config current when a later refresh fails, and records the fault', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(makeConfig('good'))
      .mockRejectedValueOnce(new Error('invalid settings: alertContact is not a valid email'));
    const cache = createConfigCache(load);

    const good = await cache.refresh();
    expect(good.ok).toBe(true);

    const bad = await cache.refresh();

    expect(bad.ok).toBe(false);
    // The good config is what callers still see. Access control never falls open.
    expect(cache.current()).toEqual(makeConfig('good'));
    expect(cache.fault()).not.toBeNull();
    expect(cache.fault()?.message).toMatch(/alertContact/);
  });

  it('leaves current() null when the very first refresh fails, with no last-known-good to fall back to', async () => {
    const load = vi.fn().mockRejectedValue(new Error('invalid settings: missing alertContact'));
    const cache = createConfigCache(load);

    const result = await cache.refresh();

    expect(result.ok).toBe(false);
    expect(cache.current()).toBeNull();
    expect(cache.fault()).not.toBeNull();
  });

  it('recovers on a subsequent good refresh after a failure, clearing the fault', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(makeConfig('good'))
      .mockRejectedValueOnce(new Error('bad yaml'))
      .mockResolvedValueOnce(makeConfig('fixed'));
    const cache = createConfigCache(load);

    await cache.refresh();
    await cache.refresh();
    const third = await cache.refresh();

    expect(third).toEqual({ ok: true, config: makeConfig('fixed') });
    expect(cache.current()).toEqual(makeConfig('fixed'));
    expect(cache.fault()).toBeNull();
  });

  it('records the fault time using the injected clock', async () => {
    const fixedNow = new Date('2026-09-02T12:00:00.000Z');
    const load = vi.fn().mockRejectedValue(new Error('bad yaml'));
    const cache = createConfigCache(load, { now: () => fixedNow });

    await cache.refresh();

    expect(cache.fault()?.at).toBe(fixedNow.toISOString());
  });

  /**
   * Nothing in this product reads configuration until a request needs it, and
   * a process that has never loaded any has nothing to serve. `ensureLoaded`
   * is what closes that gap without turning configuration into a per-request
   * read, which is exactly what this cache exists to avoid.
   */
  describe('ensureLoaded', () => {
    it('loads once when nothing has ever loaded', async () => {
      const load = vi.fn().mockResolvedValue(makeConfig('first'));
      const cache = createConfigCache(load);

      const config = await cache.ensureLoaded();

      expect(config).toEqual(makeConfig('first'));
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('does not read again once something has loaded', async () => {
      const load = vi.fn().mockResolvedValue(makeConfig('first'));
      const cache = createConfigCache(load);

      await cache.ensureLoaded();
      await cache.ensureLoaded();
      await cache.ensureLoaded();

      expect(load).toHaveBeenCalledTimes(1);
    });

    it('shares one read between callers that arrive together', async () => {
      // Two requests landing on a cold process must not both pay for a load,
      // and must not race to install different configs.
      let release: (config: ReturnType<typeof makeConfig>) => void = () => {};
      const pending = new Promise<ReturnType<typeof makeConfig>>((resolve) => {
        release = resolve;
      });
      const load = vi.fn().mockReturnValue(pending);
      const cache = createConfigCache(load);

      const both = Promise.all([cache.ensureLoaded(), cache.ensureLoaded()]);
      release(makeConfig('shared'));
      const [left, right] = await both;

      expect(load).toHaveBeenCalledTimes(1);
      expect(left).toEqual(makeConfig('shared'));
      expect(right).toEqual(makeConfig('shared'));
    });

    it('reports the fault rather than a config when the first load fails', async () => {
      const load = vi.fn().mockRejectedValue(new Error('config.yml: file is required'));
      const cache = createConfigCache(load);

      await expect(cache.ensureLoaded()).rejects.toThrow('config.yml: file is required');
      expect(cache.current()).toBeNull();
      expect(cache.fault()).not.toBeNull();
    });

    it('retries after a failed first load rather than caching the failure', async () => {
      const load = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(makeConfig('recovered'));
      const cache = createConfigCache(load);

      await expect(cache.ensureLoaded()).rejects.toThrow('transient');
      await expect(cache.ensureLoaded()).resolves.toEqual(makeConfig('recovered'));
    });
  });
});

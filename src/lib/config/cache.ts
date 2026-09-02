/**
 * The settings/policy cache — the mechanism behind FR-003f.
 *
 * Configuration is read at startup and on change (research.md R9), not per
 * request, because per-request reads would mean a transient GitHub failure or
 * a developer's typo-in-progress could take down every request. This cache is
 * what makes "read on change" safe: a failed refresh never displaces a good
 * config, so access control can never fall open on a bad or unreachable file.
 */
import type { RepoConfig } from '@/types';

export interface SettingsFault {
  at: string;
  message: string;
}

export interface ConfigCache {
  /** The last successfully loaded config, or null if none has ever loaded. */
  current(): RepoConfig | null;
  /** The most recent fault, or null if the last refresh (if any) succeeded. */
  fault(): SettingsFault | null;
  refresh(): Promise<{ ok: true; config: RepoConfig } | { ok: false; fault: SettingsFault }>;
  /**
   * The config, loading it first if nothing ever has. Rejects with the load's
   * own error when there is still nothing to serve.
   *
   * This is the "at startup" half of "at startup and on change", deferred to
   * the first caller that actually needs configuration. It is not a
   * per-request read: once a config is in hand, this never touches the network
   * again, so a later GitHub outage cannot take requests down.
   */
  ensureLoaded(): Promise<RepoConfig>;
}

export function createConfigCache(
  load: () => Promise<RepoConfig>,
  deps: { now?: () => Date } = {},
): ConfigCache {
  const now = deps.now ?? (() => new Date());
  let current: RepoConfig | null = null;
  let fault: SettingsFault | null = null;
  // Concurrent first requests share one load rather than each starting their
  // own, and a failed load is not remembered — the next caller may retry.
  let firstLoad: Promise<RepoConfig> | null = null;

  async function refresh(): ReturnType<ConfigCache['refresh']> {
    try {
      const config = await load();
      // Success displaces both the old config and any fault it left behind —
      // a developer who fixes the file should see the warning disappear.
      current = config;
      fault = null;
      return { ok: true, config };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fault = { at: now().toISOString(), message };
      // `current` is deliberately left untouched: a bad refresh must never
      // overwrite the last known-good config, and if there never was one,
      // it must stay null rather than invent a permissive default.
      return { ok: false, fault };
    }
  }

  async function ensureLoaded(): Promise<RepoConfig> {
    if (current) return current;
    if (firstLoad) return firstLoad;

    firstLoad = refresh().then((result) => {
      if (result.ok) return result.config;
      throw new Error(result.fault.message);
    });

    try {
      return await firstLoad;
    } finally {
      // Cleared either way. On success `current` is the fast path from here on;
      // on failure the next caller gets a fresh attempt rather than the old
      // rejection, since the fault may well have been transient.
      firstLoad = null;
    }
  }

  return {
    current: () => current,
    fault: () => fault,
    refresh,
    ensureLoaded,
  };
}

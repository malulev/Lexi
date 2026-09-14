import { log } from '@/lib/log';
import { buildStartupDeps, validateStartup, type StartupDeps, type StartupReport } from './startup';

/**
 * Is this installation still able to do its job?
 *
 * `startup.ts` answers that once, at boot, and then never again — so a GitHub
 * App token that stops minting, or a Netlify site someone deleted at hour
 * three, is undetectable until a client's request fails. This re-runs the same
 * four probes, unchanged, on a schedule set by whoever asks.
 *
 * Three properties, and the reasons they are not optional:
 *
 *  - **Single-flight.** The in-flight promise is shared, not just the result.
 *    A TTL alone does not stop a stampede: a monitor, `ops/status.sh` and a
 *    retry can all miss the cache in the same second and each start their own
 *    round trip to GitHub. This is what actually protects the upstreams from
 *    an endpoint anyone may call.
 *  - **Asymmetric TTL.** A healthy answer is worth keeping for minutes. A
 *    degraded one is re-probed far sooner, so recovery is noticed quickly
 *    rather than at the end of a long window.
 *  - **Stale while revalidating.** Past the TTL the last known answer is
 *    returned immediately and the refresh runs behind it, so this endpoint's
 *    latency never becomes GitHub's latency.
 *
 * It never throws. A probe that rejects is a *degraded report*, not a 500:
 * "I cannot tell you" and "I am broken" are different answers, and a monitor
 * has to be able to distinguish them.
 *
 * No durable state (constitution VII): one process-local object, in the same
 * class as the configuration cache and the token minter, rebuilt from nothing
 * on restart.
 */

const HEALTHY_TTL_MS = 300_000;
const DEGRADED_TTL_MS = 30_000;

export interface ReadinessResult {
  ok: boolean;
  /** Deployment variable names only — never a fault message. */
  faultSettings: string[];
  /** Full messages, for an authenticated caller. */
  faults: { setting: string; message: string }[];
  checkedAt: string;
  /** How old the answer being returned is, in milliseconds. */
  ageMs: number;
}

interface CacheEntry {
  result: Omit<ReadinessResult, 'ageMs'>;
  at: number;
}

let cached: CacheEntry | undefined;
let inFlight: Promise<CacheEntry> | undefined;

function ttlFor(entry: CacheEntry): number {
  return entry.result.ok ? HEALTHY_TTL_MS : DEGRADED_TTL_MS;
}

function toResult(report: StartupReport, checkedAt: string): Omit<ReadinessResult, 'ageMs'> {
  if (report.ok) return { ok: true, faultSettings: [], faults: [], checkedAt };
  return {
    ok: false,
    faultSettings: report.faults.map((fault) => fault.setting),
    faults: report.faults.map((fault) => ({ setting: fault.setting, message: fault.message })),
    checkedAt,
  };
}

async function probe(deps?: StartupDeps): Promise<CacheEntry> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  let result: Omit<ReadinessResult, 'ageMs'>;
  try {
    result = toResult(await validateStartup(deps ?? (await buildStartupDeps())), checkedAt);
  } catch {
    // Building the dependencies failed, which means the environment itself is
    // unusable. Reported as degraded under the setting a reader should look
    // at, never as an exception this endpoint's caller has to interpret.
    result = {
      ok: false,
      faultSettings: ['CONFIGURATION'],
      faults: [{ setting: 'CONFIGURATION', message: 'the environment could not be loaded' }],
      checkedAt,
    };
  }

  const entry: CacheEntry = { result, at: Date.now() };
  cached = entry;
  log.info('readiness.probed', {
    ok: result.ok,
    faultSettings: result.faultSettings,
    durationMs: Date.now() - startedAt,
  });
  return entry;
}

function refresh(deps?: StartupDeps): Promise<CacheEntry> {
  // One probe at a time, whoever asks. Shared before it resolves, which is
  // the whole point.
  inFlight ??= probe(deps).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

export async function checkReadiness(deps?: StartupDeps): Promise<ReadinessResult> {
  const entry = cached;
  const now = Date.now();

  if (!entry) {
    const fresh = await refresh(deps);
    return { ...fresh.result, ageMs: 0 };
  }

  if (now - entry.at > ttlFor(entry)) {
    // Stale: answer from what we have and refresh behind it. The rejection is
    // swallowed because `probe` already reports every failure as a result.
    void refresh(deps).catch(() => undefined);
  }

  return { ...entry.result, ageMs: now - entry.at };
}

/** Test seam; production has no reason to discard a cached answer. */
export function resetReadiness(): void {
  cached = undefined;
  inFlight = undefined;
}

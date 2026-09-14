/**
 * Server-only startup validation, in its own module so that nothing outside a
 * Node runtime can reach what it imports (see `instrumentation.ts`).
 *
 * Runs on import rather than exporting a function, because there is nothing for
 * a caller to decide: this module existing in the graph means the process is
 * starting and the configuration is about to be checked.
 */
import { loadEnv } from '@/lib/config/env';
import { assertStartupValid } from '@/lib/config/startup';
import { initLogRedaction, log } from '@/lib/log';

// Before anything can be logged: registers this installation's own secret
// values so they can never appear in a line, however they got into one. A
// failure to load the environment is itself a startup refusal, and the catch
// below reports it — the static credential-shaped patterns still apply until
// this succeeds.
try {
  initLogRedaction(loadEnv());
} catch {
  // Reported by assertStartupValid a moment later, in the form an operator
  // can act on. Swallowed here so redaction setup cannot become its own,
  // worse, failure message.
}

const startedAt = Date.now();
try {
  await assertStartupValid();
  log.info('startup.ok', { durationMs: Date.now() - startedAt });
} catch (error) {
  /**
   * Throwing is not enough, and this is the difference between a deployment
   * that reports a broken installation and one that hides it.
   *
   * Next catches whatever the instrumentation hook throws, logs "Failed to
   * prepare server", and leaves the process running — so the container stays
   * `Up`, the restart policy sees nothing to restart, and every monitor that
   * asks the orchestrator rather than the port calls it healthy. It answers
   * no request; it simply never says so. Verified against the built image, not
   * assumed.
   *
   * Exiting non-zero makes the refusal the visible thing it is meant to be
   * (FR-003b): the container stops, Compose's restart policy retries it with
   * Docker's own backoff, and `ops/status.sh` shows a client that is down for
   * a stated reason.
   *
   * Printed once, plainly, before exiting: Next's own handler would otherwise
   * repeat the whole fault list three times, wrapped in a stack trace through
   * minified chunk names, which buries the one part an operator needs — the
   * name of the setting to go and fix.
   */
  const message = error instanceof Error ? error.message : String(error);
  // Structured first, for the monitor: a refusal and a crash look identical
  // from outside, and the setting names are what separate them. `startup.ts`
  // interpolates only identifiers into these, never a credential.
  log.error('startup.refused', {
    durationMs: Date.now() - startedAt,
    faultSettings: settingNamesIn(message),
  });
  // Then the plain human line Next's own handler would otherwise bury in a
  // stack trace through minified chunk names.
  console.error(message);
  process.exit(1);
}

/**
 * The setting names out of an aggregated startup message, for the alert
 * subject line. `StartupFault.setting` is always a deployment variable name —
 * upper snake case — so they can be recovered without restructuring what
 * `assertStartupValid` throws.
 */
function settingNamesIn(message: string): string[] {
  return Array.from(new Set(message.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) ?? []));
}

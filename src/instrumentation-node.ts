/**
 * Server-only startup validation, in its own module so that nothing outside a
 * Node runtime can reach what it imports (see `instrumentation.ts`).
 *
 * Runs on import rather than exporting a function, because there is nothing for
 * a caller to decide: this module existing in the graph means the process is
 * starting and the configuration is about to be checked.
 */
import { assertStartupValid } from '@/lib/config/startup';

try {
  await assertStartupValid();
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

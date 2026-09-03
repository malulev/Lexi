/**
 * Server-only startup validation, in its own module so that nothing outside a
 * Node runtime can reach what it imports (see `instrumentation.ts`).
 *
 * Runs on import rather than exporting a function, because there is nothing for
 * a caller to decide: this module existing in the graph means the process is
 * starting and the configuration is about to be checked.
 */
import { assertStartupValid } from '@/lib/config/startup';

await assertStartupValid();

import type { LogEvent } from './events';
import { redactField } from './redact';

/**
 * One JSON object per line, to stdout. That is the whole design.
 *
 * No logging library. This installation is one Next standalone process whose
 * stdout Docker already captures to a json-file that a collector tails; the
 * transports, worker threads and serializer API a library brings would all be
 * unused, and every dependency here is one more thing that has to be excluded
 * from the client bundle.
 *
 * What the shape has to earn is being *queryable*: a fixed `event` name to
 * match on, a fixed spelling for every correlation field, and values that a
 * `| json` filter can unwrap without a parser of its own.
 *
 * ## What must never appear in a line
 *
 * `LogFields` admits no `unknown`, no `object` and no `Error`. That is the
 * point, not an inconvenience: `console.error(msg, cause)` serialises whatever
 * an upstream library chose to hang off its error, which is exactly how a
 * credential reaches a log aggregator. An error is passed as
 * `error: describe(cause)` — its message, deliberately not its properties.
 *
 * Agent stdout is never log content. The durable record in the pull request
 * keeps it, where the client already controls access; a log line carries its
 * length and nothing else.
 */

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue | readonly string[]>;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

/**
 * An error's message, and at `debug` its stack. Never the error object: an
 * Octokit or dockerode error carries request headers and connection options,
 * and `util.inspect` walks all of it.
 */
export function describe(cause: unknown): string {
  if (cause instanceof Error) {
    return configuredLevel() === 'debug' && cause.stack ? cause.stack : cause.message;
  }
  if (typeof cause === 'string') return cause;
  return String(cause);
}

/** Longer than any real trace; short enough that one line cannot fill a log file. */
const STACK_MAX_CHARS = 4_000;

/**
 * An error's stack, bounded, for the one line that reports a fault nobody
 * expected. `describe` gives the message at every level so a line stays
 * readable; this is the companion field for when the message alone does not
 * say where. Still never the object (see `describe`).
 */
export function stackOf(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !cause.stack) return undefined;
  return cause.stack.length > STACK_MAX_CHARS
    ? `${cause.stack.slice(0, STACK_MAX_CHARS - 1)}…`
    : cause.stack;
}

function emit(level: LogLevel, event: LogEvent, fields: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;

  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    line[key] = redactField(key, value);
  }

  // stdout for every level. Splitting warn and error onto stderr would split
  // one request's story across two streams for a collector to reassemble.
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  debug: (event: LogEvent, fields: LogFields = {}) => emit('debug', event, fields),
  info: (event: LogEvent, fields: LogFields = {}) => emit('info', event, fields),
  warn: (event: LogEvent, fields: LogFields = {}) => emit('warn', event, fields),
  error: (event: LogEvent, fields: LogFields = {}) => emit('error', event, fields),
};

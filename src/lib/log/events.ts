/**
 * Every event name this installation may emit.
 *
 * A closed union rather than free strings, for the same reason `ErrorCode` is
 * one: the name is the primary key every query, dashboard and alert rule
 * matches on, so a typo must be a compile error rather than a rule that
 * silently matches nothing forever.
 *
 * `noun.verb_past`, lowercase, dotted. The noun is the subsystem a reader
 * would go and look at.
 */
export type LogEvent =
  // The request lifecycle — the events metrics are derived from.
  | 'request.started'
  | 'request.ended'
  | 'request.lock_leak'
  | 'publication.started'
  | 'publication.ended'
  // Capacity.
  | 'slot.waited'
  | 'slots.count_failed'
  // Boot and continuous readiness.
  | 'startup.ok'
  | 'startup.refused'
  | 'readiness.probed'
  // Faults that are handled but worth counting.
  | 'agent.run_failed'
  // The agent's own last words, on a line the collector drops before shipping
  // (ops/monitoring/alloy/config.alloy). Read it with `docker logs`; it never
  // reaches the external log service.
  | 'agent.run_failed_detail'
  | 'runner.cleanup_failed'
  | 'lock.broken_stale'
  | 'lock.release_failed'
  | 'config.load_failed'
  | 'bus.listener_threw'
  | 'http.unexpected'
  | 'netlify.webhook'
  | 'notify.failed'
  | 'auth.refused';

import type { ErrorCode, PolicyViolation } from '@/types';

/**
 * Every word a client reads when something goes wrong.
 *
 * Constitution Principle I: the client never sees code. No file path, no diff,
 * no build log, no branch name and no git vocabulary may appear here. That is
 * not a style preference — it is the property `tests/unit/messages.test.ts`
 * asserts over this table, so a leak fails the build rather than reaching a
 * client.
 *
 * The vocabulary is closed. A failure that does not map to one of these codes
 * is `internal_error`, because inventing a message at the call site is how
 * stack traces reach client surfaces.
 */
export const CLIENT_MESSAGES: Record<ErrorCode, string> = {
  blocked_by_policy: 'Your developer has protected this part of the site.',
  request_in_flight: 'A change is already being applied — one moment.',
  agent_timeout: 'That took too long. Try a smaller or more specific change.',
  build_failed: 'The change broke the site build. I can try to fix it.',
  site_unreachable: "Can't reach your website's hosting right now.",
  cost_ceiling: 'That request was larger than this site’s limit allows.',
  out_of_date: 'Your site changed since this was made — it needs rebuilding first.',
  nothing_to_change: 'Nothing needed changing for that.',
  internal_error: 'Something went wrong on my side. Nothing was published.',
};

/** The HTTP status each code answers with, per contracts/http-api.md. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  blocked_by_policy: 422,
  request_in_flight: 409,
  agent_timeout: 504,
  build_failed: 422,
  site_unreachable: 502,
  cost_ceiling: 422,
  out_of_date: 409,
  nothing_to_change: 200,
  internal_error: 500,
};

export function clientMessage(code: ErrorCode): string {
  return CLIENT_MESSAGES[code];
}

/**
 * A gate violation always reads as one message, whatever the rule that fired.
 *
 * The client is told an area is protected; which rule caught it is the
 * developer's concern and lives in the durable record, not in the chat.
 */
export function messageForViolation(_violation: PolicyViolation): string {
  return CLIENT_MESSAGES.blocked_by_policy;
}

/** The body every route returns on a failure. Shape is uniform so the interface never guesses. */
export function errorBody(code: ErrorCode): { error: ErrorCode; message: string } {
  return { error: code, message: clientMessage(code) };
}

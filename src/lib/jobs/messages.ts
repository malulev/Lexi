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
  nothing_to_publish: 'There is nothing ready to publish here.',
  nothing_to_undo: 'There is nothing here to undo.',
  site_moved_on:
    'Your website has changed since this went live, so undoing it now would take those newer changes with it.',
  internal_error: 'Something went wrong on my side. Nothing was published.',
};

/**
 * The one ending with no error code of its own.
 *
 * An abandoned request failed at nothing — its process stopped existing, so
 * there is no stage that went wrong and no code to name. It still owes the
 * client a sentence, and that sentence belongs in this table with the others
 * so the Principle I audit covers it too.
 */
export const INTERRUPTED_MESSAGE =
  'That request was interrupted before it finished. Nothing was published.';

/**
 * Why publishing or undoing was refused, in more detail than the code alone.
 *
 * These live here rather than beside the routes that answer them for one
 * reason: `tests/unit/messages.test.ts` audits this module against Principle I,
 * and a client-facing sentence written anywhere else is a sentence nothing
 * checks. They refine `nothing_to_publish` and `nothing_to_undo` — the code is
 * what the interface branches on, the sentence is what the client reads.
 */
export const PUBLISH_REFUSALS = {
  not_previewed:
    'There is nothing ready to publish here yet. Wait for the preview, then approve it.',
  published: 'This change is already published.',
  undone: 'This change was published and then undone. Start a new one to change your site again.',
  unavailable: 'This conversation is finished, so there is nothing to publish.',
} as const;

export const UNDO_REFUSALS = {
  not_previewed: 'Nothing from this conversation has been published, so there is nothing to undo.',
  ready: 'This change has not been published yet, so there is nothing to undo.',
  undone: 'This change has already been undone.',
  unavailable: 'Nothing from this conversation is live, so there is nothing to undo.',
} as const;

/** Every sentence a client can be shown when something does not go ahead. */
export const CLIENT_PROSE: readonly string[] = [
  ...Object.values(CLIENT_MESSAGES),
  INTERRUPTED_MESSAGE,
  ...Object.values(PUBLISH_REFUSALS),
  ...Object.values(UNDO_REFUSALS),
];

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
  nothing_to_publish: 409,
  nothing_to_undo: 409,
  site_moved_on: 409,
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

/**
 * The body every route returns on a failure. Shape is uniform so the interface
 * never guesses.
 *
 * `message` may be narrowed past the code's default — "this change is already
 * published" says more than "there is nothing ready to publish here" — but only
 * from a sentence in this module, so the Principle I audit still covers it. A
 * route composing its own sentence would be a client-facing string nothing
 * checks.
 */
export function errorBody(
  code: ErrorCode,
  message: string = clientMessage(code),
): { error: ErrorCode; message: string } {
  return { error: code, message };
}

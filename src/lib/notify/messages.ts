import type { NotificationEvent } from '@/types';

/**
 * Every word a client reads in a notification email.
 *
 * This is a client surface exactly like `src/lib/jobs/messages.ts`'s error
 * vocabulary, and is bound by the same rule (constitution Principle I): no
 * file path, no diff, no build log, no branch name, no git vocabulary, no
 * pull request number. `tests/unit/notify/messages.test.ts` audits that
 * property over the whole table, the way `tests/unit/messages.test.ts`
 * audits the error vocabulary.
 *
 * The one identifier a client is shown is the conversation itself, and it is
 * shown only as a link into this product — `${publicBaseUrl}/c/{number}`
 * (built in `email.ts`) — never as bare text like "conversation #42". A
 * hosting provider's own deploy-preview URL is deliberately excluded from
 * `NotificationContext` below: it names the build system exactly as a
 * branch name or commit SHA would, so there is no field here for a caller
 * to smuggle it through, even though `NotifyInput.previewUrl` (email.ts)
 * carries it for other purposes.
 */

export interface NotificationContext {
  conversationTitle: string;
  /** Always `${publicBaseUrl}/c/{conversation.number}`. */
  link: string;
}

export interface NotificationContent {
  subject: string;
  text: string;
}

type Template = (context: NotificationContext) => NotificationContent;

export const NOTIFICATION_TEMPLATES: Record<NotificationEvent, Template> = {
  preview_ready: ({ conversationTitle, link }) => ({
    subject: `Preview ready: ${conversationTitle}`,
    text: `Your preview of "${conversationTitle}" is ready to look at. Open the conversation: ${link}`,
  }),
  request_blocked: ({ conversationTitle, link }) => ({
    subject: `Change blocked: ${conversationTitle}`,
    text: `A change to "${conversationTitle}" was stopped by your site's protections. Open the conversation to see what happened: ${link}`,
  }),
  request_failed: ({ conversationTitle, link }) => ({
    subject: `Change failed: ${conversationTitle}`,
    text: `A change to "${conversationTitle}" could not be completed. Nothing was published. Open the conversation: ${link}`,
  }),
  published: ({ conversationTitle, link }) => ({
    subject: `Published: ${conversationTitle}`,
    text: `"${conversationTitle}" is now live on your site. Open the conversation: ${link}`,
  }),
  undone: ({ conversationTitle, link }) => ({
    subject: `Undone: ${conversationTitle}`,
    text: `"${conversationTitle}" has been undone — your site is back to how it was before. Open the conversation: ${link}`,
  }),
};

export function notificationContent(
  event: NotificationEvent,
  context: NotificationContext,
): NotificationContent {
  return NOTIFICATION_TEMPLATES[event](context);
}

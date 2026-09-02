import nodemailer from 'nodemailer';
import type { RepoClient } from '@/lib/github/types';
import { hasNotified, parseComment, renderRecord, withNotified } from '@/lib/record';
import type { Env, NotificationEvent, RequestRecord } from '@/types';
import { notificationContent } from './messages';

/**
 * The whole surface `notifyOnce` depends on, so it can be tested against
 * `createFakeMailer` without ever touching SMTP or the network.
 */
export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** The real mailer, built from `SMTP_URL`. `nodemailer` is used nowhere else in this module. */
export function createMailer(env: Env): Mailer {
  const transport = nodemailer.createTransport(env.smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({
        from: env.smtpFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

/** An in-memory mailer for tests: records what was sent, opens no connection. */
export function createFakeMailer(): Mailer & {
  readonly sent: Array<{ to: string; subject: string; text: string }>;
} {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

export interface NotifyInput {
  event: NotificationEvent;
  conversation: { number: number; title: string };
  /** The comment carrying this request's record, so `notified` can be read and rewritten. */
  commentId: number;
  record: RequestRecord;
  recipients: string[];
  previewUrl?: string;
}

/**
 * Sends one notification email at most once per event per request (OD-004).
 *
 * There is no delivery record and no datastore (constitution VII): the
 * `notified` list on the durable record IS the delivery record, which is
 * why the record lives in the same comment the request outcome already
 * occupies. That makes the order of the two side effects below the entire
 * design of this function.
 *
 * The comment is rewritten to include the event BEFORE the email is sent.
 * Netlify (and any webhook source upstream of this call) can redeliver the
 * same event more than once, so this function must survive being called
 * twice for one event. Between "duplicate email" and "a silent
 * non-delivery the system believes it made", this chooses to risk the
 * latter: if `mailer.send` throws below, the record already lists the event
 * as notified, so a retry will not send a second copy. There is nothing
 * to reconcile a delivery flag against afterwards, so under-notifying is
 * the recoverable failure and over-notifying is not — a client who never
 * got an email can still open the conversation and see its state; a client
 * emailed twice for one event has no equivalent undo. The failure is not
 * swallowed, though: `send` throwing rejects this function, so the caller
 * can still log and alert on it even though the record itself will not retry.
 */
export async function notifyOnce(
  deps: { mailer: Mailer; client: RepoClient; env: Env },
  input: NotifyInput,
): Promise<{ sent: boolean; reason?: 'already_notified' }> {
  if (hasNotified(input.record, input.event)) {
    return { sent: false, reason: 'already_notified' };
  }

  const prose = await readProse(deps.client, input.conversation.number, input.commentId);
  const updatedRecord = withNotified(input.record, input.event);
  await deps.client.updateComment(input.commentId, renderRecord(prose, updatedRecord));

  const { subject, text } = notificationContent(input.event, {
    conversationTitle: input.conversation.title,
    link: `${deps.env.publicBaseUrl}/c/${input.conversation.number}`,
  });
  await deps.mailer.send({ to: input.recipients.join(', '), subject, text });

  return { sent: true };
}

/** The prose half of the comment being rewritten, so the rewrite leaves it untouched. */
async function readProse(
  client: RepoClient,
  conversationNumber: number,
  commentId: number,
): Promise<string> {
  const comments = await client.listComments(conversationNumber);
  const target = comments.find((comment) => comment.id === commentId);
  if (!target) {
    throw new Error(`notifyOnce: comment ${commentId} not found on conversation ${conversationNumber}`);
  }
  return parseComment(target).prose;
}

import {
  branchFor,
  lastBuildFailureDetail,
  readConversation,
  renderClientMessage,
} from '@/lib/conversations';
import { getInstallation, type Installation } from '@/lib/installation';
import { beginRequest, type BeginOutcome } from '@/lib/jobs/run';
import { notifyOnce } from '@/lib/notify/email';
import type { NotificationEvent, RequestRecord } from '@/types';

/**
 * Starting a request is the same act whether it opens a conversation or
 * continues one, so it is written once. A follow-up commits to the same branch
 * and the same pull request, refreshing the preview the client is already
 * looking at rather than opening a competing one (FR-006).
 */

export interface StartInput {
  conversationNumber: number;
  message: string;
  targetHint?: string;
}

export async function startRequest(input: StartInput): Promise<BeginOutcome> {
  const installation = getInstallation();
  const { client, config } = installation;

  // A cold process has never read the repository's settings, and there is no
  // safe default to invent for a file that says what a change may touch.
  const settings = await config.ensureLoaded();

  const detail = await readConversation(client, input.conversationNumber);
  if (!detail) throw new Error(`conversation ${input.conversationNumber} does not exist`);

  // The client's own words go into the conversation before the work starts, so
  // a request interrupted by a restart still shows what was asked for.
  await client.createComment(input.conversationNumber, renderClientMessage(input.message));

  const defaultBranch = await client.getDefaultBranch();
  const buildFailureDetail = lastBuildFailureDetail(detail.records);

  return beginRequest(
    {
      client,
      lock: installation.lock,
      mirror: installation.mirror,
      runner: installation.runner,
      netlify: installation.netlify,
      bus: installation.bus,
      env: installation.env,
      onFinished: (record, commentId) =>
        notifyClients(installation, detail.conversation.title, input.conversationNumber, record, commentId),
      config: settings,
    },
    {
      conversationNumber: input.conversationNumber,
      branch: detail.conversation.branch || branchFor(input.conversationNumber),
      baseBranch: defaultBranch,
      message: input.message,
      history: detail.messages,
      ...(input.targetHint ? { targetHint: input.targetHint } : {}),
      ...(buildFailureDetail ? { buildFailureDetail } : {}),
    },
  );
}

/**
 * The request runs past the response. The client is told a request started and
 * watches the progress stream; holding the HTTP connection open for four
 * minutes would tie the request's fate to a browser tab.
 */
export async function startAndDetach(input: StartInput): Promise<BeginOutcome> {
  const begun = await startRequest(input);
  if (begun.started) {
    void begun.completed.catch((cause) => {
      console.error(`[webagent] request on conversation ${input.conversationNumber} failed`, cause);
    });
  }
  return begun;
}

/**
 * Tells the client what happened, once.
 *
 * The record's own `notified` list is the delivery record (OD-004), so calling
 * this twice for one event sends one email. A notification that cannot be sent
 * is logged rather than raised: the request itself already succeeded or failed
 * on its own terms, and failing it again over an email would be reporting the
 * wrong outcome.
 */
async function notifyClients(
  installation: Installation,
  title: string,
  conversationNumber: number,
  record: RequestRecord,
  commentId: number,
): Promise<void> {
  const event = notificationEventFor(record);
  if (!event) return;

  try {
    await notifyOnce(
      { mailer: installation.mailer, client: installation.client, env: installation.env },
      {
        event,
        conversation: { number: conversationNumber, title },
        commentId,
        record,
        recipients: installation.env.allowedEmails,
        ...(record.previewUrl ? { previewUrl: record.previewUrl } : {}),
      },
    );
  } catch (cause) {
    console.error(`[webagent] could not notify about conversation ${conversationNumber}`, cause);
  }
}

/** An abandoned request is not announced: nobody asked for the ending it got. */
function notificationEventFor(record: RequestRecord): NotificationEvent | null {
  if (record.outcome === 'succeeded') return 'preview_ready';
  if (record.outcome === 'blocked') return 'request_blocked';
  if (record.outcome === 'failed') return 'request_failed';
  return null;
}

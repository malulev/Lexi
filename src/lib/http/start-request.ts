import {
  branchFor,
  collectRefusedPaths,
  lastBuildFailureDetail,
  readConversation,
  renderClientMessage,
} from '@/lib/conversations';
import { getInstallation, type Installation } from '@/lib/installation';
import { discardAttachments } from '@/lib/jobs/attachments';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import { beginRequest, DEFAULT_ERROR_DETAIL, type BeginOutcome } from '@/lib/jobs/run';
import { notifyOnce } from '@/lib/notify/email';
import { renderRecord } from '@/lib/record/record';
import type { Attachment, ModelTier, NotificationEvent, RequestRecord } from '@/types';

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
  modelTier?: ModelTier;
  attachments?: Attachment[];
}

export async function startRequest(input: StartInput): Promise<BeginOutcome> {
  try {
    return await startRequestOrThrow(input);
  } catch (cause) {
    // Nothing started, so nothing downstream will remove the attachments.
    await discardAttachments(input.attachments);
    throw cause;
  }
}

async function startRequestOrThrow(input: StartInput): Promise<BeginOutcome> {
  const installation = getInstallation();
  const { client, config } = installation;

  // A cold process has never read the repository's settings, and there is no
  // safe default to invent for a file that says what a change may touch.
  const settings = await config.ensureLoaded();

  const detail = await readConversation(client, input.conversationNumber);
  if (!detail) throw new Error(`conversation ${input.conversationNumber} does not exist`);

  // The client's own words go into the conversation before the work starts, so
  // a request interrupted by a restart still shows what was asked for. The
  // names of anything attached go with them: a page reads back what was sent.
  await client.createComment(
    input.conversationNumber,
    renderClientMessage(
      input.message,
      input.attachments?.map((attachment) => attachment.name),
    ),
  );

  const defaultBranch = await client.getDefaultBranch();
  const buildFailureDetail = lastBuildFailureDetail(detail.records);
  // Read from the records, never from the messages: the messages are what the
  // client is served, and a file path may not appear there (Principle I).
  const refusedPaths = collectRefusedPaths(detail.records);

  return beginRequest(
    {
      client,
      // The cost-ceiling alert goes to the developer, and without a mailer here
      // it is written but never sent.
      mailer: installation.mailer,
      lock: installation.lock,
      mirror: installation.mirror,
      runner: installation.runner,
      slots: installation.slots,
      netlify: installation.netlify,
      bus: installation.bus,
      env: installation.env,
      // Control directories go under the shared state dir, never this
      // container's /tmp, or the agent's /control mounts empty on the host.
      workRoot: installation.workRoot,
      onFinished: (record, commentId) =>
        notifyClients(
          installation,
          detail.conversation.title,
          input.conversationNumber,
          record,
          commentId,
        ),
      config: settings,
    },
    {
      conversationNumber: input.conversationNumber,
      branch: detail.conversation.branch || branchFor(input.conversationNumber),
      baseBranch: defaultBranch,
      message: input.message,
      history: detail.messages,
      ...(input.targetHint ? { targetHint: input.targetHint } : {}),
      ...(input.modelTier ? { modelTier: input.modelTier } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(buildFailureDetail ? { buildFailureDetail } : {}),
      ...(refusedPaths.length ? { refusedPaths } : {}),
    },
  );
}

/**
 * Starts a request without waiting for the lock's answer at all.
 *
 * For a brand-new conversation the route has already inspected the lock and
 * answered the client, so everything here happens after the response. Should
 * the lock nonetheless be held by the time it is asked for — another request
 * squeezed in between the inspection and the acquisition — the refusal is
 * written into the conversation as a finished request, so the client's page
 * shows it in the same words a `409` would have carried rather than showing a
 * message that was sent and then nothing at all.
 */
export function startDetached(input: StartInput): void {
  void startAndDetach(input)
    .then((begun) => (begun.started ? undefined : recordRefusal(input)))
    .catch((cause) => {
      console.error(
        `[webagent] could not start the request on conversation ${input.conversationNumber}`,
        cause,
      );
      return recordRefusal(input, 'internal_error');
    });
}

async function recordRefusal(
  input: StartInput,
  errorCode: 'request_in_flight' | 'internal_error' = 'request_in_flight',
): Promise<void> {
  const { client } = getInstallation();
  const at = new Date().toISOString();
  const record: RequestRecord = {
    requestId: `r_refused_${at}`,
    startedAt: at,
    finishedAt: at,
    outcome: 'failed',
    stages: [{ stage: 'failed', at }],
    errorCode,
    errorDetail: DEFAULT_ERROR_DETAIL[errorCode],
  };
  try {
    await client.createComment(
      input.conversationNumber,
      renderRecord(CLIENT_MESSAGES[errorCode], record),
    );
  } catch (cause) {
    console.error(
      `[webagent] could not record a refusal on conversation ${input.conversationNumber}`,
      cause,
    );
  }
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

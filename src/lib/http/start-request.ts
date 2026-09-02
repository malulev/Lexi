import {
  branchFor,
  lastBuildFailureDetail,
  readConversation,
  renderClientMessage,
} from '@/lib/conversations';
import { getInstallation } from '@/lib/installation';
import { beginRequest, type BeginOutcome } from '@/lib/jobs/run';

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

  const settings = config.current();
  if (!settings) throw new Error('configuration has never loaded; refusing to run a request');

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

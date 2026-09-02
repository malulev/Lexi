import { RefAlreadyExistsError } from '@/lib/github/types';
import type { CommentInfo, PullRequestInfo, RepoClient } from '@/lib/github/types';
import { parseComment } from '@/lib/record/record';
import type { Conversation, Message, RequestRecord } from '@/types';

/**
 * A conversation *is* a pull request, and a message *is* a comment. Nothing
 * here is stored; every function reads upstream and assembles (constitution
 * VII, FR-009b).
 *
 * Two consequences worth naming. History survives a restart of this product
 * because it never lived here. And the shape of a conversation is whatever
 * GitHub says it is right now, so a change made in the pull request by a
 * developer shows up in the client's view without anything being synchronised.
 */

/** Marks a comment this product wrote on a client's behalf, so it reads back as theirs. */
const CLIENT_MARKER = '<!-- webagent:client -->';

export const BRANCH_PREFIX = 'webagent/c-';

export function branchFor(conversationNumber: number): string {
  return `${BRANCH_PREFIX}${conversationNumber}`;
}

/**
 * The commit a conversation's branch starts at.
 *
 * A pull request cannot exist without one: GitHub refuses a head that is not
 * ahead of its base, so a branch cut at the default branch's tip has nothing
 * to open a pull request from. This commit changes no file — it reuses the
 * base commit's tree — and exists only so the conversation has somewhere to
 * live before any change has been made. Principle II is untouched: it lands on
 * the conversation's own branch, never on the default branch.
 */
const ANCHOR_MESSAGE = 'open a conversation';

/**
 * Cuts a branch for a new conversation and returns its name.
 *
 * The name embeds the pull request number, which does not exist until the pull
 * request does, so the number is predicted from the highest one seen. Ref
 * creation is a compare-and-swap, so a prediction another process already took
 * is observed rather than silently overwritten, and the next number is tried.
 * Everything downstream reads the pull request's own `headRef`, so a wrong
 * prediction costs a misleading branch name and nothing else.
 */
export async function claimConversationBranch(
  client: RepoClient,
  baseSha: string,
): Promise<{ branch: string; sha: string }> {
  const existing = await client.listPullRequests();
  const highest = existing.reduce((max, pullRequest) => Math.max(max, pullRequest.number), 0);

  // One anchor commit serves every attempt: it is the same commit whichever
  // name ends up pointing at it, and an attempt that loses the race leaves it
  // unreferenced rather than leaving a branch behind.
  const sha = await client.createLockCommit(ANCHOR_MESSAGE, baseSha);

  for (let offset = 1; offset <= 10; offset += 1) {
    const branch = branchFor(highest + offset);
    try {
      await client.createRef(`refs/heads/${branch}`, sha);
      return { branch, sha };
    } catch (cause) {
      if (!(cause instanceof RefAlreadyExistsError)) throw cause;
    }
  }

  throw new Error('could not claim a branch name for a new conversation');
}

export function renderClientMessage(text: string): string {
  return `${CLIENT_MARKER}\n${text.trim()}`;
}

// ---------------------------------------------------------------------------

export function toConversation(pullRequest: PullRequestInfo, previewUrl?: string): Conversation {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    status: pullRequest.merged ? 'published' : pullRequest.state === 'closed' ? 'closed' : 'open',
    branch: pullRequest.headRef,
    headSha: pullRequest.headSha,
    updatedAt: pullRequest.updatedAt,
    ...(previewUrl ? { previewUrl } : {}),
  };
}

/** Only the conversations this product opened; a developer's own pull requests are not chat. */
export async function listConversations(client: RepoClient): Promise<Conversation[]> {
  const pullRequests = await client.listPullRequests();
  return pullRequests
    .filter((pullRequest) => pullRequest.headRef.startsWith(BRANCH_PREFIX))
    .map((pullRequest) => toConversation(pullRequest, latestPreviewUrlOf(pullRequest)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The list view has no comments to read, so a preview URL is only known per conversation. */
function latestPreviewUrlOf(_pullRequest: PullRequestInfo): string | undefined {
  return undefined;
}

// ---------------------------------------------------------------------------

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  records: RequestRecord[];
  /** The comment carrying the most recent request's record, for notification. */
  lastRecordCommentId?: number;
}

export async function readConversation(
  client: RepoClient,
  number: number,
): Promise<ConversationDetail | null> {
  const pullRequest = await client.getPullRequest(number);
  if (!pullRequest) return null;

  const comments = await client.listComments(number);
  const parsed = comments.map((comment) => parseComment(comment));
  const records = parsed.flatMap((entry) => (entry.record ? [entry.record] : []));
  const previewUrl = [...records].reverse().find((record) => record.previewUrl)?.previewUrl;

  return {
    conversation: toConversation(pullRequest, previewUrl),
    messages: comments.flatMap((comment, index) => {
      const record = parsed[index]?.record;
      return isOurs(comment, record) ? [toMessage(comment, record)] : [];
    }),
    records,
    ...lastRecordCommentIdOf(comments, parsed),
  };
}

function lastRecordCommentIdOf(
  comments: CommentInfo[],
  parsed: ReturnType<typeof parseComment>[],
): { lastRecordCommentId?: number } {
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    if (parsed[index]?.record) return { lastRecordCommentId: comments[index]!.id };
  }
  return {};
}

/**
 * A pull request is a public place: Netlify's deploy bot announces every build
 * there, and so does any developer with repository access. Their comments carry
 * commit shas, deploy logs and file paths, so a conversation is only what this
 * product itself wrote — the client's marked turns and its own records
 * (Principle I). `records` is unaffected, being derived from the comments
 * regardless.
 */
function isOurs(comment: CommentInfo, record: RequestRecord | undefined): boolean {
  return record !== undefined || comment.body.includes(CLIENT_MARKER);
}

/**
 * A comment carrying a record is something this product did; anything else is a
 * turn from a person. Client turns wear a marker so they read back as the
 * client's own words rather than as an unattributed note on a pull request.
 */
function toMessage(comment: CommentInfo, record: RequestRecord | undefined): Message {
  if (record) {
    return {
      id: comment.id,
      author: 'agent',
      at: comment.createdAt,
      text: stripBlock(comment.body),
      outcome: record.outcome,
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
      ...(record.previewUrl ? { previewUrl: record.previewUrl } : {}),
    };
  }

  return {
    id: comment.id,
    author: 'client',
    at: comment.createdAt,
    text: comment.body.replace(CLIENT_MARKER, '').trim(),
  };
}

function stripBlock(body: string): string {
  const marker = body.lastIndexOf('<!-- webagent:v1');
  return (marker === -1 ? body : body.slice(0, marker)).trim();
}

// ---------------------------------------------------------------------------

/**
 * The last request's build failure, so the next attempt is told what it broke
 * (FR-023). Read from the record rather than remembered, because there is
 * nowhere to remember it.
 */
export function lastBuildFailureDetail(records: RequestRecord[]): string | undefined {
  const last = records.at(-1);
  if (!last || last.errorCode !== 'build_failed') return undefined;
  return last.errorDetail;
}

/**
 * Every path the gate has refused in this conversation, so the next attempt is
 * told what not to try again.
 *
 * All of the records, not just the recent ones. A refusal is the policy
 * speaking, and the policy is a property of the repository rather than of a
 * moment: a path refused on the second request is still refused on the
 * twentieth unless a developer edits `policy.yml`, and the observed bug was an
 * agent re-attempting a refusal several turns old. The list is bounded by the
 * number of blocked requests in one conversation, at most one path each, so it
 * cannot grow the way history can. A stale entry after a developer widens the
 * policy costs one path the agent leaves alone; the gate, not the prompt,
 * remains the boundary (Principle III).
 *
 * The paths stay here, derived from the records. `Message` is serialised
 * straight to the client, and a path in it would be a Principle I breach.
 */
export function collectRefusedPaths(records: RequestRecord[]): string[] {
  const paths = records.flatMap((record) =>
    record.outcome === 'blocked' && record.blockedPath ? [record.blockedPath] : [],
  );
  return [...new Set(paths)];
}

/** A title a client would recognise, drawn from their own words. */
export function titleFor(message: string): string {
  const firstLine = message.trim().split('\n')[0]?.trim() ?? 'Website change';
  if (firstLine.length <= 60) return firstLine;
  return `${firstLine.slice(0, 57)}...`;
}

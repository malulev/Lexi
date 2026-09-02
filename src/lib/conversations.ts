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
    messages: comments.map((comment, index) => toMessage(comment, parsed[index]?.record)),
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

/** A title a client would recognise, drawn from their own words. */
export function titleFor(message: string): string {
  const firstLine = message.trim().split('\n')[0]?.trim() ?? 'Website change';
  if (firstLine.length <= 60) return firstLine;
  return `${firstLine.slice(0, 57)}...`;
}

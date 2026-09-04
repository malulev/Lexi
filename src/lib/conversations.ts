import { isRefAlreadyExistsError } from '@/lib/github/types';
import type { CommentInfo, PullRequestInfo, RepoClient } from '@/lib/github/types';
import { parseComment, renderRecord } from '@/lib/record/record';
import type { Conversation, Message, RequestKind, RequestRecord } from '@/types';

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
      if (!isRefAlreadyExistsError(cause)) throw cause;
    }
  }

  throw new Error('could not claim a branch name for a new conversation');
}

/**
 * The client's turn, as it is written into the conversation. Attached files
 * are named after the words, by the names the client gave them: the names are
 * the client's own vocabulary, and a turn that silently dropped them would
 * read back as a request the agent answered with images from nowhere.
 */
export function renderClientMessage(text: string, attachmentNames: string[] = []): string {
  const names = attachmentNames.map((name) => name.trim()).filter((name) => name.length > 0);
  const attached = names.length > 0 ? `\n\nAttached: ${names.join(', ')}` : '';
  return `${CLIENT_MARKER}\n${text.trim()}${attached}`;
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
      ...(record.model ? { model: record.model } : {}),
      ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
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

// ---------------------------------------------------------------------------
// Publishing and taking back — user story 2
// ---------------------------------------------------------------------------

/**
 * Publishing and undoing are finished requests too, so each writes the same
 * durable record every other request writes, and the two are told apart by the
 * identifier they carry.
 *
 * That identifier is the whole mechanism by which "already published" and
 * "already undone" survive a restart without a datastore (constitution VII).
 * The pull request says a change was merged; nothing upstream says a merge was
 * later reversed, because a revert is an ordinary commit on the default branch
 * and this product cannot walk that history through the interface it has. The
 * record it wrote at the time can, and lives in the conversation itself.
 */
const PUBLISH_REQUEST_PREFIX = 'publish_';
const UNDO_REQUEST_PREFIX = 'undo_';

export type PublicationKind = 'publish' | 'undo';

export type PublishState =
  /** Nothing has succeeded yet, so there is nothing a client could approve. */
  | 'not_previewed'
  /** A successful preview stands: approval may be offered (FR-027). */
  | 'ready'
  /** Live, and reversible (FR-029). */
  | 'published'
  /** Published and then taken back; the conversation is finished. */
  | 'undone'
  /** Closed without publishing. */
  | 'unavailable';

function publicationKindOf(record: RequestRecord): PublicationKind | null {
  const kind = requestKindOf(record.requestId);
  return kind === 'change' ? null : kind;
}

/** What a request was for, read back from the identifier its record carries. */
export function requestKindOf(requestId: string): RequestKind {
  if (requestId.startsWith(PUBLISH_REQUEST_PREFIX)) return 'publish';
  if (requestId.startsWith(UNDO_REQUEST_PREFIX)) return 'undo';
  return 'change';
}

/** The identifier a publish or an undo runs under, on the bus and in its record alike. */
export function publicationRequestId(kind: PublicationKind, at: string): string {
  return `${kind === 'publish' ? PUBLISH_REQUEST_PREFIX : UNDO_REQUEST_PREFIX}${at}`;
}

/**
 * What this conversation may do next, derived from what upstream already says.
 *
 * The newest request decides, not the best one: a conversation whose first
 * attempt previewed cleanly and whose second broke the build has a broken
 * change waiting on its branch, and offering to publish that would publish the
 * breakage (FR-027, acceptance scenario 5).
 */
export function selectPublishState(
  detail: Pick<ConversationDetail, 'conversation' | 'records'>,
): PublishState {
  if (detail.conversation.status === 'published') {
    const lastPublication = detail.records.map(publicationKindOf).filter(Boolean).at(-1);
    return lastPublication === 'undo' ? 'undone' : 'published';
  }

  if (detail.conversation.status === 'closed') return 'unavailable';

  const last = detail.records.at(-1);
  return last?.outcome === 'succeeded' && last.previewUrl ? 'ready' : 'not_previewed';
}

/** The record a publish or an undo leaves behind: an audit entry nobody can quietly rewrite (FR-031). */
export function buildPublicationRecord(input: {
  kind: PublicationKind;
  at: string;
  /** Machine-readable only — it is in the block, never in the prose above it. */
  commitSha?: string;
}): RequestRecord {
  return {
    requestId: publicationRequestId(input.kind, input.at),
    startedAt: input.at,
    finishedAt: input.at,
    outcome: 'succeeded',
    stages: [{ stage: 'succeeded', at: input.at }],
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
  };
}

/**
 * What the client reads in the conversation afterwards.
 *
 * The acting person is named because this comment is the audit trail (FR-031,
 * acceptance scenario 4), and the live site is linked because a client who has
 * just published wants to look at it (FR-028). Neither is a leak: an address
 * this installation was configured for, and the client's own website.
 */
export function publicationProse(input: {
  kind: PublicationKind;
  actor: string;
  liveUrl?: string;
}): string {
  if (input.kind === 'undo') {
    return `Undone by ${input.actor}. Your website is going back to how it was before this change${
      input.liveUrl ? `, at ${input.liveUrl}` : ''
    }. It takes a few minutes to update.`;
  }

  return `Published by ${input.actor}. Your change is going live${
    input.liveUrl ? ` at ${input.liveUrl}` : ''
  } and takes a few minutes to appear.`;
}

/**
 * Writes the publish or undo into the conversation, where it is both the
 * client's confirmation and the audit entry (FR-028, FR-031).
 *
 * One comment, written after the act rather than before it: a record of a
 * publish that did not happen would be worse than no record at all.
 */
export async function recordPublication(
  client: RepoClient,
  input: {
    conversationNumber: number;
    kind: PublicationKind;
    actor: string;
    at: string;
    commitSha: string;
    liveUrl?: string;
  },
): Promise<{ commentId: number; record: RequestRecord }> {
  const record = buildPublicationRecord({
    kind: input.kind,
    at: input.at,
    commitSha: input.commitSha,
  });
  const prose = publicationProse({
    kind: input.kind,
    actor: input.actor,
    ...(input.liveUrl ? { liveUrl: input.liveUrl } : {}),
  });
  const comment = await client.createComment(input.conversationNumber, renderRecord(prose, record));
  return { commentId: comment.id, record };
}

/** A title a client would recognise, drawn from their own words. */
export function titleFor(message: string): string {
  const firstLine = message.trim().split('\n')[0]?.trim() ?? 'Website change';
  if (firstLine.length <= 60) return firstLine;
  return `${firstLine.slice(0, 57)}...`;
}

import type { CommentInfo, PullRequestInfo, RefInfo, RepoClient } from './types';
import { RefAlreadyExistsError } from './types';

/**
 * An in-memory `RepoClient`, faithful to the same behaviours the real client
 * guarantees — the lock's compare-and-swap, 404-as-null, comment ordering,
 * incrementing pull request numbers — so the lock, the orchestrator, and
 * route integration tests can run against it instead of GitHub.
 *
 * `state` is exposed live, not copied, specifically so a test can reach in
 * and mutate it: ageing a lock ref's `committedAt` to exercise staleness is
 * the motivating example.
 *
 * As in `client.ts`, each operation is a standalone function over a small
 * context rather than a closure holding the whole client's surface.
 */

interface FakeCommit {
  sha: string;
  tree: string;
  parents: string[];
  committedAt: string;
  /** Read back by the lock, whose commit message names the request holding it. */
  message?: string;
}

export interface FakeState {
  defaultBranch: string;
  files: Record<string, string>;
  refs: Record<string, RefInfo>;
  commits: Record<string, FakeCommit>;
  pullRequests: PullRequestInfo[];
  comments: Record<number, CommentInfo[]>;
}

export interface FakeRepoClientSeed {
  defaultBranch?: string;
  files?: Record<string, string>;
  pullRequests?: PullRequestInfo[];
  now?: () => Date;
}

interface Ctx {
  state: FakeState;
  nowIso: () => string;
  counters: { nextPrNumber: number; nextCommentId: number; shaCounter: number };
}

function headsRef(branch: string): string {
  return `refs/heads/${branch}`;
}

function buildInitialState(seed: FakeRepoClientSeed | undefined, nowIso: () => string): FakeState {
  const defaultBranch = seed?.defaultBranch ?? 'main';
  const genesisSha = 'fake-genesis-commit';
  const at = nowIso();
  return {
    defaultBranch,
    files: { ...(seed?.files ?? {}) },
    refs: { [headsRef(defaultBranch)]: { ref: headsRef(defaultBranch), sha: genesisSha, committedAt: at } },
    commits: { [genesisSha]: { sha: genesisSha, tree: 'fake-genesis-tree', parents: [], committedAt: at } },
    pullRequests: [...(seed?.pullRequests ?? [])],
    comments: {},
  };
}

function nextSha(ctx: Ctx): string {
  return `fake-sha-${(ctx.counters.shaCounter += 1)}`;
}

/** A commit referenced without prior seeding still resolves, so a test need not pre-populate every sha it hands the fake. */
function ensureCommit(ctx: Ctx, sha: string): FakeCommit {
  return (ctx.state.commits[sha] ??= {
    sha,
    tree: `fake-tree-for-${sha}`,
    parents: [],
    committedAt: ctx.nowIso(),
  });
}

function requirePullRequest(ctx: Ctx, number: number): PullRequestInfo {
  const pr = ctx.state.pullRequests.find((candidate) => candidate.number === number);
  if (!pr) throw new Error(`no such pull request: #${number}`);
  return pr;
}

async function readFile(ctx: Ctx, path: string, _ref?: string): Promise<string | null> {
  return ctx.state.files[path] ?? null;
}

async function getDefaultBranch(ctx: Ctx): Promise<string> {
  return ctx.state.defaultBranch;
}

async function createRef(ctx: Ctx, ref: string, sha: string): Promise<void> {
  if (ctx.state.refs[ref]) throw new RefAlreadyExistsError(ref);
  ensureCommit(ctx, sha);
  ctx.state.refs[ref] = { ref, sha, committedAt: ctx.nowIso() };
}

async function deleteRef(ctx: Ctx, ref: string): Promise<void> {
  delete ctx.state.refs[ref];
}

async function getRef(ctx: Ctx, ref: string): Promise<RefInfo | null> {
  const entry = ctx.state.refs[ref];
  return entry ? { ...entry } : null;
}

async function createLockCommit(ctx: Ctx, message: string, parentSha: string): Promise<string> {
  const parent = ensureCommit(ctx, parentSha);
  const sha = nextSha(ctx);
  ctx.state.commits[sha] = {
    sha,
    tree: parent.tree,
    parents: [parentSha],
    committedAt: ctx.nowIso(),
    message,
  };
  return sha;
}

/** Modelled because the lock reads it back to name the request it is ending. */
async function getCommitMessage(ctx: Ctx, sha: string): Promise<string | null> {
  return ctx.state.commits[sha]?.message ?? null;
}

async function createPullRequest(
  ctx: Ctx,
  input: { title: string; head: string; base: string; body: string },
): Promise<PullRequestInfo> {
  const headSha = ctx.state.refs[headsRef(input.head)]?.sha ?? nextSha(ctx);

  // GitHub answers 422 "No commits between <base> and <head>" for a head that
  // is not ahead of its base, and a fake that accepts it lets a branch opened
  // at the base SHA pass every test and fail against the real API.
  const baseSha = ctx.state.refs[headsRef(input.base)]?.sha;
  if (baseSha !== undefined && baseSha === headSha) {
    throw new Error(
      `github create pull request from ${input.head} failed for fake/repo: ` +
        `No commits between ${input.base} and ${input.head}`,
    );
  }

  const number = ctx.counters.nextPrNumber++;
  const pr: PullRequestInfo = {
    number,
    title: input.title,
    body: input.body,
    state: 'open',
    merged: false,
    headRef: input.head,
    headSha,
    baseRef: input.base,
    updatedAt: ctx.nowIso(),
  };
  ctx.state.pullRequests.push(pr);
  ctx.state.comments[number] = [];
  return { ...pr };
}

async function getPullRequest(ctx: Ctx, number: number): Promise<PullRequestInfo | null> {
  const pr = ctx.state.pullRequests.find((candidate) => candidate.number === number);
  return pr ? { ...pr } : null;
}

async function listPullRequests(ctx: Ctx): Promise<PullRequestInfo[]> {
  // Newest first, matching the real API's default list order.
  return [...ctx.state.pullRequests].sort((a, b) => b.number - a.number).map((pr) => ({ ...pr }));
}

async function updatePullRequest(
  ctx: Ctx,
  number: number,
  input: { title?: string; body?: string; state?: 'open' | 'closed' },
): Promise<PullRequestInfo> {
  const pr = requirePullRequest(ctx, number);
  Object.assign(pr, input, { updatedAt: ctx.nowIso() });
  return { ...pr };
}

async function listComments(ctx: Ctx, number: number): Promise<CommentInfo[]> {
  requirePullRequest(ctx, number);
  return (ctx.state.comments[number] ?? []).map((comment) => ({ ...comment }));
}

async function createComment(ctx: Ctx, number: number, body: string): Promise<CommentInfo> {
  requirePullRequest(ctx, number);
  const comment: CommentInfo = {
    id: (ctx.counters.nextCommentId += 1),
    author: 'webagent-bot',
    body,
    createdAt: ctx.nowIso(),
  };
  (ctx.state.comments[number] ??= []).push(comment);
  return { ...comment };
}

async function updateComment(ctx: Ctx, commentId: number, body: string): Promise<CommentInfo> {
  for (const comments of Object.values(ctx.state.comments)) {
    const comment = comments.find((candidate) => candidate.id === commentId);
    if (comment) {
      comment.body = body;
      return { ...comment };
    }
  }
  throw new Error(`no such comment: ${commentId}`);
}

async function mergePullRequest(ctx: Ctx, number: number): Promise<{ sha: string }> {
  const pr = requirePullRequest(ctx, number);
  const baseTip = ctx.state.refs[headsRef(ctx.state.defaultBranch)];
  const mergeSha = nextSha(ctx);
  ctx.state.commits[mergeSha] = {
    sha: mergeSha,
    tree: ensureCommit(ctx, pr.headSha).tree,
    parents: [baseTip?.sha, pr.headSha].filter((sha): sha is string => Boolean(sha)),
    committedAt: ctx.nowIso(),
  };
  ctx.state.refs[headsRef(ctx.state.defaultBranch)] = {
    ref: headsRef(ctx.state.defaultBranch),
    sha: mergeSha,
    committedAt: ctx.nowIso(),
  };
  Object.assign(pr, { merged: true, state: 'closed', mergeCommitSha: mergeSha, updatedAt: ctx.nowIso() });
  return { sha: mergeSha };
}

async function revertCommit(ctx: Ctx, sha: string, branch: string): Promise<{ sha: string }> {
  const merge = ctx.state.commits[sha];
  if (!merge) throw new Error(`no such commit: ${sha}`);
  const mainlineParentSha = merge.parents[0];
  if (!mainlineParentSha) throw new Error(`commit ${sha} has no parent; it is not a merge commit`);
  const mainlineParent = ensureCommit(ctx, mainlineParentSha);
  const currentTip = ctx.state.refs[headsRef(branch)];
  if (!currentTip) throw new Error(`no such branch: ${branch}`);

  const revertSha = nextSha(ctx);
  ctx.state.commits[revertSha] = {
    sha: revertSha,
    tree: mainlineParent.tree,
    parents: [currentTip.sha],
    committedAt: ctx.nowIso(),
  };
  ctx.state.refs[headsRef(branch)] = { ref: headsRef(branch), sha: revertSha, committedAt: ctx.nowIso() };
  return { sha: revertSha };
}

/** Every commit reachable from `sha` through the fake's own parent links. */
function ancestorsOf(ctx: Ctx, sha: string | undefined): Set<string> {
  const seen = new Set<string>();
  const queue = sha ? [sha] : [];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(ctx.state.commits[current]?.parents ?? []));
  }
  return seen;
}

/**
 * Modelled by walking parent links rather than by comparing timestamps, so a
 * test that advances the default branch past a conversation sees the same
 * answer the real compare endpoint would give.
 */
async function compareBranches(
  ctx: Ctx,
  base: string,
  head: string,
): Promise<{ aheadBy: number; behindBy: number }> {
  const baseAncestors = ancestorsOf(ctx, ctx.state.refs[headsRef(base)]?.sha);
  const headAncestors = ancestorsOf(ctx, ctx.state.refs[headsRef(head)]?.sha);
  const aheadBy = [...headAncestors].filter((sha) => !baseAncestors.has(sha)).length;
  const behindBy = [...baseAncestors].filter((sha) => !headAncestors.has(sha)).length;
  return { aheadBy, behindBy };
}

async function authenticatedRemoteUrl(): Promise<string> {
  return 'https://x-access-token:fake-installation-token@github.com/fake-owner/fake-repo.git';
}

export function createFakeRepoClient(seed?: FakeRepoClientSeed): RepoClient & { readonly state: FakeState } {
  const clock = seed?.now ?? (() => new Date());
  const nowIso = (): string => clock().toISOString();
  const state = buildInitialState(seed, nowIso);
  const startingPrNumber = state.pullRequests.reduce((max, pr) => Math.max(max, pr.number), 0) + 1;
  const ctx: Ctx = {
    state,
    nowIso,
    counters: { nextPrNumber: startingPrNumber, nextCommentId: 5000, shaCounter: 0 },
  };

  return {
    readFile: (path, ref) => readFile(ctx, path, ref),
    getDefaultBranch: () => getDefaultBranch(ctx),
    createRef: (ref, sha) => createRef(ctx, ref, sha),
    deleteRef: (ref) => deleteRef(ctx, ref),
    getRef: (ref) => getRef(ctx, ref),
    createLockCommit: (message, parentSha) => createLockCommit(ctx, message, parentSha),
    getCommitMessage: (sha) => getCommitMessage(ctx, sha),
    createPullRequest: (input) => createPullRequest(ctx, input),
    getPullRequest: (number) => getPullRequest(ctx, number),
    listPullRequests: () => listPullRequests(ctx),
    updatePullRequest: (number, input) => updatePullRequest(ctx, number, input),
    listComments: (number) => listComments(ctx, number),
    createComment: (number, body) => createComment(ctx, number, body),
    updateComment: (commentId, body) => updateComment(ctx, commentId, body),
    mergePullRequest: (number) => mergePullRequest(ctx, number),
    revertCommit: (sha, branch) => revertCommit(ctx, sha, branch),
    compareBranches: (base, head) => compareBranches(ctx, base, head),
    authenticatedRemoteUrl,
    state,
  };
}

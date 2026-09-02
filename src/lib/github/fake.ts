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
 */

interface FakeCommit {
  sha: string;
  tree: string;
  parents: string[];
  committedAt: string;
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

function headsRef(branch: string): string {
  return `refs/heads/${branch}`;
}

function buildInitialState(seed?: FakeRepoClientSeed, genesisSha = 'fake-genesis-commit'): FakeState {
  const defaultBranch = seed?.defaultBranch ?? 'main';
  const now = (seed?.now ?? (() => new Date()))().toISOString();
  const genesis: FakeCommit = { sha: genesisSha, tree: 'fake-genesis-tree', parents: [], committedAt: now };
  return {
    defaultBranch,
    files: { ...(seed?.files ?? {}) },
    refs: { [headsRef(defaultBranch)]: { ref: headsRef(defaultBranch), sha: genesisSha, committedAt: now } },
    commits: { [genesisSha]: genesis },
    pullRequests: [...(seed?.pullRequests ?? [])],
    comments: {},
  };
}

export function createFakeRepoClient(
  seed?: FakeRepoClientSeed,
): RepoClient & { readonly state: FakeState } {
  const clock = seed?.now ?? (() => new Date());
  const state = buildInitialState(seed);
  let nextPrNumber = state.pullRequests.reduce((max, pr) => Math.max(max, pr.number), 0) + 1;
  let nextCommentId = 5000;
  let shaCounter = 0;

  const nowIso = (): string => clock().toISOString();
  const nextSha = (): string => `fake-sha-${(shaCounter += 1)}`;

  /** A commit created or referenced without prior seeding still resolves, so a test need not pre-populate every sha it hands the fake. */
  function ensureCommit(sha: string): FakeCommit {
    return (state.commits[sha] ??= { sha, tree: `fake-tree-for-${sha}`, parents: [], committedAt: nowIso() });
  }

  function requirePullRequest(number: number): PullRequestInfo {
    const pr = state.pullRequests.find((candidate) => candidate.number === number);
    if (!pr) throw new Error(`no such pull request: #${number}`);
    return pr;
  }

  async function readFile(path: string, _ref?: string): Promise<string | null> {
    return state.files[path] ?? null;
  }

  async function getDefaultBranch(): Promise<string> {
    return state.defaultBranch;
  }

  async function createRef(ref: string, sha: string): Promise<void> {
    if (state.refs[ref]) throw new RefAlreadyExistsError(ref);
    ensureCommit(sha);
    state.refs[ref] = { ref, sha, committedAt: nowIso() };
  }

  async function deleteRef(ref: string): Promise<void> {
    delete state.refs[ref];
  }

  async function getRef(ref: string): Promise<RefInfo | null> {
    const entry = state.refs[ref];
    return entry ? { ...entry } : null;
  }

  async function createLockCommit(message: string, parentSha: string): Promise<string> {
    const parent = ensureCommit(parentSha);
    const sha = nextSha();
    state.commits[sha] = { sha, tree: parent.tree, parents: [parentSha], committedAt: nowIso() };
    void message; // recorded on the real ref's commit message; not modelled here
    return sha;
  }

  async function createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<PullRequestInfo> {
    const number = nextPrNumber++;
    const headSha = state.refs[headsRef(input.head)]?.sha ?? nextSha();
    const pr: PullRequestInfo = {
      number,
      title: input.title,
      body: input.body,
      state: 'open',
      merged: false,
      headRef: input.head,
      headSha,
      baseRef: input.base,
      updatedAt: nowIso(),
    };
    state.pullRequests.push(pr);
    state.comments[number] = [];
    return { ...pr };
  }

  async function getPullRequest(number: number): Promise<PullRequestInfo | null> {
    const pr = state.pullRequests.find((candidate) => candidate.number === number);
    return pr ? { ...pr } : null;
  }

  async function listPullRequests(): Promise<PullRequestInfo[]> {
    // Newest first, matching the real API's default list order.
    return [...state.pullRequests].sort((a, b) => b.number - a.number).map((pr) => ({ ...pr }));
  }

  async function updatePullRequest(
    number: number,
    input: { title?: string; body?: string; state?: 'open' | 'closed' },
  ): Promise<PullRequestInfo> {
    const pr = requirePullRequest(number);
    Object.assign(pr, input, { updatedAt: nowIso() });
    return { ...pr };
  }

  async function listComments(number: number): Promise<CommentInfo[]> {
    requirePullRequest(number);
    return (state.comments[number] ?? []).map((comment) => ({ ...comment }));
  }

  async function createComment(number: number, body: string): Promise<CommentInfo> {
    requirePullRequest(number);
    const comment: CommentInfo = { id: (nextCommentId += 1), author: 'webagent-bot', body, createdAt: nowIso() };
    (state.comments[number] ??= []).push(comment);
    return { ...comment };
  }

  async function updateComment(commentId: number, body: string): Promise<CommentInfo> {
    for (const comments of Object.values(state.comments)) {
      const comment = comments.find((candidate) => candidate.id === commentId);
      if (comment) {
        comment.body = body;
        return { ...comment };
      }
    }
    throw new Error(`no such comment: ${commentId}`);
  }

  async function mergePullRequest(number: number): Promise<{ sha: string }> {
    const pr = requirePullRequest(number);
    const baseTip = state.refs[headsRef(state.defaultBranch)];
    const mergeSha = nextSha();
    state.commits[mergeSha] = {
      sha: mergeSha,
      tree: ensureCommit(pr.headSha).tree,
      parents: [baseTip?.sha, pr.headSha].filter((sha): sha is string => Boolean(sha)),
      committedAt: nowIso(),
    };
    state.refs[headsRef(state.defaultBranch)] = {
      ref: headsRef(state.defaultBranch),
      sha: mergeSha,
      committedAt: nowIso(),
    };
    Object.assign(pr, { merged: true, state: 'closed', mergeCommitSha: mergeSha, updatedAt: nowIso() });
    return { sha: mergeSha };
  }

  async function revertCommit(sha: string, branch: string): Promise<{ sha: string }> {
    const merge = state.commits[sha];
    if (!merge) throw new Error(`no such commit: ${sha}`);
    const mainlineParentSha = merge.parents[0];
    if (!mainlineParentSha) throw new Error(`commit ${sha} has no parent; it is not a merge commit`);
    const mainlineParent = ensureCommit(mainlineParentSha);
    const currentTip = state.refs[headsRef(branch)];
    if (!currentTip) throw new Error(`no such branch: ${branch}`);

    const revertSha = nextSha();
    state.commits[revertSha] = {
      sha: revertSha,
      tree: mainlineParent.tree,
      parents: [currentTip.sha],
      committedAt: nowIso(),
    };
    state.refs[headsRef(branch)] = { ref: headsRef(branch), sha: revertSha, committedAt: nowIso() };
    return { sha: revertSha };
  }

  async function authenticatedRemoteUrl(): Promise<string> {
    return 'https://x-access-token:fake-installation-token@github.com/fake-owner/fake-repo.git';
  }

  return {
    readFile,
    getDefaultBranch,
    createRef,
    deleteRef,
    getRef,
    createLockCommit,
    createPullRequest,
    getPullRequest,
    listPullRequests,
    updatePullRequest,
    listComments,
    createComment,
    updateComment,
    mergePullRequest,
    revertCommit,
    authenticatedRemoteUrl,
    state,
  };
}

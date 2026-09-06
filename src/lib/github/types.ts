/**
 * The repository client's surface, declared apart from its implementation so
 * that the modules depending on it — configuration loading, the lock, the
 * orchestrator — are testable against a fake without Octokit or the network.
 */

export interface RefInfo {
  ref: string;
  sha: string;
  /** Committer date of the commit the ref points at. Gives the ref its age. */
  committedAt: string;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  headRef: string;
  headSha: string;
  baseRef: string;
  updatedAt: string;
  mergeCommitSha?: string;
}

export interface CommentInfo {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

/** Thrown when a ref already exists. This is what makes ref creation a CAS. */
export class RefAlreadyExistsError extends Error {
  constructor(public readonly ref: string) {
    super(`ref already exists: ${ref}`);
    this.name = 'RefAlreadyExistsError';
  }
}

/** Thrown when a repository object is absent, distinct from a transport fault. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when a revert is asked for a commit that is no longer the branch tip.
 *
 * Reverting reconstructs the state before a merge, which reverses exactly that
 * one change only while the merge is still the tip. Once later commits have
 * landed, the same construction would discard them, and the Git Data API has
 * no three-way revert that could keep them — so the operation refuses. The
 * caller reports this to the client as a website that has moved on since.
 */
export class RevertNotAtTipError extends Error {
  constructor(
    public readonly sha: string,
    public readonly branch: string,
    public readonly tip: string,
  ) {
    super(
      `refusing to revert ${sha}: ${branch} has advanced to ${tip}, so reverting would discard the commits since`,
    );
    this.name = 'RevertNotAtTipError';
  }
}

/**
 * Recognise these errors by name, never by `instanceof`.
 *
 * The installation is one object per process (src/lib/installation.ts), but
 * this module is not one module per process: the framework bundles each
 * route separately, so the client that throws lives in one bundle and the
 * caller that catches may live in another, each holding its own copy of the
 * class. `instanceof` across that seam is false, and a refusal the caller was
 * written to handle becomes a crash. The name survives the seam.
 */
export function isRefAlreadyExistsError(error: unknown): error is RefAlreadyExistsError {
  return error instanceof Error && error.name === 'RefAlreadyExistsError';
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof Error && error.name === 'NotFoundError';
}

export function isRevertNotAtTipError(error: unknown): error is RevertNotAtTipError {
  return error instanceof Error && error.name === 'RevertNotAtTipError';
}

export interface RepoClient {
  /** File contents at a ref, or `null` when the file does not exist. */
  readFile(path: string, ref?: string): Promise<string | null>;

  getDefaultBranch(): Promise<string>;

  /** Rejects with `RefAlreadyExistsError` when the ref exists (R3). */
  createRef(ref: string, sha: string): Promise<void>;
  deleteRef(ref: string): Promise<void>;
  getRef(ref: string): Promise<RefInfo | null>;

  /** Creates a commit with no parent tree change, used to anchor the lock ref. */
  createLockCommit(message: string, parentSha: string): Promise<string>;

  /**
   * The message of a commit, or `null` when there is none to read.
   *
   * This exists for one reason: the lock ref points at a commit whose message
   * names the request holding it, and a process breaking a stale lock has no
   * other way to learn whose request it is ending. Without this, an abandoned
   * request is recorded anonymously, which is a worse history than none.
   */
  getCommitMessage(sha: string): Promise<string | null>;

  createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<PullRequestInfo>;
  getPullRequest(number: number): Promise<PullRequestInfo | null>;
  listPullRequests(): Promise<PullRequestInfo[]>;
  updatePullRequest(
    number: number,
    input: { title?: string; body?: string; state?: 'open' | 'closed' },
  ): Promise<PullRequestInfo>;

  listComments(number: number): Promise<CommentInfo[]>;
  createComment(number: number, body: string): Promise<CommentInfo>;
  updateComment(commentId: number, body: string): Promise<CommentInfo>;

  mergePullRequest(number: number): Promise<{ sha: string }>;
  /** Reverts a merge on the default branch. Returns the revert commit. */
  revertCommit(sha: string, branch: string): Promise<{ sha: string }>;

  /**
   * How two branches relate by ancestry: `aheadBy` commits reachable from
   * `head` but not `base`, `behindBy` the reverse. Both short branch names.
   * This is what lets "has the site moved on since this change was made?"
   * be answered exactly rather than guessed from commit timestamps.
   */
  compareBranches(base: string, head: string): Promise<{ aheadBy: number; behindBy: number }>;

  /** The authenticated remote URL, held by the host and never by the container. */
  authenticatedRemoteUrl(): Promise<string>;
}

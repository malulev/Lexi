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

  /** The authenticated remote URL, held by the host and never by the container. */
  authenticatedRemoteUrl(): Promise<string>;
}

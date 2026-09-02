import { Octokit } from 'octokit';
import type { Env } from '@/types';
import type { TokenMinter } from './auth';
import { createTokenMinter } from './auth';
import type { CommentInfo, PullRequestInfo, RefInfo, RepoClient } from './types';
import { RefAlreadyExistsError } from './types';

/**
 * The repository client. Everything the rest of the installation knows about
 * GitHub goes through here, so tests elsewhere run against `fake.ts` instead.
 *
 * HTTP is plain `fetch`, injected into Octokit's `request.fetch` hook rather
 * than reached through Octokit's own network stack, so a test can hand it a
 * function that serves recorded fixtures and never touches a socket.
 *
 * Ref convention: `ref` parameters on `createRef`/`getRef`/`deleteRef` are
 * the fully qualified form used by the lock (`refs/webagent/lock`) and by
 * conversation branches (`refs/heads/webagent/c-<n>`). `getDefaultBranch`
 * and `revertCommit`'s `branch` argument use the short branch name, matching
 * what the GitHub API itself returns for a repository's default branch.
 */

function stripRefsPrefix(ref: string): string {
  return ref.replace(/^refs\//, '');
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status as number | undefined
    : undefined;
}

function githubMessageOf(error: unknown): string | undefined {
  const data =
    typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { data?: unknown } }).response?.data
      : undefined;
  if (data && typeof data === 'object' && 'message' in data) {
    return String((data as { message?: unknown }).message);
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

/** GitHub's one documented shape for "the ref you tried to create is taken" (R3). */
function isRefAlreadyExists(error: unknown): boolean {
  return statusOf(error) === 422 && /already exists/i.test(githubMessageOf(error) ?? '');
}

function describeError(operation: string, repoSlug: string, error: unknown): Error {
  const reason = githubMessageOf(error) ?? (error instanceof Error ? error.message : String(error));
  return new Error(`github ${operation} failed for ${repoSlug}: ${reason}`);
}

function toPullRequestInfo(data: {
  number: number;
  title: string | null;
  body: string | null;
  state: string;
  merged?: boolean | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  updated_at: string;
  merge_commit_sha?: string | null;
}): PullRequestInfo {
  return {
    number: data.number,
    title: data.title ?? '',
    body: data.body ?? '',
    state: data.state === 'closed' ? 'closed' : 'open',
    merged: Boolean(data.merged),
    headRef: data.head.ref,
    headSha: data.head.sha,
    baseRef: data.base.ref,
    updatedAt: data.updated_at,
    mergeCommitSha: data.merge_commit_sha ?? undefined,
  };
}

function toCommentInfo(data: {
  id: number;
  body?: string | null;
  created_at: string;
  user?: { login: string } | null;
}): CommentInfo {
  return {
    id: data.id,
    author: data.user?.login ?? 'unknown',
    body: data.body ?? '',
    createdAt: data.created_at,
  };
}

export function createRepoClient(
  env: Env,
  deps?: { minter?: TokenMinter; fetch?: typeof fetch },
): RepoClient {
  const owner = env.githubRepoOwner;
  const repo = env.githubRepoName;
  const repoSlug = `${owner}/${repo}`;
  const minter = deps?.minter ?? createTokenMinter(env);
  // Retries are disabled: this client throws promptly and lets the caller
  // (the worker, the lock) decide whether and when to try again. Automatic
  // retry-with-backoff would also make a transient-failure test slow.
  const octokit = new Octokit({ request: { fetch: deps?.fetch ?? fetch }, retry: { enabled: false } });

  /** Fetched fresh per call: `TokenMinter` caches internally, this never does. */
  async function authHeaders(): Promise<{ authorization: string }> {
    const token = await minter.getToken();
    return { authorization: `token ${token}` };
  }

  async function readFile(path: string, ref?: string): Promise<string | null> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref, headers });
      if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') {
        throw new Error(`path is not a file: ${path}`);
      }
      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw describeError(`read file ${path}`, repoSlug, error);
    }
  }

  async function getDefaultBranch(): Promise<string> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.repos.get({ owner, repo, headers });
      return data.default_branch;
    } catch (error) {
      throw describeError('get default branch', repoSlug, error);
    }
  }

  async function createRef(ref: string, sha: string): Promise<void> {
    try {
      const headers = await authHeaders();
      await octokit.rest.git.createRef({ owner, repo, ref, sha, headers });
    } catch (error) {
      if (isRefAlreadyExists(error)) throw new RefAlreadyExistsError(ref);
      throw describeError(`create ref ${ref}`, repoSlug, error);
    }
  }

  async function deleteRef(ref: string): Promise<void> {
    try {
      const headers = await authHeaders();
      await octokit.rest.git.deleteRef({ owner, repo, ref: stripRefsPrefix(ref), headers });
    } catch (error) {
      // Release must be idempotent: a ref already gone is not a failure.
      if (isNotFound(error)) return;
      throw describeError(`delete ref ${ref}`, repoSlug, error);
    }
  }

  async function getRef(ref: string): Promise<RefInfo | null> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.git.getRef({ owner, repo, ref: stripRefsPrefix(ref), headers });
      const sha = data.object.sha;
      const commit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: sha, headers });
      return { ref: data.ref, sha, committedAt: commit.data.committer.date };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw describeError(`get ref ${ref}`, repoSlug, error);
    }
  }

  async function createLockCommit(message: string, parentSha: string): Promise<string> {
    try {
      const headers = await authHeaders();
      const parent = await octokit.rest.git.getCommit({ owner, repo, commit_sha: parentSha, headers });
      const created = await octokit.rest.git.createCommit({
        owner,
        repo,
        message,
        tree: parent.data.tree.sha,
        parents: [parentSha],
        headers,
      });
      return created.data.sha;
    } catch (error) {
      throw describeError(`create anchor commit on ${parentSha}`, repoSlug, error);
    }
  }

  async function createPullRequest(input: {
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<PullRequestInfo> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.pulls.create({ owner, repo, ...input, headers });
      return toPullRequestInfo(data);
    } catch (error) {
      throw describeError(`create pull request from ${input.head}`, repoSlug, error);
    }
  }

  async function getPullRequest(number: number): Promise<PullRequestInfo | null> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: number, headers });
      return toPullRequestInfo(data);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw describeError(`get pull request #${number}`, repoSlug, error);
    }
  }

  async function listPullRequests(): Promise<PullRequestInfo[]> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.pulls.list({ owner, repo, state: 'all', per_page: 100, headers });
      return data.map(toPullRequestInfo);
    } catch (error) {
      throw describeError('list pull requests', repoSlug, error);
    }
  }

  async function updatePullRequest(
    number: number,
    input: { title?: string; body?: string; state?: 'open' | 'closed' },
  ): Promise<PullRequestInfo> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.pulls.update({ owner, repo, pull_number: number, ...input, headers });
      return toPullRequestInfo(data);
    } catch (error) {
      throw describeError(`update pull request #${number}`, repoSlug, error);
    }
  }

  async function listComments(number: number): Promise<CommentInfo[]> {
    try {
      const headers = await authHeaders();
      // Ascending by creation time is the API default: creation order, as required.
      const { data } = await octokit.rest.issues.listComments({ owner, repo, issue_number: number, headers });
      return data.map(toCommentInfo);
    } catch (error) {
      throw describeError(`list comments on #${number}`, repoSlug, error);
    }
  }

  async function createComment(number: number, body: string): Promise<CommentInfo> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body, headers });
      return toCommentInfo(data);
    } catch (error) {
      throw describeError(`create comment on #${number}`, repoSlug, error);
    }
  }

  async function updateComment(commentId: number, body: string): Promise<CommentInfo> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body, headers });
      return toCommentInfo(data);
    } catch (error) {
      throw describeError(`update comment ${commentId}`, repoSlug, error);
    }
  }

  async function mergePullRequest(number: number): Promise<{ sha: string }> {
    try {
      const headers = await authHeaders();
      const { data } = await octokit.rest.pulls.merge({ owner, repo, pull_number: number, headers });
      return { sha: data.sha };
    } catch (error) {
      throw describeError(`merge pull request #${number}`, repoSlug, error);
    }
  }

  /**
   * Reverts a merge commit by giving the branch a new commit whose tree is
   * the merge's first parent's tree (the tree the branch had immediately
   * before the merge) — the same construction `git revert -m 1` performs.
   *
   * This is exact when `branch`'s tip is still that merge commit. If other
   * commits have landed on `branch` since, this recreates the pre-merge tree
   * wholesale rather than three-way-merging the inverse patch onto the new
   * tip, which can discard unrelated later changes. A fully general revert
   * needs a real merge algorithm over a working tree (git itself), which the
   * Git Data API does not provide. Acceptable at this project's scale
   * (FR-029, R5) and called out here rather than silently assumed correct.
   */
  async function revertCommit(sha: string, branch: string): Promise<{ sha: string }> {
    const refPath = `heads/${branch}`;
    try {
      const headers = await authHeaders();
      const merge = await octokit.rest.git.getCommit({ owner, repo, commit_sha: sha, headers });
      const mainlineParentSha = merge.data.parents[0]?.sha;
      if (!mainlineParentSha) {
        throw new Error(`commit ${sha} has no parent; it is not a merge commit`);
      }
      const mainlineParent = await octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: mainlineParentSha,
        headers,
      });
      const currentTip = await octokit.rest.git.getRef({ owner, repo, ref: refPath, headers });
      const created = await octokit.rest.git.createCommit({
        owner,
        repo,
        message: `Revert changes introduced by ${sha}`,
        tree: mainlineParent.data.tree.sha,
        parents: [currentTip.data.object.sha],
        headers,
      });
      await octokit.rest.git.updateRef({ owner, repo, ref: refPath, sha: created.data.sha, headers });
      return { sha: created.data.sha };
    } catch (error) {
      throw describeError(`revert commit ${sha} on ${branch}`, repoSlug, error);
    }
  }

  /**
   * A credential, not a document. Callers must not log or persist the
   * returned value; it exists to be handed to a local `git push` and nothing
   * else. It never reaches the agent container (FR-015).
   */
  async function authenticatedRemoteUrl(): Promise<string> {
    const token = await minter.getToken();
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
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
  };
}

import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { CheckRepoActions, simpleGit, type SimpleGit } from 'simple-git';
import type { Mirror, WorkingTree } from './types';

/**
 * R8: the bare mirror is a cache, never a source of truth. Every function
 * here is written so that losing the directory costs time, not correctness.
 */

export interface CreateMirrorOptions {
  /** Authenticated; a credential. Called fresh so a rotated token is picked up. */
  remoteUrl: () => Promise<string>;
  cacheDir: string;
  workRoot: string;
}

/**
 * Strips the credential-bearing remote URL out of an error message before it
 * can reach a log line or a client-facing error. We rebuild a plain Error
 * rather than preserve the original's type or stack — losing that fidelity
 * is the acceptable cost of never letting the token escape this module.
 */
function sanitizeError(err: unknown, secret: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(message.split(secret).join('<redacted-remote-url>'));
}

async function isValidBareRepo(cacheDir: string): Promise<boolean> {
  try {
    return await simpleGit(cacheDir).checkIsRepo(CheckRepoActions.BARE);
  } catch {
    // Missing directory, or anything else that stops git from even answering
    // the question, counts as "not a mirror we can trust" — never a throw.
    return false;
  }
}

async function rebuildMirror(cacheDir: string, url: string): Promise<void> {
  try {
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(path.dirname(cacheDir), { recursive: true });
    await simpleGit().mirror(url, cacheDir);
  } catch (err) {
    throw sanitizeError(err, url);
  }
}

async function fetchMirror(cacheDir: string, url: string): Promise<void> {
  const git = simpleGit(cacheDir);
  try {
    // Set fresh each sync in case the caller's token was rotated since the
    // mirror was last touched — the stored remote URL is not trusted either.
    await git.remote(['set-url', 'origin', url]);
    await git.fetch(['origin', '--prune']);
  } catch (err) {
    throw sanitizeError(err, url);
  }
}

async function refExists(git: SimpleGit, ref: string): Promise<boolean> {
  // Not `show-ref --verify --quiet`: simple-git's error detection treats a
  // non-zero exit with empty stderr as success, so a "not found" quiet
  // failure never reaches a catch block. `for-each-ref` never errors either
  // way — a missing ref is just an empty match — so existence is read from
  // its output instead of from whether the call rejected.
  const matches = await git.raw(['for-each-ref', ref]);
  return matches.trim().length > 0;
}

/**
 * Points the fresh clone at `branch`, creating it from `baseBranch` when the
 * mirror does not yet have it, and returns the commit the tree started from.
 */
async function resolveBranch(
  tree: SimpleGit,
  branch: string,
  baseBranch: string,
): Promise<string> {
  const current = (await tree.revparse(['--abbrev-ref', 'HEAD'])).trim();
  if (current !== branch) {
    if (await refExists(tree, `refs/remotes/origin/${branch}`)) {
      await tree.checkout(['-b', branch, `origin/${branch}`]);
    } else if (current === baseBranch) {
      await tree.checkoutLocalBranch(branch);
    } else if (await refExists(tree, `refs/remotes/origin/${baseBranch}`)) {
      await tree.checkout(['-b', branch, `origin/${baseBranch}`]);
    } else {
      throw new Error(`base branch "${baseBranch}" was not found in the mirror`);
    }
  }
  return (await tree.revparse(['HEAD'])).trim();
}

/**
 * Clones the local mirror into a fresh working directory. The source is
 * always the on-disk cache, never the authenticated remote, so the resulting
 * tree's git config never sees the credential in the first place.
 */
async function createWorkingTree(
  cacheDir: string,
  workRoot: string,
  branch: string,
  baseBranch: string,
): Promise<WorkingTree> {
  await mkdir(workRoot, { recursive: true });
  const dir = path.join(workRoot, randomUUID());
  await simpleGit().clone(cacheDir, dir);
  const tree = simpleGit(dir);
  const baseSha = await resolveBranch(tree, branch, baseBranch);
  // R2 / FR-015: no remote at all, so pushing from inside the tree is
  // impossible rather than merely forbidden.
  await tree.removeRemote('origin');
  return {
    dir,
    branch,
    baseSha,
    dispose: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function createMirror(options: CreateMirrorOptions): Mirror {
  return {
    async sync() {
      const url = await options.remoteUrl();
      if (!(await isValidBareRepo(options.cacheDir))) {
        await rebuildMirror(options.cacheDir, url);
        return;
      }
      try {
        await fetchMirror(options.cacheDir, url);
      } catch {
        // The sanity check above passed but the fetch still failed. That can
        // mean deeper corruption (a scrambled object store) or a genuine
        // remote/auth problem. Rebuilding is cheap (R8), so we always try it;
        // a real remote problem will fail again here and surface honestly.
        await rebuildMirror(options.cacheDir, url);
      }
    },

    checkout(branch: string, baseBranch: string) {
      return createWorkingTree(options.cacheDir, options.workRoot, branch, baseBranch);
    },
  };
}

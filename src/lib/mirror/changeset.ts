import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import type { ChangedFile, ChangeKind } from '@/types';
import type { ChangeSet, DeriveChangeSet, WorkingTree } from './types';

/**
 * The container never runs git (contracts/repo-files.md), so everything it
 * touches shows up as an unstaged change against HEAD: a brand new path is
 * untracked, an edited path is a worktree modification, a removed path is a
 * worktree deletion. Nothing here is ever staged, so `index` is always the
 * blank column and only `working_dir` distinguishes the three.
 */
function classifyStatus(status: StatusResult): Array<{ path: string; kind: ChangeKind }> {
  const classified: Array<{ path: string; kind: ChangeKind }> = [];
  for (const file of status.files) {
    if (file.index === '?' && file.working_dir === '?') {
      classified.push({ path: file.path, kind: 'added' });
    } else if (file.index === ' ' && file.working_dir === 'D') {
      classified.push({ path: file.path, kind: 'deleted' });
    } else if (file.index === ' ' && file.working_dir === 'M') {
      classified.push({ path: file.path, kind: 'modified' });
    }
    // Any other combination would mean something was staged already, which
    // cannot happen before the host's own commit step runs.
  }
  return classified;
}

/**
 * A binary diff has no line count — `git diff --numstat` reports "-" for one
 * and there is no sensible way to count "lines" in raw bytes. Rather than
 * crash or silently report zero (which would let a large binary swap slip
 * under the policy's line budget for free), it is charged this fixed,
 * deliberately approximate cost.
 */
const BINARY_DIFF_LINES_COST = 20;

/** git's own binary sniff: a NUL byte anywhere in the first 8000 bytes. */
const BINARY_SNIFF_BYTES = 8000;

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  const endsWithNewline = content.endsWith('\n') ? 1 : 0;
  return content.split('\n').length - endsWithNewline;
}

/** An untracked file's diffLines is its own line count — it is all new. */
async function diffLinesForAdded(treeDir: string, filePath: string): Promise<number> {
  const buffer = await readFile(path.join(treeDir, filePath));
  return looksBinary(buffer) ? BINARY_DIFF_LINES_COST : countLines(buffer.toString('utf8'));
}

/** A deletion's diffLines is the line count of the content being removed. */
async function diffLinesForDeleted(git: SimpleGit, filePath: string): Promise<number> {
  const buffer = await git.showBuffer(`HEAD:${filePath}`);
  return looksBinary(buffer) ? BINARY_DIFF_LINES_COST : countLines(buffer.toString('utf8'));
}

/** A tracked edit's diffLines is added plus removed lines against HEAD. */
async function diffLinesForModified(git: SimpleGit, filePath: string): Promise<number> {
  const numstat = (await git.diff(['--numstat', '--', filePath])).trim();
  const [added, removed] = numstat.split('\t');
  if (added === '-' || removed === '-') {
    return BINARY_DIFF_LINES_COST;
  }
  return Number(added ?? 0) + Number(removed ?? 0);
}

/**
 * Text a browser could render is read once more for the gate's content rule:
 * an addition is all new text, an edit contributes only the lines `git diff`
 * marks as added. Binary content and deletions add nothing. Capped, because
 * the gate reads it with regular expressions and a pathological file should
 * cost bounded time.
 */
const MAX_ADDED_TEXT_CHARS = 400_000;

async function addedTextFor(
  tree: WorkingTree,
  git: SimpleGit,
  file: { path: string; kind: ChangeKind },
): Promise<string | undefined> {
  if (file.kind === 'deleted') return undefined;
  if (file.kind === 'added') {
    const buffer = await readFile(path.join(tree.dir, file.path));
    return looksBinary(buffer) ? undefined : buffer.toString('utf8').slice(0, MAX_ADDED_TEXT_CHARS);
  }
  const diff = await git.diff(['-U0', '--no-color', '--', file.path]);
  if (/^Binary files/m.test(diff)) return undefined;
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n')
    .slice(0, MAX_ADDED_TEXT_CHARS);
}

/** Whether the path is a symbolic link in the tree. A deletion has nothing to inspect. */
async function isSymlink(
  tree: WorkingTree,
  file: { path: string; kind: ChangeKind },
): Promise<boolean> {
  if (file.kind === 'deleted') return false;
  const stats = await lstat(path.join(tree.dir, file.path));
  return stats.isSymbolicLink();
}

async function diffLinesFor(
  tree: WorkingTree,
  git: SimpleGit,
  file: { path: string; kind: ChangeKind },
): Promise<number> {
  switch (file.kind) {
    case 'added':
      return diffLinesForAdded(tree.dir, file.path);
    case 'deleted':
      return diffLinesForDeleted(git, file.path);
    case 'modified':
      return diffLinesForModified(git, file.path);
  }
}

/**
 * Derives the change set from a working tree's status. Untracked additions
 * and deletions count exactly as much as tracked modifications — an agent
 * that creates or removes a file has changed the site just as much as one
 * that edits an existing line (contracts/repo-files.md).
 */
export const deriveChangeSet: DeriveChangeSet = async (tree: WorkingTree): Promise<ChangeSet> => {
  const git = simpleGit(tree.dir);
  const status = await git.status(['--untracked-files=all']);
  const classified = classifyStatus(status);

  const files: ChangedFile[] = [];
  for (const { path: filePath, kind } of classified) {
    const file = { path: filePath, kind };
    const symlink = await isSymlink(tree, file);
    // A link's target is not this change's content; the gate refuses the link
    // itself, so there is nothing to read through it.
    const diffLines = symlink ? 1 : await diffLinesFor(tree, git, file);
    const addedText = symlink ? undefined : await addedTextFor(tree, git, file);
    files.push({
      path: filePath,
      kind,
      diffLines,
      ...(symlink ? { symlink } : {}),
      ...(addedText !== undefined ? { addedText } : {}),
    });
  }

  const totalDiffLines = files.reduce((sum, file) => sum + file.diffLines, 0);
  return { files, totalDiffLines };
};

/**
 * Stages exactly the given paths — never `git add -A` or `git add .` — and
 * commits with an author and message the host supplies. The container never
 * commits (constitution III): this function only ever runs after the gate
 * has passed, over the exact file list the gate approved. Because staging is
 * explicit, any control file or agent scratch file left in the tree, present
 * but absent from `files`, is structurally never part of the commit.
 */
export async function commitPermittedPaths(
  tree: WorkingTree,
  files: ChangedFile[],
  message: string,
  author: { name: string; email: string },
): Promise<{ sha: string }> {
  if (files.length === 0) {
    throw new Error('commitPermittedPaths called with no permitted files to commit');
  }

  const git = simpleGit(tree.dir);
  // Local to this throwaway working tree only — the host's commit identity
  // must not depend on whatever git happens to be configured on the host.
  await git.addConfig('user.name', author.name);
  await git.addConfig('user.email', author.email);
  await git.addConfig('commit.gpgsign', 'false');

  await git.add(files.map((file) => file.path));
  // `--no-verify` because hooks are not this product's contract, and because
  // they are a way into the host: a hook the host already has — a pre-commit
  // from a global init template, say — reads its configuration from the
  // repository being committed, which would turn a file in the client's site
  // repository into commands running outside the container everything else
  // here goes to such lengths to contain.
  const summary = await git.commit(message, undefined, {
    '--author': `${author.name} <${author.email}>`,
    '--no-verify': null,
  });
  return { sha: summary.commit };
}

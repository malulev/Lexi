// The container never runs git (contracts/repo-files.md): everything it does
// to `/work` — creating, editing, or removing a file — lands as an unstaged
// change in a real repository. These tests build one and edit it with plain
// filesystem calls, exactly as the agent does, so a mock's assumptions about
// what `git status` reports can't paper over the real behaviour.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { commitPermittedPaths, deriveChangeSet } from '@/lib/mirror/changeset';
import type { WorkingTree } from '@/lib/mirror/types';
import type { ChangedFile } from '@/types';

const AUTHOR = { name: 'Web Agent', email: 'agent@example.com' };

interface Fixture {
  dir: string;
  git: SimpleGit;
  tree: WorkingTree;
}

let dirsToClean: string[] = [];

async function makeFixture(): Promise<Fixture> {
  const dir = await mkdtemp(path.join(tmpdir(), 'webagent-changeset-'));
  dirsToClean.push(dir);
  const git = simpleGit(dir);
  await git.raw(['-c', 'init.defaultBranch=main', 'init']);
  await git.addConfig('user.name', 'Site Owner');
  await git.addConfig('user.email', 'owner@example.com');
  await git.addConfig('commit.gpgsign', 'false');

  await writeFile(path.join(dir, 'existing.txt'), 'a\nb\n');
  await writeFile(path.join(dir, 'to-delete.txt'), 'one\ntwo\nthree\nfour\n');
  await git.add(['existing.txt', 'to-delete.txt']);
  await git.commit('initial commit');
  const baseSha = (await git.revparse(['HEAD'])).trim();

  const tree: WorkingTree = {
    dir,
    branch: 'main',
    baseSha,
    dispose: async () => rm(dir, { recursive: true, force: true }),
  };
  return { dir, git, tree };
}

function findFile(files: ChangedFile[], filePath: string): ChangedFile {
  const found = files.find((f) => f.path === filePath);
  if (!found) {
    throw new Error(`expected ${filePath} in change set, got: ${JSON.stringify(files)}`);
  }
  return found;
}

beforeEach(() => {
  dirsToClean = [];
});

afterEach(async () => {
  await Promise.all(dirsToClean.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('deriveChangeSet', () => {
  it('includes an untracked new file as an addition sized by its own line count', async () => {
    const { dir, tree } = await makeFixture();
    await writeFile(path.join(dir, 'new.txt'), 'line1\nline2\nline3\n');

    const changeSet = await deriveChangeSet(tree);

    const added = findFile(changeSet.files, 'new.txt');
    expect(added.kind).toBe('added');
    expect(added.diffLines).toBe(3);
  });

  it('includes a removed tracked file as a deletion sized by the lines it removed', async () => {
    const { dir, tree } = await makeFixture();
    await rm(path.join(dir, 'to-delete.txt'));

    const changeSet = await deriveChangeSet(tree);

    const deleted = findFile(changeSet.files, 'to-delete.txt');
    expect(deleted.kind).toBe('deleted');
    expect(deleted.diffLines).toBe(4);
  });

  it('includes an edited tracked file as a modification sized by added plus removed lines', async () => {
    const { dir, tree } = await makeFixture();
    await writeFile(path.join(dir, 'existing.txt'), 'a\nc\n');

    const changeSet = await deriveChangeSet(tree);

    const modified = findFile(changeSet.files, 'existing.txt');
    expect(modified.kind).toBe('modified');
    expect(modified.diffLines).toBe(2); // one line removed, one added
  });

  it('reports untracked files inside a brand new directory individually, not as one directory entry', async () => {
    const { dir, tree } = await makeFixture();
    await mkdir(path.join(dir, 'assets'));
    await writeFile(path.join(dir, 'assets', 'a.txt'), 'x\n');
    await writeFile(path.join(dir, 'assets', 'b.txt'), 'y\n');

    const changeSet = await deriveChangeSet(tree);

    expect(findFile(changeSet.files, 'assets/a.txt').kind).toBe('added');
    expect(findFile(changeSet.files, 'assets/b.txt').kind).toBe('added');
  });

  it('sums every file into totalDiffLines', async () => {
    const { dir, tree } = await makeFixture();
    await writeFile(path.join(dir, 'new.txt'), 'line1\nline2\nline3\n'); // 3
    await rm(path.join(dir, 'to-delete.txt')); // 4
    await writeFile(path.join(dir, 'existing.txt'), 'a\nc\n'); // 2

    const changeSet = await deriveChangeSet(tree);

    expect(changeSet.totalDiffLines).toBe(9);
  });

  it('combines several changes of every kind in one pass', async () => {
    const { dir, tree } = await makeFixture();
    await writeFile(path.join(dir, 'new.txt'), 'x\ny\n');
    await rm(path.join(dir, 'to-delete.txt'));
    await writeFile(path.join(dir, 'existing.txt'), 'a\nb\nc\n');

    const changeSet = await deriveChangeSet(tree);

    expect(changeSet.files).toHaveLength(3);
    expect(findFile(changeSet.files, 'new.txt').kind).toBe('added');
    expect(findFile(changeSet.files, 'to-delete.txt').kind).toBe('deleted');
    expect(findFile(changeSet.files, 'existing.txt').kind).toBe('modified');
  });

  it('charges a binary addition a fixed nominal cost instead of crashing or reporting zero', async () => {
    const { dir, tree } = await makeFixture();
    await writeFile(path.join(dir, 'small.bin'), Buffer.from([0x00, 0x01, 0x02]));
    await writeFile(
      path.join(dir, 'large.bin'),
      Buffer.concat([Buffer.from([0x00]), Buffer.alloc(5000, 0x41)]),
    );

    const changeSet = await deriveChangeSet(tree);

    const small = findFile(changeSet.files, 'small.bin');
    const large = findFile(changeSet.files, 'large.bin');
    expect(small.diffLines).toBeGreaterThan(0);
    // A fixed nominal cost, not a byte count — two very differently sized
    // binaries must be charged identically.
    expect(small.diffLines).toBe(large.diffLines);
  });

  it('charges a binary modification a fixed nominal cost, via git\'s own binary detection', async () => {
    const { dir, git, tree } = await makeFixture();
    await writeFile(path.join(dir, 'logo.bin'), Buffer.from([0x00, 0x10, 0x20]));
    await git.add(['logo.bin']);
    await git.commit('add binary logo');
    await writeFile(path.join(dir, 'logo.bin'), Buffer.from([0x00, 0xff, 0x99, 0x88]));

    const changeSet = await deriveChangeSet(tree);

    const modified = findFile(changeSet.files, 'logo.bin');
    expect(modified.kind).toBe('modified');
    expect(modified.diffLines).toBeGreaterThan(0);
  });

  it('charges a binary deletion a fixed nominal cost', async () => {
    const { dir, git, tree } = await makeFixture();
    await writeFile(path.join(dir, 'logo.bin'), Buffer.from([0x00, 0x10, 0x20]));
    await git.add(['logo.bin']);
    await git.commit('add binary logo');
    await rm(path.join(dir, 'logo.bin'));

    const changeSet = await deriveChangeSet(tree);

    const deleted = findFile(changeSet.files, 'logo.bin');
    expect(deleted.kind).toBe('deleted');
    expect(deleted.diffLines).toBeGreaterThan(0);
  });
});

describe('commitPermittedPaths', () => {
  it('stages and commits exactly the given paths with the supplied author and message', async () => {
    const { dir, git, tree } = await makeFixture();
    await writeFile(path.join(dir, 'new.txt'), 'hello\n');
    const files: ChangedFile[] = [{ path: 'new.txt', kind: 'added', diffLines: 1 }];

    const { sha } = await commitPermittedPaths(tree, files, 'client: add new page', AUTHOR);

    const log = await git.show(['--no-patch', '--format=%an <%ae>%n%s', sha]);
    expect(log).toContain('Web Agent <agent@example.com>');
    expect(log).toContain('client: add new page');
  });

  it('never commits a stray file that is present in the tree but absent from the permitted list', async () => {
    const { dir, git, tree } = await makeFixture();
    await writeFile(path.join(dir, 'new.txt'), 'hello\n');
    await mkdir(path.join(dir, 'control'));
    await writeFile(path.join(dir, 'control', 'scratch.json'), '{"leftover":true}');
    const files: ChangedFile[] = [{ path: 'new.txt', kind: 'added', diffLines: 1 }];

    const { sha } = await commitPermittedPaths(tree, files, 'client: add new page', AUTHOR);

    const committedPaths = (await git.show(['--name-only', `--format=`, sha]))
      .split('\n')
      .filter(Boolean);
    expect(committedPaths).toEqual(['new.txt']);

    const status = await git.status(['--untracked-files=all']);
    expect(status.not_added).toContain('control/scratch.json');
  });

  it('stages a deletion for a path the agent removed from disk', async () => {
    const { dir, git, tree } = await makeFixture();
    await rm(path.join(dir, 'to-delete.txt'));
    const files: ChangedFile[] = [{ path: 'to-delete.txt', kind: 'deleted', diffLines: 4 }];

    const { sha } = await commitPermittedPaths(tree, files, 'client: remove page', AUTHOR);

    const committedPaths = (await git.show(['--name-only', `--format=`, sha]))
      .split('\n')
      .filter(Boolean);
    expect(committedPaths).toEqual(['to-delete.txt']);
  });

  it('rejects committing an empty permitted file list', async () => {
    const { tree } = await makeFixture();

    await expect(commitPermittedPaths(tree, [], 'client: no-op', AUTHOR)).rejects.toThrow();
  });

  /**
   * Git hooks are not this product's contract, and the working tree they would
   * run in is a throwaway.
   *
   * They are also a way into the host. Hooks are never cloned, but a hook the
   * host already has — a `pre-commit` from a global init template, say — reads
   * its configuration from the repository being committed. That turns a file in
   * the client's site repository into commands running on the host, outside the
   * container everything else about this design goes to such lengths to
   * contain. Committing must not consult them.
   */
  it('commits even where the host has installed a hook that refuses', async () => {
    const { tree } = await makeFixture();
    const hook = path.join(tree.dir, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "refused by a hook the site repository configured" >&2\nexit 1\n');
    await chmod(hook, 0o755);

    await writeFile(path.join(tree.dir, 'existing.txt'), 'a\nb\nc\n');
    const files: ChangedFile[] = [
      { path: 'existing.txt', kind: 'modified', diffLines: 1 },
    ];

    const { sha } = await commitPermittedPaths(tree, files, 'client: extend the page', AUTHOR);

    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
  });
});

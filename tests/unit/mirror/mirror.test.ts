// These tests build real local git repositories under the OS temp directory
// and drive `createMirror` against them. R8 treats the bare mirror as a
// cache, never a source of truth, so the behaviours worth pinning down are
// exactly the ones a mock of git would get wrong: a mirror that heals itself
// when missing or corrupt, and a working tree that genuinely has no remote
// (R2) rather than merely one nobody intends to use.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CheckRepoActions, simpleGit, type SimpleGit } from 'simple-git';
import { createMirror } from '@/lib/mirror/mirror';

async function makeTmpDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/**
 * A from-scratch local repository standing in for the site's GitHub remote.
 * `parentDir` must already exist; `git init <dir>` creates the leaf itself.
 */
async function initRepo(parentDir: string, name: string): Promise<{ dir: string; git: SimpleGit }> {
  const dir = path.join(parentDir, name);
  // Explicit config so these tests do not depend on the host's git setup.
  await simpleGit(parentDir).raw(['-c', 'init.defaultBranch=main', 'init', dir]);
  const git = simpleGit(dir);
  await git.addConfig('user.name', 'Web Agent Test');
  await git.addConfig('user.email', 'agent@example.com');
  await git.addConfig('commit.gpgsign', 'false');
  return { dir, git };
}

async function commitFile(
  git: SimpleGit,
  dir: string,
  filename: string,
  content: string,
  message: string,
): Promise<string> {
  await writeFile(path.join(dir, filename), content);
  await git.add([filename]);
  await git.commit(message);
  return (await git.revparse(['HEAD'])).trim();
}

interface Harness {
  remoteDir: string;
  remoteGit: SimpleGit;
  cacheDir: string;
  workRoot: string;
  mirror: ReturnType<typeof createMirror>;
}

async function makeHarness(base: string): Promise<Harness> {
  const { dir: remoteDir, git: remoteGit } = await initRepo(base, 'remote');
  await commitFile(remoteGit, remoteDir, 'index.html', '<h1>hello</h1>\n', 'initial commit');

  const cacheDir = path.join(base, 'cache', 'mirror.git');
  const workRoot = path.join(base, 'work');
  const mirror = createMirror({ remoteUrl: async () => remoteDir, cacheDir, workRoot });
  return { remoteDir, remoteGit, cacheDir, workRoot, mirror };
}

let tmpRoots: string[] = [];

beforeEach(() => {
  tmpRoots = [];
});

afterEach(async () => {
  await Promise.all(tmpRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function harness(): Promise<Harness> {
  const base = await makeTmpDir('webagent-mirror-test-');
  tmpRoots.push(base);
  return makeHarness(base);
}

describe('createMirror().sync', () => {
  it('creates the bare mirror when none exists', async () => {
    const h = await harness();

    expect(existsSync(h.cacheDir)).toBe(false);
    await h.mirror.sync();

    expect(existsSync(h.cacheDir)).toBe(true);
    expect(await simpleGit(h.cacheDir).checkIsRepo(CheckRepoActions.BARE)).toBe(true);
  });

  it('fetches new commits into an existing mirror', async () => {
    const h = await harness();
    await h.mirror.sync();

    const newSha = await commitFile(
      h.remoteGit,
      h.remoteDir,
      'about.html',
      '<h1>about</h1>\n',
      'add about page',
    );
    await h.mirror.sync();

    const mirrorMainSha = (await simpleGit(h.cacheDir).revparse(['refs/heads/main'])).trim();
    expect(mirrorMainSha).toBe(newSha);
  });

  it('rebuilds from scratch when the mirror directory is missing', async () => {
    const h = await harness();
    await h.mirror.sync();
    await rm(h.cacheDir, { recursive: true, force: true });

    await expect(h.mirror.sync()).resolves.not.toThrow();

    const tree = await h.mirror.checkout('main', 'main');
    expect(tree.baseSha).toBe((await h.remoteGit.revparse(['HEAD'])).trim());
    await tree.dispose();
  });

  it('rebuilds from scratch when the mirror is corrupt, without surfacing a failure', async () => {
    const h = await harness();
    await h.mirror.sync();
    // Destroy the object database while leaving the directory itself in
    // place — a corruption that a mere "does the directory exist" check
    // would miss, but that breaks every real git operation against it.
    await rm(path.join(h.cacheDir, 'objects'), { recursive: true, force: true });

    await expect(h.mirror.sync()).resolves.not.toThrow();

    const tree = await h.mirror.checkout('main', 'main');
    expect(tree.baseSha).toBe((await h.remoteGit.revparse(['HEAD'])).trim());
    await tree.dispose();
  });

  it('never leaks the remote credential in a failure it cannot recover from', async () => {
    const base = await makeTmpDir('webagent-mirror-secret-');
    tmpRoots.push(base);
    const secretUrl = path.join(base, 'does-not-exist-SECRET-TOKEN-abc123');
    const mirror = createMirror({
      remoteUrl: async () => secretUrl,
      cacheDir: path.join(base, 'cache', 'mirror.git'),
      workRoot: path.join(base, 'work'),
    });

    let caught: unknown;
    try {
      await mirror.sync();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain('SECRET-TOKEN');
  });
});

describe('createMirror().checkout', () => {
  it('creates a working tree at a branch that already exists on the mirror', async () => {
    const h = await harness();
    await h.remoteGit.checkoutLocalBranch('feature');
    const featureSha = await commitFile(
      h.remoteGit,
      h.remoteDir,
      'feature.txt',
      'feature content\n',
      'add feature file',
    );
    await h.remoteGit.checkout('main');
    await h.mirror.sync();

    const tree = await h.mirror.checkout('feature', 'main');

    expect(tree.branch).toBe('feature');
    expect(tree.baseSha).toBe(featureSha);
    expect(existsSync(path.join(tree.dir, 'feature.txt'))).toBe(true);
    await tree.dispose();
  });

  it('branches a new working tree from baseBranch when the target branch does not exist yet', async () => {
    const h = await harness();
    await h.mirror.sync();
    const mainSha = (await h.remoteGit.revparse(['HEAD'])).trim();

    const tree = await h.mirror.checkout('conversation-42', 'main');

    expect(tree.branch).toBe('conversation-42');
    expect(tree.baseSha).toBe(mainSha);
    const currentBranch = await simpleGit(tree.dir).revparse(['--abbrev-ref', 'HEAD']);
    expect(currentBranch.trim()).toBe('conversation-42');
    await tree.dispose();
  });

  it('produces a working tree with no configured git remote (R2, FR-015)', async () => {
    const h = await harness();
    await h.mirror.sync();

    const tree = await h.mirror.checkout('main', 'main');

    const remotes = await simpleGit(tree.dir).raw(['remote', '-v']);
    expect(remotes.trim()).toBe('');
    await tree.dispose();
  });

  it('dispose removes the working tree', async () => {
    const h = await harness();
    await h.mirror.sync();
    const tree = await h.mirror.checkout('main', 'main');

    await tree.dispose();

    expect(existsSync(tree.dir)).toBe(false);
  });

  it('dispose does not throw when the working tree is already gone', async () => {
    const h = await harness();
    await h.mirror.sync();
    const tree = await h.mirror.checkout('main', 'main');
    await tree.dispose();

    await expect(tree.dispose()).resolves.not.toThrow();
  });
});

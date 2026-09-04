import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, describe, expect, it } from 'vitest';

import { deriveChangeSet } from '@/lib/mirror/changeset';
import type { WorkingTree } from '@/lib/mirror/types';

/**
 * What the change set now carries for the gate's newer rules: whether a path
 * is a link, and the text a change adds to a file a browser would render.
 */

const dirs: string[] = [];

async function fixture(): Promise<WorkingTree> {
  const dir = await mkdtemp(path.join(tmpdir(), 'webagent-changeset-hardening-'));
  dirs.push(dir);
  const git = simpleGit(dir);
  await git.raw(['-c', 'init.defaultBranch=main', 'init']);
  await git.addConfig('user.name', 'Site Owner');
  await git.addConfig('user.email', 'owner@example.com');
  await git.addConfig('commit.gpgsign', 'false');
  await writeFile(path.join(dir, 'index.html'), '<html>\n<body>\n<h1>Hi</h1>\n</body>\n</html>\n');
  await mkdir(path.join(dir, '.webagent'));
  await writeFile(path.join(dir, '.webagent/policy.yml'), 'allow: ["**"]\n');
  await git.add(['index.html', '.webagent/policy.yml']);
  await git.commit('initial');
  const baseSha = (await git.revparse(['HEAD'])).trim();
  return {
    dir,
    branch: 'main',
    baseSha,
    dispose: async () => rm(dir, { recursive: true, force: true }),
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('deriveChangeSet, for the gate’s content rules', () => {
  it('marks a symbolic link as one, without reading through it', async () => {
    const tree = await fixture();
    await symlink('.webagent/policy.yml', path.join(tree.dir, 'styles.css'));

    const { files } = await deriveChangeSet(tree);
    const link = files.find((file) => file.path === 'styles.css');
    expect(link).toMatchObject({ kind: 'added', symlink: true });
    expect(link?.addedText).toBeUndefined();
  });

  it('carries an addition’s whole text and only an edit’s added lines', async () => {
    const tree = await fixture();
    await writeFile(path.join(tree.dir, 'about.html'), '<p>New</p>\n');
    await writeFile(
      path.join(tree.dir, 'index.html'),
      '<html>\n<body>\n<h1>Hi</h1>\n<script src="https://cdn.evil.example/s.js"></script>\n</body>\n</html>\n',
    );

    const { files } = await deriveChangeSet(tree);
    expect(files.find((file) => file.path === 'about.html')?.addedText).toBe('<p>New</p>\n');
    const edited = files.find((file) => file.path === 'index.html');
    expect(edited?.addedText).toBe('<script src="https://cdn.evil.example/s.js"></script>');
    expect(edited?.symlink).toBeUndefined();
  });

  it('carries no text for a binary or a deletion', async () => {
    const tree = await fixture();
    await writeFile(
      path.join(tree.dir, 'logo.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
    );
    await rm(path.join(tree.dir, 'index.html'));

    const { files } = await deriveChangeSet(tree);
    expect(files.find((file) => file.path === 'logo.png')?.addedText).toBeUndefined();
    expect(files.find((file) => file.path === 'index.html')).toMatchObject({ kind: 'deleted' });
    expect(files.find((file) => file.path === 'index.html')?.addedText).toBeUndefined();
  });
});

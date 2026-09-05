import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeAgentWritable } from '@/lib/runner/permissions';

/**
 * The agent container runs as a fixed unprivileged UID (agent/Dockerfile) and
 * is handed a working tree the host process created as some other user. Two
 * different uids, no shared group, so nothing the host writes is writable by
 * the agent by default — the container starts, finds every file read-only,
 * and the request completes having changed nothing.
 *
 * These directories are throwaway, live inside a 0700 installation state
 * directory, and are destroyed after every run, which is what makes widening
 * their mode the right answer rather than a hole.
 */

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'webagent-perms-'));
  dirs.push(root);
  return root;
}

/** The permission bits, without the file-type bits `lstat` also reports. */
async function modeOf(path: string): Promise<number> {
  return (await lstat(path)).mode & 0o777;
}

describe('makeAgentWritable', () => {
  it('gives a directory the traversal and write bits a foreign uid needs', async () => {
    const root = await makeRoot();
    const nested = join(root, 'src', 'components');
    await mkdir(nested, { recursive: true });
    await chmod(nested, 0o700);

    await makeAgentWritable(root);

    expect(await modeOf(nested)).toBe(0o707);
  });

  it('makes a regular file writable without making it executable', async () => {
    const root = await makeRoot();
    const file = join(root, 'page.tsx');
    await writeFile(file, 'x');
    await chmod(file, 0o600);

    await makeAgentWritable(root);

    expect(await modeOf(file)).toBe(0o606);
  });

  it('keeps an executable file executable', async () => {
    const root = await makeRoot();
    const script = join(root, 'build.sh');
    await writeFile(script, '#!/bin/sh\n');
    await chmod(script, 0o700);

    await makeAgentWritable(root);

    expect(await modeOf(script)).toBe(0o707);
  });

  it('reaches every depth of the tree', async () => {
    const root = await makeRoot();
    const deep = join(root, 'a', 'b', 'c');
    await mkdir(deep, { recursive: true });
    const file = join(deep, 'leaf.txt');
    await writeFile(file, 'x');
    await chmod(file, 0o600);
    await chmod(deep, 0o700);

    await makeAgentWritable(root);

    expect(await modeOf(deep)).toBe(0o707);
    expect(await modeOf(file)).toBe(0o606);
  });

  it('never follows a symbolic link out of the tree', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const target = join(outside, 'secret');
    await writeFile(target, 'x');
    await chmod(target, 0o600);
    await symlink(target, join(root, 'link'));

    await makeAgentWritable(root);

    // The link's own mode is irrelevant and platform-defined; what matters is
    // that the file it points at was never touched. Following links here would
    // let a link the agent itself planted on a previous run widen anything the
    // host process can reach.
    expect(await modeOf(target)).toBe(0o600);
  });

  it('reports the path when there is nothing there to widen', async () => {
    const root = await makeRoot();

    await expect(makeAgentWritable(join(root, 'absent'))).rejects.toThrow(/absent/);
  });
});

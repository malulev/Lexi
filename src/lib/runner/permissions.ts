import { chmod, lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Hands a directory tree to a container that runs as a different user.
 *
 * The agent image runs as a fixed unprivileged UID (`agent/Dockerfile`), and
 * the host process that prepares the working tree and the control directory
 * runs as whoever started it — root under Compose, a developer's own account
 * under `npm run dev`, and neither of them is that UID. Nothing the host
 * writes is therefore writable by the agent, and the failure is quiet in the
 * worst way: the container starts, edits nothing because every file is
 * read-only, and the request completes reporting that the agent made no
 * change. Widening the mode is what makes the bind mounts usable at all.
 *
 * Why widening is safe here, stated plainly because it looks alarming:
 *   - both directories live inside `WEBAGENT_STATE_DIR`, which a multi-client
 *     host keeps at 0700 owned by that installation's own user (ops/), so
 *     "other" means the agent container and nothing else on the box;
 *   - both are per-request and destroyed in `discard()` when the run ends,
 *     successful or not;
 *   - the working tree carries no credential — no git remote, no token
 *     (contracts/repo-files.md) — so read access to it is read access to a
 *     copy of a repository the agent is about to be shown anyway.
 *
 * The alternative, running the container as the tree's owner, was rejected:
 * under Compose the host process is root, so it would make the agent root
 * inside its own container, trading a documented structural property for a
 * mode bit.
 */

/** Directories need `x` as well as `w`, or a foreign uid cannot even enter them. */
const DIRECTORY_BITS = 0o007;

/** Files get read and write. `x` is added back below only where it already was. */
const FILE_BITS = 0o006;

const OWNER_EXECUTE = 0o100;
const OTHER_EXECUTE = 0o001;

/**
 * Symbolic links are stepped over rather than followed. The agent may have
 * planted one on an earlier run — the policy gate refuses links in a change,
 * but the gate runs after the agent, not before this does — and following it
 * would let the link widen whatever the host process can reach outside the
 * tree. `lstat` reports the link itself; `chmod` on most platforms would
 * follow it, so the only safe move is not to call it.
 */
async function widen(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) return;

  const mode = stats.mode & 0o777;

  if (stats.isDirectory()) {
    await chmod(path, mode | DIRECTORY_BITS);
    const entries = await readdir(path);
    for (const entry of entries) {
      await widen(join(path, entry));
    }
    return;
  }

  // Anything that is not a directory is treated as a file: a socket or a
  // device node in a checked-out working tree is not something to widen, but
  // it is also not something git produces, and chmod on one is harmless.
  const executable = (mode & OWNER_EXECUTE) === OWNER_EXECUTE ? OTHER_EXECUTE : 0;
  await chmod(path, mode | FILE_BITS | executable);
}

/**
 * Throws if `root` does not exist, naming it. A missing working tree at this
 * point means the checkout silently produced nothing, and failing here says
 * so while the path is still in hand.
 */
export async function makeAgentWritable(root: string): Promise<void> {
  await widen(root);
}

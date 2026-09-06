import { simpleGit, type SimpleGit } from 'simple-git';

/**
 * A git client for a working tree the agent has touched.
 *
 * The agent edits files under a working tree the host later runs git against —
 * `git status` to derive the change set, `git commit` to stage the permitted
 * paths, `git push` to publish. Git reads hooks and a filesystem monitor from
 * inside the tree's own `.git` as it runs each of those, so anything planted
 * there executes on the HOST, outside the container, holding the host's
 * authority and the push credential. A `pre-push` hook fires on push; a
 * `core.fsmonitor` command fires on status; `--no-verify` stops neither
 * (it suppresses only `pre-commit` and `commit-msg`).
 *
 * `makeAgentWritable` (runner/permissions.ts) already refuses to widen `.git`,
 * so the agent's own uid cannot write there — but a working tree can also
 * arrive carrying hooks from the mirror it was cloned from, and defence in
 * depth is cheap here. These `-c` overrides are applied to every command this
 * client runs (simple-git's `config` option prepends them as `git -c …`),
 * which is the highest precedence git offers — above anything the tree's own
 * `.git/config` carries. So the host git ignores whatever hooks path or
 * monitor the tree names. `core.pager` is pinned too, since a pager is another
 * command the tree could point at something arbitrary.
 */
const HARDENED_GIT_CONFIG: string[] = [
  'core.hooksPath=/dev/null',
  'core.fsmonitor=false',
  'core.pager=cat',
];

/**
 * A `SimpleGit` bound to `baseDir` with every tree-carried hook and monitor neutralised.
 *
 * simple-git's own guard blocks a caller from passing `-c core.hooksPath`,
 * `-c core.fsmonitor` or `-c core.pager`, since those are the categories an
 * attacker abuses. That guard inspects the command line and environment only,
 * not the repository's `.git/config` — which is precisely where the agent's
 * planted value would live, and which git honours natively. So the guard does
 * not defend against this threat; it only stands in the way of the override
 * that does. The `unsafe` flags below lift it for these three categories, and
 * the values passed are the safe ones (no hooks, no monitor, a plain pager).
 */
export function hardenedGit(baseDir: string): SimpleGit {
  return simpleGit(baseDir, {
    config: HARDENED_GIT_CONFIG,
    unsafe: {
      allowUnsafeHooksPath: true,
      allowUnsafeFsMonitor: true,
      allowUnsafePager: true,
    },
  });
}

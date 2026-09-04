import type { RepoClient } from './types';

/**
 * Whether a pending change was built against a version of the site that has
 * since moved on (FR-030).
 *
 * The question a publish really asks is "does this change's branch already
 * contain the site's current tip?", and that is an ancestry question. It used
 * to be approximated from commit timestamps, which caught the common case and
 * missed one: a follow-up committed after the site moved made the change look
 * current again. The repository client now exposes the comparison directly,
 * so the answer is exact — a site commit the change never saw is a site
 * commit the change never saw, however recently the change was touched.
 */

export interface Freshness {
  outOfDate: boolean;
  /** How many commits the site carries that the change does not. */
  behindBy: number;
}

export async function readChangeFreshness(
  client: RepoClient,
  input: { branch: string; defaultBranch: string },
): Promise<Freshness> {
  // Not a staleness answer: the site's own branch is unreadable, and reporting
  // that as either fresh or stale would be inventing a fact about the site.
  if (!(await client.getRef(`refs/heads/${input.defaultBranch}`))) {
    throw new Error(`default branch ref not found: refs/heads/${input.defaultBranch}`);
  }

  // Publishing is the irreversible direction (constitution II), so a change
  // with no branch left to publish resolves against it.
  if (!(await client.getRef(`refs/heads/${input.branch}`))) {
    return { outOfDate: true, behindBy: 0 };
  }

  // `base...head` with the change as base: `aheadBy` is then the number of
  // site commits the change lacks.
  const comparison = await client.compareBranches(input.branch, input.defaultBranch);
  return { outOfDate: comparison.aheadBy > 0, behindBy: comparison.aheadBy };
}

import type { RefInfo, RepoClient } from './types';

/**
 * Whether a pending change was built against a version of the site that has
 * since moved on (FR-030).
 *
 * The question a publish really asks is "does this change's branch already
 * contain the site's current tip?", and answering it exactly needs an ancestry
 * comparison the repository client does not expose. What it does expose is
 * when each ref's commit was written, and that is enough to catch the case the
 * specification names: another conversation published, or a developer pushed,
 * after this change was made. Both move the site's branch to a commit newer
 * than anything on the change's branch.
 *
 * The residual gap is worth stating plainly rather than discovering later: a
 * follow-up request that commits to this branch *after* the site moved makes
 * the change look current again, because its newest commit is newest overall.
 * That case is not silent data loss — merging still combines the two histories
 * rather than reverting the other change — but it is not detected here, and
 * closing it needs a commit comparison on the client (see the note in this
 * feature's report).
 */

export interface Freshness {
  outOfDate: boolean;
}

/**
 * `null` for the change's own branch means there is nothing left to publish,
 * which counts as out of date rather than as current: publishing is the
 * irreversible direction (constitution II), so every ambiguity here — an
 * absent branch, a timestamp that will not parse — resolves against it.
 */
export function isBehind(siteTip: RefInfo, changeTip: RefInfo | null): boolean {
  if (!changeTip) return true;

  const siteAt = Date.parse(siteTip.committedAt);
  const changeAt = Date.parse(changeTip.committedAt);
  if (Number.isNaN(siteAt) || Number.isNaN(changeAt)) return true;

  return siteAt > changeAt;
}

export async function readChangeFreshness(
  client: RepoClient,
  input: { branch: string; defaultBranch: string },
): Promise<Freshness> {
  const siteTip = await client.getRef(`refs/heads/${input.defaultBranch}`);
  // Not a staleness answer: the site's own branch is unreadable, and reporting
  // that as either fresh or stale would be inventing a fact about the site.
  if (!siteTip) throw new Error(`default branch ref not found: refs/heads/${input.defaultBranch}`);

  const changeTip = await client.getRef(`refs/heads/${input.branch}`);
  return { outOfDate: isBehind(siteTip, changeTip) };
}

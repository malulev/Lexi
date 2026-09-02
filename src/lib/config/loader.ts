/**
 * Turns the three repository-declared files (contracts/repo-files.md) into one
 * RepoConfig. This is the `load` function `createConfigCache` wraps — it knows
 * nothing about caching or last-known-good; that is the cache's job, not this
 * module's, per single-purpose functions.
 */
import type { RepoClient } from '@/lib/github/types';
import type { RepoConfig } from '@/types';
import { parsePolicy } from '@/lib/policy/parse';
import { parseSettings } from './settings';

const CONFIG_PATH = '.webagent/config.yml';
const POLICY_PATH = '.webagent/policy.yml';
const GUIDANCE_PATH = 'AGENTS.md';

/** Returns a loader bound to `client`, matching the shape `createConfigCache`
 * expects: a zero-argument function that either resolves with a complete
 * RepoConfig or rejects with a descriptive Error. */
export function createConfigLoader(client: RepoClient): () => Promise<RepoConfig> {
  return async function load(): Promise<RepoConfig> {
    // Independent reads, issued together: the latency budget (research.md,
    // median four minutes end to end) has no room for three round trips in
    // series when one will do.
    const [configSource, policySource, guidance] = await Promise.all([
      client.readFile(CONFIG_PATH),
      client.readFile(POLICY_PATH),
      client.readFile(GUIDANCE_PATH),
    ]);

    // Settings are required (FR-003c): with no config.yml there is nothing
    // valid to fall back to, so this must fault rather than assume defaults.
    if (configSource === null) {
      throw new Error(`${CONFIG_PATH}: file is required but was not found in the repository`);
    }

    return {
      settings: parseSettings(configSource),
      policy: parsePolicy(policySource),
      guidance: guidance ?? '',
    };
  };
}

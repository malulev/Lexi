import { isUsablePasswordHash, isUsableTotpSecret } from '@/lib/auth/config-credential';
import { createTokenMinter, type TokenMinter } from '@/lib/github/auth';
import type { RepoClient } from '@/lib/github/types';
import type { NetlifyClient } from '@/lib/netlify';
import type { Env } from '@/types';

/**
 * Startup validation (FR-003b).
 *
 * `parseEnv` already answers "is every variable present and shaped right?".
 * This answers the question it cannot: does the repository exist, is the App
 * installed on it, does the hosting site answer, and is the configuration
 * credential usable at all. Those are reachability questions, so they belong
 * to boot rather than to the first client request — a developer who mistyped
 * a site id should learn it from the container's first ten lines, not from a
 * client whose change silently never previews.
 *
 * Reads only. Nothing here writes, caches, or repairs anything (constitution
 * VII); a failed check is reported and the process refuses to serve.
 *
 * Every probe is injected, so the whole of this can be proved without a
 * GitHub App, a Netlify account, or a socket.
 */

export interface StartupFault {
  /** The deployment variable to go and look at. */
  setting: string;
  /** Written for the developer reading a container log at 2am. */
  message: string;
}

export type StartupReport = { ok: true } | { ok: false; faults: StartupFault[] };

export interface StartupDeps {
  env: Env;
  client: RepoClient;
  netlify: NetlifyClient;
  /** Minting a token is the only way to learn whether the installation is real. */
  tokens: TokenMinter;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The App can be configured perfectly and still be installed nowhere. This
 * fails before the repository check can say anything useful, which is why the
 * two are reported as separate settings rather than as one "GitHub" fault.
 */
async function checkInstallation(deps: StartupDeps): Promise<StartupFault | null> {
  try {
    await deps.tokens.getToken();
    return null;
  } catch (error) {
    return {
      setting: 'GITHUB_INSTALLATION_ID',
      message:
        `No GitHub App installation answered for id ${deps.env.githubInstallationId}. ` +
        'Confirm the App is installed on the site repository, and that ' +
        'GITHUB_INSTALLATION_ID is the number at the end of ' +
        'github.com/settings/installations/<id>, not the App id. ' +
        `Check GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY too. (${reasonOf(error)})`,
    };
  }
}

/** Reading the default branch is the cheapest question only a reachable repository can answer. */
async function checkRepository(deps: StartupDeps): Promise<StartupFault | null> {
  const slug = `${deps.env.githubRepoOwner}/${deps.env.githubRepoName}`;
  try {
    await deps.client.getDefaultBranch();
    return null;
  } catch (error) {
    return {
      setting: 'GITHUB_REPO',
      message:
        `The repository ${slug} could not be read. Confirm GITHUB_REPO names a repository that ` +
        'exists, that the GitHub App is installed on it, and that the App has Contents and ' +
        `Pull requests permission. (${reasonOf(error)})`,
    };
  }
}

/**
 * A site that answers with nothing is treated exactly like one that does not
 * answer: an installation with no site to deploy to has no loop to run.
 */
async function checkHostingSite(deps: StartupDeps): Promise<StartupFault | null> {
  const siteId = deps.env.netlifySiteId;
  const advice =
    `Confirm NETLIFY_SITE_ID is the site id from Site configuration → General, and that ` +
    'NETLIFY_TOKEN is a current personal access token. Deploy Previews must also be enabled ' +
    'for pull requests, or a change will preview nowhere.';

  try {
    const site = await deps.netlify.getSite();
    if (site) return null;
    return { setting: 'NETLIFY_SITE_ID', message: `Netlify returned no site for "${siteId}". ${advice}` };
  } catch (error) {
    return {
      setting: 'NETLIFY_SITE_ID',
      message: `The Netlify site "${siteId}" could not be reached. ${advice} (${reasonOf(error)})`,
    };
  }
}

/**
 * The configuration credential is the one setting whose invalidity stays
 * invisible until the day it is needed — which is, by definition, a day
 * something else is already wrong. It is checked here for that reason.
 */
async function checkConfigCredential(env: Env): Promise<StartupFault[]> {
  const faults: StartupFault[] = [];

  if (!(await isUsablePasswordHash(env.configPasswordHash))) {
    faults.push({
      setting: 'CONFIG_PASSWORD_HASH',
      message:
        'CONFIG_PASSWORD_HASH is not an argon2 hash. It holds the hash of the configuration ' +
        "password, never the password itself — run `npm run gen:secrets -- --password '<yours>'` " +
        'and take the line it prints.',
    });
  }

  if (!(await isUsableTotpSecret(env.configTotpSecret))) {
    faults.push({
      setting: 'CONFIG_TOTP_SECRET',
      message:
        'CONFIG_TOTP_SECRET is not a base32 secret of at least 16 bytes, so no authenticator ' +
        'app could produce a code this installation would accept. Run `npm run gen:secrets` and ' +
        'take the line it prints.',
    });
  }

  return faults;
}

/**
 * Runs every check, and reports all of their faults rather than the first —
 * the same choice `parseEnv` makes, for the same reason: a developer fixing a
 * deployment should get the whole list in one pass.
 */
export async function validateStartup(deps: StartupDeps): Promise<StartupReport> {
  const [installation, repository, hosting, credential] = await Promise.all([
    checkInstallation(deps),
    checkRepository(deps),
    checkHostingSite(deps),
    checkConfigCredential(deps.env),
  ]);

  const faults = [installation, repository, hosting, ...credential].filter(
    (fault): fault is StartupFault => fault !== null,
  );

  return faults.length === 0 ? { ok: true } : { ok: false, faults };
}

/** One line per setting, matching the shape `parseEnv` throws for a bad environment. */
export function describeStartupFaults(faults: StartupFault[]): string {
  const lines = faults.map((fault) => `- ${fault.setting}: ${fault.message}`);
  return `Refusing to serve. This installation's configuration is not usable:\n${lines.join('\n')}`;
}

/**
 * The refusal itself. Throwing is the whole point: a process that starts
 * anyway would answer client requests it cannot possibly complete, which is
 * the failure mode FR-003b exists to rule out.
 *
 * `deps` defaults to the one installation this process serves; tests pass
 * their own so that no probe leaves the process.
 */
export async function assertStartupValid(deps?: StartupDeps): Promise<void> {
  const report = await validateStartup(deps ?? (await buildStartupDeps()));
  if (report.ok) return;
  throw new Error(describeStartupFaults(report.faults));
}

/**
 * Builds only what is being validated, rather than reaching for the
 * installation.
 *
 * The installation is the composition root and constructs the container runtime
 * along with everything else. Nothing here validates that runtime, and pulling
 * it in has a cost that is not merely wasteful: this module is reached from the
 * instrumentation hook, which Next compiles for every runtime it targets, and
 * the container client's dependencies bottom out in a native binary that cannot
 * be bundled for a browser. Importing the installation here failed the client
 * build outright and made every page answer 500.
 *
 * The minter is its own for a related reason — the repository client keeps a
 * private one. It performs the same exchange against the same credentials, so
 * an App that cannot mint here cannot mint for a job either; only the cache is
 * unshared, which costs one extra exchange at boot.
 */
async function buildStartupDeps(): Promise<StartupDeps> {
  const { loadEnv } = await import('./env');
  const { createRepoClient } = await import('@/lib/github/client');
  const { createNetlifyClient } = await import('@/lib/netlify');

  const env = loadEnv();
  return {
    env,
    client: createRepoClient(env),
    netlify: createNetlifyClient(env),
    tokens: createTokenMinter(env),
  };
}

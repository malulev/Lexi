import { join } from 'node:path';

import { loadEnv } from '@/lib/config/env';
import { createConfigCache, type ConfigCache } from '@/lib/config/cache';
import { createConfigLoader } from '@/lib/config/loader';
import { createRepoClient } from '@/lib/github/client';
import type { RepoClient } from '@/lib/github/types';
import { jobBus, type JobBus } from '@/lib/jobs/bus';
import { createLock } from '@/lib/lock/lock';
import { createMirror } from '@/lib/mirror/mirror';
import type { Mirror } from '@/lib/mirror/types';
import { createNetlifyClient, type NetlifyClient } from '@/lib/netlify';
import { createMailer, type Mailer } from '@/lib/notify/email';
import { createDockerRunner } from '@/lib/runner/docker';
import type { JobRunner } from '@/lib/runner/types';
import type { Env } from '@/types';

/**
 * The one installation this process serves (constitution VI).
 *
 * There is deliberately no registry, no map keyed by site, and no argument
 * anywhere that selects which website is meant. Isolation between clients is
 * structural: there is no second client's data present to leak.
 *
 * Everything here is built once and reused, because a mirror and a token cache
 * are the two things worth keeping warm inside a four-minute latency budget.
 */

export interface Installation {
  env: Env;
  client: RepoClient;
  netlify: NetlifyClient;
  mirror: Mirror;
  runner: JobRunner;
  mailer: Mailer;
  bus: JobBus;
  lock: ReturnType<typeof createLock>;
  config: ConfigCache;
}

const AGENT_IMAGE = process.env.AGENT_IMAGE ?? 'webagent/agent:latest';
const STATE_DIR = process.env.WEBAGENT_STATE_DIR ?? '/var/lib/webagent';

let installation: Installation | null = null;

export function getInstallation(): Installation {
  if (installation) return installation;

  const env = loadEnv();
  const client = createRepoClient(env);

  installation = {
    env,
    client,
    netlify: createNetlifyClient(env),
    mirror: createMirror({
      remoteUrl: () => client.authenticatedRemoteUrl(),
      cacheDir: join(STATE_DIR, 'mirror'),
      workRoot: join(STATE_DIR, 'work'),
    }),
    runner: createDockerRunner({ image: AGENT_IMAGE, apiKey: env.openrouterApiKey }),
    mailer: createMailer(env),
    bus: jobBus,
    lock: createLock(client),
    config: createConfigCache(createConfigLoader(client)),
  };

  return installation;
}

/** Lets a test substitute the whole installation, since nothing else selects a site. */
export function setInstallation(replacement: Installation | null): void {
  installation = replacement;
}

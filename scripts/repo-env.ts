import { readFileSync } from 'node:fs';

import { parseEnv } from '../src/lib/config/env';
import type { Env } from '../src/types';

/**
 * Reads the deployment's own `.env`/`.env.local` the way Next does and returns
 * a typed `Env`.
 *
 * Operational scripts need the real configuration without booting the app, and
 * `loadEnv()` reads `process.env`, which those scripts do not have populated.
 * Files later in the list win, matching Next's precedence.
 */
const ENV_FILES = ['.env', '.env.local'] as const;

export function loadEnvFromFiles(): Env {
  const raw: Record<string, string> = {};

  for (const name of ENV_FILES) {
    let text: string;
    try {
      text = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(/^([A-Z0-9_]+)=(?:"([\s\S]*?)"|(.*))$/gm)) {
      raw[match[1]!] = match[2] ?? match[3] ?? '';
    }
  }

  return parseEnv(raw as unknown as NodeJS.ProcessEnv);
}

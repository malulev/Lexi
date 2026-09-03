import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { escapeForDotenv } from '../../../scripts/gen-secrets';

/**
 * A dotenv file is not a place values survive unchanged.
 *
 * Next expands `$NAME` when it loads one, and an argon2 hash is nothing but
 * `$` markers: `$argon2id$v=19$m=65536,...`. Each reads as an undefined
 * variable and disappears. What comes out still looks like a plausible secret,
 * so nothing downstream notices — this survived a complete end-to-end run and
 * was only caught when startup validation began checking the hash's shape.
 *
 * The test writes a real file and reads it back through the same loader the
 * application uses, because the fact worth asserting is what Next does, not
 * what a regular expression does.
 */

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function loadThrough(lines: string[]): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'webagent-dotenv-'));
  dirs.push(dir);
  await writeFile(join(dir, '.env'), `${lines.join('\n')}\n`, 'utf8');

  const { loadEnvConfig } = await import('@next/env');
  // `forceReload`, because the loader caches its first result for the process
  // and every case here needs its own file read. `log: false` keeps the
  // loader's "Environments: .env" chatter out of the test output.
  const { combinedEnv } = loadEnvConfig(dir, true, { info: () => {}, error: () => {} }, true);
  return combinedEnv as NodeJS.ProcessEnv;
}

const ARGON2 = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaHZhbHVl';

describe('secrets written into a dotenv file', () => {
  it('loses its parameters when a hash is written bare, which is the bug', async () => {
    const env = await loadThrough([`CONFIG_PASSWORD_HASH=${ARGON2}`]);

    expect(env.CONFIG_PASSWORD_HASH).not.toBe(ARGON2);
    expect(env.CONFIG_PASSWORD_HASH).not.toContain('argon2id');
  });

  it('is not saved by quoting, single or double', async () => {
    const env = await loadThrough([
      `SINGLE='${ARGON2}'`,
      `DOUBLE="${ARGON2}"`,
    ]);

    expect(env.SINGLE).not.toBe(ARGON2);
    expect(env.DOUBLE).not.toBe(ARGON2);
  });

  it('survives escaping, which is what the generator emits', async () => {
    const env = await loadThrough([`CONFIG_PASSWORD_HASH=${escapeForDotenv(ARGON2)}`]);

    expect(env.CONFIG_PASSWORD_HASH).toBe(ARGON2);
  });

  it('leaves a value with no dollar sign exactly as it was', async () => {
    // Every generated value is escaped uniformly, so this proves escaping is
    // free for the ones that did not need it.
    const base64url = 'ta8KZuT-xQ7_mVnP0aZ1cD2eF3gH4iJ5kL6mN7oP8qR9';

    const env = await loadThrough([`SESSION_SECRET=${escapeForDotenv(base64url)}`]);

    expect(env.SESSION_SECRET).toBe(base64url);
  });
});

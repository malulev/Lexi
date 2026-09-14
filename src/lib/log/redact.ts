import type { Env } from '@/types';

/**
 * Names that read as a credential.
 *
 * One regex, two enforcement points: `config/settings.ts` rejects a key
 * shaped like this in a site's `config.yml`, and this module blanks a field
 * shaped like this on its way to a log line. A second copy would drift, and
 * the drift would be invisible until the day it mattered.
 */
export const SECRET_SHAPED_KEY =
  /secret|token|password|passphrase|api[-_]?key|private[-_]?key|credential/i;

const REDACTED = '[redacted]';

/**
 * Shapes that are a credential wherever they appear, whatever the field is
 * called. These work before `initLogRedaction` has run — during boot, and in
 * any test that never loads an environment.
 */
const SECRET_SHAPED_VALUE: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9-]{16,}/g,
  /\bnfp_[A-Za-z0-9]{16,}/g,
  // Userinfo in any URL: smtp://user:password@host is the one that bites.
  /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
];

/**
 * Literal values from this deployment's environment. Populated once at boot;
 * empty before that, which is why the patterns above exist as well.
 *
 * Short values are never registered: a three-character secret would blank
 * every unrelated substring that happened to contain it, which corrupts logs
 * without protecting anything.
 */
let secretValues: string[] = [];

const MIN_REGISTERED_LENGTH = 8;

/**
 * Registers this installation's own secrets so they can never appear in a log
 * line, however they got into one. Call once, as early as the environment is
 * available — `instrumentation-node.ts`, immediately after `loadEnv()`.
 */
export function initLogRedaction(env: Env): void {
  secretValues = [
    env.githubAppPrivateKey,
    env.netlifyToken,
    env.netlifyWebhookSecret,
    env.openrouterApiKey,
    env.sessionSecret,
    env.totpSecret,
    env.smtpUrl,
  ]
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => value.length >= MIN_REGISTERED_LENGTH)
    // Longest first: a secret that contains another is blanked whole rather
    // than leaving the tail of it behind.
    .sort((a, b) => b.length - a.length);
}

/** Test seam. Production code calls `initLogRedaction` and nothing else. */
export function resetLogRedaction(): void {
  secretValues = [];
}

/** Blanks anything that is, or contains, a known or credential-shaped value. */
export function redactValue(value: string): string {
  let out = value;
  for (const secret of secretValues) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  for (const pattern of SECRET_SHAPED_VALUE) {
    out = out.replace(pattern, (match, prefix?: string) =>
      // The URL pattern keeps its scheme so the line still says which service.
      typeof prefix === 'string' ? `${prefix}${REDACTED}@` : REDACTED,
    );
  }
  return out;
}

/** Blanks a field whose *name* reads as a credential, and scrubs the rest. */
export function redactField(key: string, value: unknown): unknown {
  if (SECRET_SHAPED_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactValue(value);
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? redactValue(entry) : entry));
  }
  return value;
}

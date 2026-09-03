/**
 * Parsing and validation for `.webagent/config.yml` — see
 * specs/001-conversational-site-editing/contracts/repo-files.md.
 *
 * Every fault here becomes a thrown Error with a message meant to be read by a
 * developer, because the caller (src/lib/config/cache.ts) reports it verbatim
 * to the alert contact rather than doing anything clever with it. A vague
 * message here is a vague alert email later.
 */
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Settings } from '@/types';

// Strict, not passthrough: an unknown key — a typo, a leftover, a
// misplaced setting — must fail loudly rather than be quietly dropped.
const settingsSchema = z.strictObject({
  alertContact: z.string().email('alertContact must be a valid email address'),
  costCeilingUsd: z.number().positive('costCeilingUsd must be greater than 0'),
  // `provider/model`, where the model half may itself contain slashes (e.g.
  // `openrouter/anthropic/claude-sonnet-latest`) — so this checks "at least
  // one non-empty segment, then a slash, then at least one more", not an
  // exact two-part split.
  model: z
    .string()
    .regex(/^[^\s/]+(\/[^\s/]+)+$/, 'model must be in `provider/model` shape'),
  maxRequestMinutes: z
    .number()
    .int('maxRequestMinutes must be a whole number')
    .min(1, 'maxRequestMinutes must be at least 1')
    .max(30, 'maxRequestMinutes must be at most 30'),
});

/** Permitted sign-ins belong in deployment configuration (FR-003c1), never in
 * the repository a developer can push to. Naming the offending key and its
 * proper home turns a confusing rejection into a one-line fix. */
function rejectAllowedEmails(issue: z.core.$ZodIssue): never | void {
  if (issue.code !== 'unrecognized_keys') return;
  if (!issue.keys.includes('allowedEmails')) return;

  throw new Error(
    '.webagent/config.yml: `allowedEmails` does not belong in the site repository. ' +
      'Permitted sign-ins are deployment configuration — set ALLOWED_EMAILS where the ' +
      'installation is deployed, not in this file. Write access to the repository must ' +
      'not be able to grant access to the editing interface.',
  );
}

/**
 * Names that read as a credential. The strict schema already rejects every one
 * of them as unrecognised; this exists so the rejection says *why* (FR-003d).
 * A developer who commits `netlifyToken` has not made a typo, they have
 * misunderstood where secrets live, and "unrecognized key" does not correct
 * that — it invites them to look for the right spelling.
 */
const SECRET_SHAPED_KEY =
  /secret|token|password|passphrase|api[-_]?key|private[-_]?key|credential/i;

/** Rejects a secret committed to the site's repository rather than honouring it (FR-003d). */
function rejectSecretShapedKey(issue: z.core.$ZodIssue): never | void {
  if (issue.code !== 'unrecognized_keys') return;

  const offending = issue.keys.filter((key) => SECRET_SHAPED_KEY.test(key));
  if (offending.length === 0) return;

  // The committed value is deliberately not quoted back: it may well be a live
  // credential, and this message ends up in an alert email and a container log.
  throw new Error(
    `.webagent/config.yml: ${offending.join(', ')} reads as a secret, and secrets do not ` +
      'belong in the site repository. They are deployment configuration — set them where the ' +
      'installation is deployed. Anything committed here is readable by everyone with access ' +
      'to the repository, so this file is rejected rather than honoured.',
  );
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  return `${path}: ${issue.message}`;
}

/** Throws a descriptive Error on any fault: YAML syntax, an unknown field, a
 * missing field, or a field outside its documented bounds. Never returns a
 * partial or best-guess Settings — the caller relies on all-or-nothing. */
export function parseSettings(source: string): Settings {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`.webagent/config.yml: could not parse YAML: ${detail}`);
  }

  const result = settingsSchema.safeParse(raw);
  if (result.success) return result.data;

  for (const issue of result.error.issues) {
    rejectAllowedEmails(issue);
    rejectSecretShapedKey(issue);
  }

  const detail = result.error.issues.map(describeIssue).join('; ');
  throw new Error(`.webagent/config.yml: invalid settings: ${detail}`);
}

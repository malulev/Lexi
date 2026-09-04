import { minimatch } from 'minimatch';
import type { ChangedFile, GateResult, Policy } from '@/types';
import { UNCONDITIONAL_DENIES } from './parse';

// minimatch's `**` skips dotfiles unless told otherwise, and several of the
// unconditional denies (`.webagent/**`, `**/.env*`) are dotfiles by design.
const GLOB_OPTIONS = { dot: true } as const;

// Manifests and lockfiles are already caught by the unconditional denies
// (rule 1); what is left for forbidNewDependencies to catch is a dependency
// vendored straight into the tree, bypassing a manifest entirely.
const VENDOR_DIRECTORY_GLOBS = [
  'vendor/**',
  '**/vendor/**',
  'node_modules/**',
  '**/node_modules/**',
];

/**
 * Markup that makes a page run or show something from somewhere else.
 *
 * A script tag pointing off-site is the shape of a card skimmer; an iframe,
 * object or embed is a page inside the page; a meta refresh or a `<base>`
 * quietly sends every visitor, or every relative link, elsewhere; a
 * `javascript:` URL is a script wearing a link's clothes. None of these are
 * things a content edit needs, and any of them is what an agent that has
 * been talked into something would add. Inline scripts and same-origin
 * script files are left alone: a site's own JavaScript is an allowed file
 * like any other, and the allow list governs it.
 */
const EXTERNAL_CODE_PATTERNS: RegExp[] = [
  /<script\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<(?:iframe|object|embed|portal)\b/i,
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i,
  /<base\b/i,
  /\b(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i,
  /<link\b[^>]*\brel\s*=\s*["']?(?:import|prefetch|modulepreload)\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
];

/** Where any of these files may be looked at for markup: text a browser will run or render. */
const MARKUP_EXTENSIONS =
  /\.(?:html?|xhtml|svg|md|mdx|astro|vue|svelte|jsx|tsx|hbs|ejs|njk|liquid|php)$/i;

export interface GateOptions {
  /**
   * Files the host itself placed for the client — attachments — at exactly
   * these paths, and still byte-for-byte what the client sent. They were
   * asked for by the person the allow list exists to serve, so they need not
   * match it. They are still subject to every deny, to the size limits, and
   * to everything else: only rule 3 makes an exception, and only for them.
   */
  attachedPaths?: string[];
}

function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((glob) => minimatch(path, glob, GLOB_OPTIONS));
}

/**
 * A path the gate refuses to reason about at all.
 *
 * Every rule below is a glob match, and a glob match is only as trustworthy as
 * the shape of the string it is given: `./.webagent/config.yml` and
 * `src/../.webagent/config.yml` both name a protected file while matching none
 * of the protective globs. Git's own status output is already normalised and
 * repository-relative, so in practice these should never appear — which is
 * exactly why an appearance means something has gone wrong upstream, and the
 * safe answer is refusal rather than a best-effort interpretation.
 */
function findMalformedPathViolation(files: ChangedFile[]): GateResult | null {
  const offender = files.find((file) => !isRepositoryRelative(file.path));
  return offender ? { ok: false, violation: 'protected_path', path: offender.path } : null;
}

function isRepositoryRelative(path: string): boolean {
  if (path === '' || path.trim() !== path) return false;
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false;
  if (path.includes('\\') || path.includes('\0')) return false;

  const segments = path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * A symbolic link is a path that says one thing and means another. An
 * allowed `styles.css` that is really a link to `.webagent/config.yml` passes
 * every glob and publishes the target's contents; a link out of the tree
 * publishes whatever the build machine has there. No static site needs one.
 */
function findSymlinkViolation(files: ChangedFile[]): GateResult | null {
  const offender = files.find((file) => file.symlink === true);
  return offender ? { ok: false, violation: 'symlink', path: offender.path } : null;
}

function findUnconditionalDenyViolation(files: ChangedFile[]): GateResult | null {
  const offender = files.find((file) => matchesAny(file.path, UNCONDITIONAL_DENIES));
  return offender ? { ok: false, violation: 'protected_path', path: offender.path } : null;
}

function findSiteDenyViolation(files: ChangedFile[], policy: Policy): GateResult | null {
  const offender = files.find((file) => matchesAny(file.path, policy.deny));
  return offender ? { ok: false, violation: 'denied_path', path: offender.path } : null;
}

function findNotAllowedViolation(
  files: ChangedFile[],
  policy: Policy,
  attachedPaths: ReadonlySet<string>,
): GateResult | null {
  const offender = files.find(
    (file) => !attachedPaths.has(file.path) && !matchesAny(file.path, policy.allow),
  );
  return offender ? { ok: false, violation: 'not_allowed_path', path: offender.path } : null;
}

function findSizeViolation(files: ChangedFile[], policy: Policy): GateResult | null {
  if (files.length > policy.maxFilesChanged) {
    return {
      ok: false,
      violation: 'too_many_files',
      actual: files.length,
      limit: policy.maxFilesChanged,
    };
  }

  const totalDiffLines = files.reduce((sum, file) => sum + file.diffLines, 0);
  if (totalDiffLines > policy.maxDiffLines) {
    return {
      ok: false,
      violation: 'too_many_lines',
      actual: totalDiffLines,
      limit: policy.maxDiffLines,
    };
  }

  return null;
}

function findNewDependencyViolation(files: ChangedFile[], policy: Policy): GateResult | null {
  if (!policy.forbidNewDependencies) return null;

  const offender = files.find((file) => matchesAny(file.path, VENDOR_DIRECTORY_GLOBS));
  return offender ? { ok: false, violation: 'new_dependency', path: offender.path } : null;
}

/** Whether a piece of added text would make a page load or run something from elsewhere. */
export function containsExternalCode(addedText: string): boolean {
  return EXTERNAL_CODE_PATTERNS.some((pattern) => pattern.test(addedText));
}

/**
 * Only *added* text is judged, and only in files a browser renders as
 * markup. An existing analytics tag the site already ships is not this
 * change's doing; a new one is. A stylesheet or a JSON file cannot embed a
 * frame, so they are not read.
 */
function findExternalCodeViolation(files: ChangedFile[], policy: Policy): GateResult | null {
  if (!policy.forbidExternalCode) return null;

  const offender = files.find(
    (file) =>
      file.addedText !== undefined &&
      MARKUP_EXTENSIONS.test(file.path) &&
      containsExternalCode(file.addedText),
  );
  return offender ? { ok: false, violation: 'external_code', path: offender.path } : null;
}

/**
 * Decides whether an agent's change set may be committed.
 *
 * Pure by construction (constitution Principle III): nothing here touches
 * the filesystem or the network, so the one module standing between an
 * autonomous agent and a client's live site can be tested exhaustively
 * without a container or a repository.
 *
 * Rules run in the exact order fixed by contracts/repo-files.md, and the
 * order is load-bearing: a path that would fail two rules at once is
 * reported for the earlier one, because that is the violation that governs.
 *
 * Path shape is checked ahead of all of them, because a rule that reads a
 * malformed path has already lost; a symbolic link is refused next, because
 * a rule that reads a path which means some other path has lost too.
 */
export function gate(files: ChangedFile[], policy: Policy, options: GateOptions = {}): GateResult {
  const attachedPaths = new Set(options.attachedPaths ?? []);
  return (
    findMalformedPathViolation(files) ??
    findSymlinkViolation(files) ??
    findUnconditionalDenyViolation(files) ??
    findSiteDenyViolation(files, policy) ??
    findNotAllowedViolation(files, policy, attachedPaths) ??
    findSizeViolation(files, policy) ??
    findNewDependencyViolation(files, policy) ??
    findExternalCodeViolation(files, policy) ?? { ok: true }
  );
}

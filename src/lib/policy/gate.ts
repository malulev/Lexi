import { minimatch } from 'minimatch';
import type { ChangedFile, GateResult, Policy } from '@/types';
import { UNCONDITIONAL_DENIES } from './parse';

// minimatch's `**` skips dotfiles unless told otherwise, and several of the
// unconditional denies (`.webagent/**`, `**/.env*`) are dotfiles by design.
const GLOB_OPTIONS = { dot: true } as const;

// Manifests and lockfiles are already caught by the unconditional denies
// (rule 1); what is left for forbidNewDependencies to catch is a dependency
// vendored straight into the tree, bypassing a manifest entirely.
const VENDOR_DIRECTORY_GLOBS = ['vendor/**', '**/vendor/**', 'node_modules/**', '**/node_modules/**'];

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

function findUnconditionalDenyViolation(files: ChangedFile[]): GateResult | null {
  const offender = files.find((file) => matchesAny(file.path, UNCONDITIONAL_DENIES));
  return offender ? { ok: false, violation: 'protected_path', path: offender.path } : null;
}

function findSiteDenyViolation(files: ChangedFile[], policy: Policy): GateResult | null {
  const offender = files.find((file) => matchesAny(file.path, policy.deny));
  return offender ? { ok: false, violation: 'denied_path', path: offender.path } : null;
}

function findNotAllowedViolation(files: ChangedFile[], policy: Policy): GateResult | null {
  const offender = files.find((file) => !matchesAny(file.path, policy.allow));
  return offender ? { ok: false, violation: 'not_allowed_path', path: offender.path } : null;
}

function findSizeViolation(files: ChangedFile[], policy: Policy): GateResult | null {
  if (files.length > policy.maxFilesChanged) {
    return { ok: false, violation: 'too_many_files', actual: files.length, limit: policy.maxFilesChanged };
  }

  const totalDiffLines = files.reduce((sum, file) => sum + file.diffLines, 0);
  if (totalDiffLines > policy.maxDiffLines) {
    return { ok: false, violation: 'too_many_lines', actual: totalDiffLines, limit: policy.maxDiffLines };
  }

  return null;
}

function findNewDependencyViolation(files: ChangedFile[], policy: Policy): GateResult | null {
  if (!policy.forbidNewDependencies) return null;

  const offender = files.find((file) => matchesAny(file.path, VENDOR_DIRECTORY_GLOBS));
  return offender ? { ok: false, violation: 'new_dependency', path: offender.path } : null;
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
 * malformed path has already lost.
 */
export function gate(files: ChangedFile[], policy: Policy): GateResult {
  return (
    findMalformedPathViolation(files) ??
    findUnconditionalDenyViolation(files) ??
    findSiteDenyViolation(files, policy) ??
    findNotAllowedViolation(files, policy) ??
    findSizeViolation(files, policy) ??
    findNewDependencyViolation(files, policy) ?? { ok: true }
  );
}

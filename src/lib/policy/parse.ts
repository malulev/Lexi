import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Policy } from '@/types';

/**
 * The default protective policy (FR-019, data-model.md): a site that
 * declares no `.webagent/policy.yml` still gets a bounded, reversible
 * change set rather than an unrestricted one.
 */
export const DEFAULT_POLICY: Policy = {
  allow: ['**'],
  deny: [],
  maxFilesChanged: 15,
  maxDiffLines: 800,
  forbidNewDependencies: true,
};

/**
 * Paths no site policy can permit (FR-003e). Applied by the gate ahead of,
 * and independent of, anything a site declares — the location that governs
 * the agent may not be widened by the agent's own rules.
 *
 * Dependency manifests and lockfiles are matched at any depth: a monorepo's
 * nested `package.json` is exactly as dependency-bearing as the root one.
 */
export const UNCONDITIONAL_DENIES: string[] = [
  '.webagent/**',
  // Guidance is denied at any depth, and so is the file OpenCode falls back to
  // when AGENTS.md is absent (R1). Guidance is advisory and never widens the
  // gate, but an agent able to write its own future instructions is an agent
  // shaping the next run's behaviour, which is not a capability this grants.
  '**/AGENTS.md',
  '**/CLAUDE.md',
  '**/.opencode/**',
  '**/.env*',
  '.github/**',
  'netlify.toml',
  '**/package.json',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/npm-shrinkwrap.json',
  '**/bun.lockb',
  '**/Gemfile',
  '**/Gemfile.lock',
  '**/requirements.txt',
  '**/pyproject.toml',
  '**/poetry.lock',
  '**/go.mod',
  '**/go.sum',
  '**/Cargo.toml',
  '**/Cargo.lock',
  '**/composer.json',
  '**/composer.lock',
];

// Unknown keys are rejected rather than ignored, matching config.yml's
// philosophy (contracts/repo-files.md): a mistyped field name is a fault a
// developer should see, not a rule that silently never applies.
const policySchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    maxFilesChanged: z.number().int().nonnegative().optional(),
    maxDiffLines: z.number().int().nonnegative().optional(),
    forbidNewDependencies: z.boolean().optional(),
  })
  .strict();

function parseYamlSource(source: string): unknown {
  try {
    return parseYaml(source);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`.webagent/policy.yml is not valid YAML: ${message}`);
  }
}

/**
 * Parses `.webagent/policy.yml`, defaulting every field a site omits.
 *
 * `source` is `null` when the file does not exist — that is not a fault, it
 * is the documented way to accept the default policy (FR-019). Malformed
 * YAML or a shape that does not match the schema throws, because unlike a
 * missing file, that is a fault the developer needs to see and fix (the
 * caller is expected to keep the last valid policy in force, per FR-003f's
 * sibling handling of `config.yml`).
 */
export function parsePolicy(source: string | null): Policy {
  if (source === null || source.trim() === '') return DEFAULT_POLICY;

  const parsed = parseYamlSource(source) ?? {};
  const result = policySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`.webagent/policy.yml has an invalid shape: ${result.error.message}`);
  }

  return {
    allow: result.data.allow ?? DEFAULT_POLICY.allow,
    deny: result.data.deny ?? DEFAULT_POLICY.deny,
    maxFilesChanged: result.data.maxFilesChanged ?? DEFAULT_POLICY.maxFilesChanged,
    maxDiffLines: result.data.maxDiffLines ?? DEFAULT_POLICY.maxDiffLines,
    forbidNewDependencies: result.data.forbidNewDependencies ?? DEFAULT_POLICY.forbidNewDependencies,
  };
}

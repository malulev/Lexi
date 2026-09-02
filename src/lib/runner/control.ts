import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { AgentPrompt, AgentResult } from '@/types';

/**
 * The `/control` channel: the container's only instruction (`prompt.json`)
 * and only structured output (`result.json`) (contracts/repo-files.md).
 *
 * Everything here treats the container as untrusted. `writeControlDir` is
 * the one place that can assert the mount layout is safe before a container
 * ever starts; `readAgentResult` is total — malformed input degrades to
 * `null`, matching the house rule for anything a possibly-adversarial
 * process writes back to us (see `record/record.ts` for the same rule
 * applied to durable comments).
 */

const PROMPT_FILE_NAME = 'prompt.json';
const RESULT_FILE_NAME = 'result.json';

// Unlike config.yml/policy.yml (developer-authored, unknown keys rejected so
// a typo is loud), result.json is agent-authored. We still reject unknown
// keys: entrypoint.sh is the only writer we control, so an unexpected shape
// means something went wrong, not a benign extension.
const agentResultSchema = z
  .object({
    summary: z.string(),
    filesChanged: z.array(z.string()),
    tokensIn: z.number(),
    tokensOut: z.number(),
    costUsd: z.number(),
  })
  .strict();

/**
 * True when `candidate` is `base` itself or a path underneath it. Used to
 * enforce FR-015's structural guarantee: a control file must never be
 * reachable from inside the working tree, no matter what the agent does to
 * `/work`, because `/control` was never mounted there to begin with.
 */
function isWithin(base: string, candidate: string): boolean {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Throws when `controlDir` is `workDir` or sits inside it. This is the
 * structural half of FR-015: the container is never given the means to make
 * a control file part of a change to the client's site, independent of
 * whatever the docker runner also enforces when it builds the mounts.
 *
 * `RunRequest` in `./types.ts` documents this same invariant on the two
 * paths it carries; this function is where it is actually checked, so both
 * `writeControlDir` (below) and the docker runner can call one guard rather
 * than re-implementing the path arithmetic.
 */
export function assertControlDirOutsideWorkDir(controlDir: string, workDir: string): void {
  if (isWithin(workDir, controlDir)) {
    throw new Error(
      `controlDir (${controlDir}) must not be inside workDir (${workDir}) — a control file must never be reachable from the working tree (FR-015)`,
    );
  }
}

/**
 * Writes `/control/prompt.json`, the container's only instruction channel.
 *
 * The published contract (contracts/repo-files.md) shows `writeControlDir`
 * taking just `(controlDir, prompt)`. The non-negotiable property attached
 * to this module — "controlDir must never be inside workDir, assert it" —
 * cannot be checked without also knowing `workDir`, so `workDir` is taken
 * here as a required parameter rather than left unchecked. This is the one
 * place in `runner/` where the contract as written and the guarantee it
 * demands could not both be satisfied literally; the guarantee wins.
 */
export async function writeControlDir(controlDir: string, workDir: string, prompt: AgentPrompt): Promise<void> {
  assertControlDirOutsideWorkDir(controlDir, workDir);
  await mkdir(controlDir, { recursive: true });
  await writeFile(join(controlDir, PROMPT_FILE_NAME), JSON.stringify(prompt, null, 2), 'utf8');
}

/**
 * Reads and validates `/control/result.json`.
 *
 * Total by design: a missing file (the agent crashed before writing one), a
 * file that is not JSON, and JSON that does not match `AgentResult` all
 * return `null` rather than throwing. An agent that writes rubbish must
 * produce a failed request via the orchestrator, not an unhandled exception
 * in ours — the container is not a trusted process just because it ran to
 * completion.
 */
export async function readAgentResult(controlDir: string): Promise<AgentResult | null> {
  let raw: string;
  try {
    raw = await readFile(join(controlDir, RESULT_FILE_NAME), 'utf8');
  } catch {
    return null;
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = agentResultSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

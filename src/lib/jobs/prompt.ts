import type { AgentPrompt, Message } from '@/types';

/**
 * What the agent is told, and nothing more.
 *
 * Each job runs in a fresh container with no session continuity (R1), so the
 * conversation has to be carried into the prompt explicitly. Nothing else
 * reaches the container: no credential, no repository address, no knowledge
 * that a preview or a pull request exists.
 */

/** Beyond this, older turns are dropped: a prompt that grows without bound eventually costs more than the change is worth. */
const MAX_HISTORY_TURNS = 20;

/** Build output is long and mostly noise; the tail is where the error is. */
const MAX_BUILD_DETAIL_CHARS = 2_000;

export interface PromptInput {
  request: string;
  history: Message[];
  /** `AGENTS.md` from the repository root. Advisory only — it never widens the gate. */
  guidance: string;
  targetHint?: string;
  /**
   * The previous request's build failure, when there was one (FR-023).
   *
   * This is the one place raw build output is permitted anywhere in the system.
   * It goes to the agent, which is not a client surface; Principle I governs
   * what a person reads, and the agent cannot fix a build it is not shown.
   */
  buildFailureDetail?: string;
}

export function assemblePrompt(input: PromptInput): AgentPrompt {
  const history = input.history
    .slice(-MAX_HISTORY_TURNS)
    .map((message) => ({ author: message.author, text: message.text }));

  const prompt: AgentPrompt = {
    request: composeRequest(input),
    history,
    guidance: input.guidance.trim(),
  };

  if (input.targetHint) prompt.targetHint = input.targetHint;
  return prompt;
}

/**
 * The build failure rides inside the request rather than in a field of its own,
 * because the container's prompt shape is a published contract
 * (contracts/repo-files.md) and widening it for one case would oblige every
 * future agent image to understand it.
 */
function composeRequest(input: PromptInput): string {
  const request = input.request.trim();
  if (!input.buildFailureDetail) return request;

  const detail = truncateToTail(input.buildFailureDetail, MAX_BUILD_DETAIL_CHARS);
  return [
    request,
    '',
    'The previous attempt broke the site build. This is the end of that build output:',
    '',
    detail,
  ].join('\n');
}

/** Keeps the tail, since a build reports its error last and its banner first. */
function truncateToTail(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `…\n${trimmed.slice(trimmed.length - limit)}`;
}

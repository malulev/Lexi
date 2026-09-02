import type { AgentPrompt, Message, MessageAuthor } from '@/types';

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
  /**
   * Paths the policy gate has already refused in this conversation.
   *
   * Like the build failure, these are paths and therefore go to the agent and
   * nowhere near a client surface. Without them a refused attempt is repeated
   * on every later request, because the agent can see that a turn was refused
   * but not what it was refused for.
   */
  refusedPaths?: string[];
}

export function assemblePrompt(input: PromptInput): AgentPrompt {
  const history = input.history.slice(-MAX_HISTORY_TURNS).map(renderTurn);

  const prompt: AgentPrompt = {
    request: composeRequest(input),
    history,
    guidance: input.guidance.trim(),
  };

  if (input.targetHint) prompt.targetHint = input.targetHint;
  return prompt;
}

/**
 * A turn the agent can read the outcome of.
 *
 * The client-facing prose for a refusal is deliberately vague ("your developer
 * has protected this part of the site"), so on its own it reads like an
 * ordinary reply and the next agent treats the request behind it as still
 * outstanding. Saying plainly that the attempt was refused is what stops it
 * being tried again. The turn keeps its published shape — author and text and
 * nothing else — so the marking rides inside the text.
 */
function renderTurn(message: Message): { author: MessageAuthor; text: string } {
  const turn = { author: message.author, text: message.text };
  if (message.author !== 'agent') return turn;
  if (message.outcome === 'blocked')
    return { ...turn, text: `[refused, not applied] ${turn.text}` };
  if (message.outcome === 'failed') return { ...turn, text: `[failed, not applied] ${turn.text}` };
  return turn;
}

/**
 * The build failure and the refused paths ride inside the request rather than
 * in fields of their own, because the container's prompt shape is a published
 * contract (contracts/repo-files.md) and widening it for these cases would
 * oblige every future agent image to understand them.
 */
function composeRequest(input: PromptInput): string {
  const sections = [
    input.request.trim(),
    refusalSection(input.refusedPaths),
    buildFailureSection(input.buildFailureDetail),
  ];
  return sections.filter((section) => section !== null).join('\n\n');
}

function refusalSection(refusedPaths: string[] | undefined): string | null {
  const paths = [...new Set(refusedPaths ?? [])].filter((path) => path.trim() !== '');
  if (paths.length === 0) return null;

  return [
    'An earlier attempt in this conversation was refused for these paths. They are ' +
      'not yours to change: do not create or edit them again. Make the change ' +
      'somewhere permitted, or make no change at all.',
    ...paths.map((path) => `- ${path}`),
  ].join('\n');
}

function buildFailureSection(detail: string | undefined): string | null {
  if (!detail) return null;
  return [
    'The previous attempt broke the site build. This is the end of that build output:',
    '',
    truncateToTail(detail, MAX_BUILD_DETAIL_CHARS),
  ].join('\n');
}

/** Keeps the tail, since a build reports its error last and its banner first. */
function truncateToTail(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `…\n${trimmed.slice(trimmed.length - limit)}`;
}

import type { ModelTier, Settings } from '@/types';

/**
 * How much to spend on a change, as a client sees it.
 *
 * A client is not offered a model list: a marketing manager choosing between
 * forty provider slugs is choosing blind. They are offered five tiers, ordered
 * by cost, each mapped to one model that is good at the work this product
 * does — HTML, CSS and JavaScript in a small site repository. The developer
 * may re-point any tier from `.webagent/config.yml` (`models:`), and the
 * repository's own `model` remains what runs when no tier is chosen at all.
 *
 * This module is imported by the browser bundle (the picker) as well as the
 * orchestrator, so it stays free of Node imports.
 */

export const MODEL_TIERS: readonly ModelTier[] = ['free', 'low', 'medium', 'high', 'extra'];

/**
 * Verified against the OpenRouter model list on 2026-09-03. The free tier is
 * the model this repository's agent image was proven against. Low is DeepSeek
 * V4 Flash (0731), the cheapest model that codes well enough for everyday
 * edits. Medium, high and extra step up through Claude Sonnet 5, Opus 5 and
 * Fable 5.1, so past the cheapest paid rung the trade-off a client makes is
 * capability for cost, not one house style for another.
 */
export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  free: 'openrouter/cohere/north-mini-code:free',
  low: 'openrouter/deepseek/deepseek-v4-flash-0731',
  medium: 'openrouter/anthropic/claude-sonnet-5',
  high: 'openrouter/anthropic/claude-opus-5',
  extra: 'openrouter/anthropic/claude-fable-5.1',
};

/**
 * What a client reads. No provider or model name appears here (Principle I
 * in spirit: the client is choosing a budget, not an implementation), and
 * the cost hint is relative rather than a price, because the price per token
 * means nothing to the person reading it.
 */
export const MODEL_TIER_LABELS: Record<ModelTier, { name: string; cost: string; hint: string }> = {
  free: { name: 'Free', cost: 'No cost', hint: 'Fine for small text and colour changes.' },
  low: { name: 'Basic', cost: 'Low cost', hint: 'Quick, everyday edits.' },
  medium: { name: 'Standard', cost: 'Medium cost', hint: 'A good default for most changes.' },
  high: { name: 'Advanced', cost: 'High cost', hint: 'Bigger layout or multi-page work.' },
  extra: {
    name: 'Expert',
    cost: 'Highest cost',
    hint: 'The most careful work, for tricky changes.',
  },
};

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && (MODEL_TIERS as readonly string[]).includes(value);
}

/** The model a tier runs, honouring a repository override. */
export function modelForTier(settings: Settings, tier: ModelTier): string {
  return settings.models?.[tier] ?? DEFAULT_TIER_MODELS[tier];
}

/**
 * The model one request runs. A request that names no tier — a script, an
 * older interface — gets the repository's own `model`, exactly as before tiers
 * existed, so adding the picker changed nothing for anyone who did not use it.
 */
export function resolveModel(settings: Settings, tier: ModelTier | undefined): string {
  return tier ? modelForTier(settings, tier) : settings.model;
}

/**
 * Where the picker opens: the tier that runs the model the repository already
 * names, so the first request a client sends costs what the developer expected
 * it to. `medium` when the repository names something no tier maps to.
 */
export function selectDefaultTier(settings: Settings): ModelTier {
  return MODEL_TIERS.find((tier) => modelForTier(settings, tier) === settings.model) ?? 'medium';
}

/**
 * The same, for a page that may render before any settings have loaded (or
 * while they are faulty): the picker still opens somewhere sensible, and the
 * server decides what actually runs when the request arrives.
 */
export function defaultTierOf(settings: Settings | null | undefined): ModelTier {
  return settings ? selectDefaultTier(settings) : 'medium';
}

/** Every tier and the model it would run, for the configuration page. */
export function tierModels(
  settings: Settings,
): Array<{ tier: ModelTier; model: string; overridden: boolean }> {
  return MODEL_TIERS.map((tier) => ({
    tier,
    model: modelForTier(settings, tier),
    overridden: settings.models?.[tier] !== undefined,
  }));
}

/**
 * The tier a model belongs to, given the tier table in force — or `null` when
 * the model maps to no tier (a repository `model` no tier names, or a record
 * from before tiers existed).
 */
export function tierOfModel(
  models: Record<ModelTier, string>,
  model: string | undefined,
): ModelTier | null {
  if (!model) return null;
  return MODEL_TIERS.find((tier) => models[tier] === model) ?? null;
}

/** The model behind every tier, as one table — what the picker's details view shows. */
export function tierModelMap(settings: Settings | null | undefined): Record<ModelTier, string> {
  if (!settings) return { ...DEFAULT_TIER_MODELS };
  return Object.fromEntries(
    MODEL_TIERS.map((tier) => [tier, modelForTier(settings, tier)]),
  ) as Record<ModelTier, string>;
}

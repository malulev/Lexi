/**
 * What a change roughly costs, per model, before it is asked for.
 *
 * Advanced mode shows a client the model behind each tier and, beside it, an
 * estimate for one small example task. The estimate is an aid to choosing,
 * not a promise: the real cost is whatever the request's record reports once
 * it has run. Browser-safe — the picker imports this.
 */

/**
 * US dollars per million tokens, keyed by the `provider/model` string used
 * in `.webagent/config.yml`. Verified against OpenRouter on 2026-09-03. A
 * model missing here (a repository override, say) simply gets no estimate.
 */
export const MODEL_PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  'openrouter/cohere/north-mini-code:free': { input: 0, output: 0 },
  'openrouter/deepseek/deepseek-v4-flash-0731': { input: 0.065, output: 0.18 },
  'openrouter/anthropic/claude-sonnet-5': { input: 2, output: 10 },
  'openrouter/anthropic/claude-opus-5': { input: 5, output: 25 },
  'openrouter/anthropic/claude-fable-5.1': { input: 10, output: 50 },
};

/**
 * One small agentic run: read a few pages, several tool turns that each
 * re-send the context, one edit written out. "Replacing a logo" is the task
 * the interface names for it.
 */
export const EXAMPLE_TASK = { inputTokens: 80_000, outputTokens: 4_000 } as const;

const TOKENS_PER_MILLION = 1_000_000;

/** What the example task would cost on a model, or null when its price is unknown. */
export function estimateExampleCostUsd(model: string): number | null {
  const price = MODEL_PRICES_USD_PER_MILLION[model];
  if (!price) return null;
  return (
    (EXAMPLE_TASK.inputTokens * price.input + EXAMPLE_TASK.outputTokens * price.output) /
    TOKENS_PER_MILLION
  );
}

export type CostEstimate =
  { kind: 'free' } | { kind: 'under_cent' } | { kind: 'about'; usd: number } | { kind: 'unknown' };

/** The estimate as something a sentence can be built from, rounded to cents. */
export function describeExampleCost(model: string): CostEstimate {
  const usd = estimateExampleCostUsd(model);
  if (usd === null) return { kind: 'unknown' };
  if (usd === 0) return { kind: 'free' };
  if (usd < 0.01) return { kind: 'under_cent' };
  return { kind: 'about', usd: Math.round(usd * 100) / 100 };
}

export function formatUsd(usd: number, localeTag = 'en-US'): string {
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

/** The model as a person would name it: without the routing prefix. */
export function displayModelName(model: string): string {
  return model.replace(/^openrouter\//, '');
}

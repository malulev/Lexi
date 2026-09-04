import { describe, expect, it } from 'vitest';

import {
  describeExampleCost,
  displayModelName,
  estimateExampleCostUsd,
  EXAMPLE_TASK,
  formatUsd,
  MODEL_PRICES_USD_PER_MILLION,
} from '@/lib/cost';
import { DEFAULT_TIER_MODELS, MODEL_TIERS } from '@/lib/models';

/**
 * The estimate shown beside a tier in advanced mode: one small example task,
 * priced per model from a table that is verified by hand, so a client can see
 * roughly what "Expert" costs before choosing it. Never a promise — the real
 * cost is whatever the record reports afterwards.
 */

describe('the price table', () => {
  it('prices every built-in tier model, so no tier shows "no estimate" out of the box', () => {
    for (const tier of MODEL_TIERS) {
      expect(MODEL_PRICES_USD_PER_MILLION[DEFAULT_TIER_MODELS[tier]], tier).toBeDefined();
    }
  });
});

describe('estimateExampleCostUsd', () => {
  it('prices the example task at input plus output tokens', () => {
    expect(EXAMPLE_TASK).toEqual({ inputTokens: 80_000, outputTokens: 4_000 });
    expect(estimateExampleCostUsd(DEFAULT_TIER_MODELS.medium)).toBeCloseTo(0.2, 5);
    expect(estimateExampleCostUsd(DEFAULT_TIER_MODELS.high)).toBeCloseTo(0.5, 5);
    expect(estimateExampleCostUsd(DEFAULT_TIER_MODELS.extra)).toBeCloseTo(1.0, 5);
  });

  it('is null for a model the table does not know', () => {
    expect(estimateExampleCostUsd('openrouter/acme/house-model')).toBeNull();
  });
});

describe('describeExampleCost', () => {
  it('says free for a free model', () => {
    expect(describeExampleCost(DEFAULT_TIER_MODELS.free)).toEqual({ kind: 'free' });
  });

  it('says under a cent rather than $0.00 for the cheapest paid model', () => {
    expect(describeExampleCost(DEFAULT_TIER_MODELS.low)).toEqual({ kind: 'under_cent' });
  });

  it('rounds an ordinary estimate to cents', () => {
    expect(describeExampleCost(DEFAULT_TIER_MODELS.medium)).toEqual({ kind: 'about', usd: 0.2 });
    expect(describeExampleCost(DEFAULT_TIER_MODELS.extra)).toEqual({ kind: 'about', usd: 1 });
  });

  it('admits it has no estimate for an overridden model', () => {
    expect(describeExampleCost('openrouter/acme/house-model')).toEqual({ kind: 'unknown' });
  });
});

describe('formatUsd', () => {
  it('reads as plain dollars by default', () => {
    expect(formatUsd(0.2)).toBe('$0.20');
    expect(formatUsd(1)).toBe('$1.00');
  });

  it('follows the language it is given', () => {
    expect(formatUsd(0.2, 'fr-FR')).toContain('0,20');
  });
});

describe('displayModelName', () => {
  it('drops the routing prefix and nothing else', () => {
    expect(displayModelName('openrouter/anthropic/claude-sonnet-5')).toBe(
      'anthropic/claude-sonnet-5',
    );
    expect(displayModelName('anthropic/claude-sonnet-5')).toBe('anthropic/claude-sonnet-5');
    expect(displayModelName('openrouter/cohere/north-mini-code:free')).toBe(
      'cohere/north-mini-code:free',
    );
  });
});

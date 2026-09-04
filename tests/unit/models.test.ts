import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIER_MODELS,
  tierOfModel,
  isModelTier,
  MODEL_TIER_LABELS,
  MODEL_TIERS,
  resolveModel,
  selectDefaultTier,
  tierModels,
} from '@/lib/models';
import type { Settings } from '@/types';

/**
 * A client picks how much to spend, not which model. The tiers are a closed,
 * ordered vocabulary of five, each mapped to one `provider/model` the
 * developer may override from `.webagent/config.yml`.
 */

const SETTINGS: Settings = {
  alertContact: 'dev@agency.example',
  costCeilingUsd: 2,
  model: 'openrouter/anthropic/claude-sonnet-5',
  maxRequestMinutes: 10,
};

describe('the tier vocabulary', () => {
  it('is exactly five tiers, cheapest first', () => {
    expect(MODEL_TIERS).toEqual(['free', 'low', 'medium', 'high', 'extra']);
  });

  it('runs exactly these models by default, so a silent re-point fails here first', () => {
    expect(DEFAULT_TIER_MODELS).toEqual({
      free: 'openrouter/cohere/north-mini-code:free',
      low: 'openrouter/deepseek/deepseek-v4-flash-0731',
      medium: 'openrouter/anthropic/claude-sonnet-5',
      high: 'openrouter/anthropic/claude-opus-5',
      extra: 'openrouter/anthropic/claude-fable-5.1',
    });
  });

  it('gives every tier a default model in provider/model shape', () => {
    for (const tier of MODEL_TIERS) {
      expect(DEFAULT_TIER_MODELS[tier], tier).toMatch(/^[^\s/]+(\/[^\s/]+)+$/);
    }
  });

  it('gives every tier a label and a cost hint a non-technical person can read', () => {
    for (const tier of MODEL_TIERS) {
      const label = MODEL_TIER_LABELS[tier];
      expect(label.name, tier).toBeTruthy();
      expect(label.cost, tier).toBeTruthy();
      expect(label.name, tier).not.toMatch(/claude|gpt|cohere|openrouter|anthropic/i);
    }
  });

  it('recognises a tier name and nothing else', () => {
    expect(isModelTier('medium')).toBe(true);
    expect(isModelTier('ultra')).toBe(false);
    expect(isModelTier(undefined)).toBe(false);
    expect(isModelTier(3)).toBe(false);
  });
});

describe('resolveModel', () => {
  it('uses the built-in model for a tier the repository does not override', () => {
    expect(resolveModel(SETTINGS, 'high')).toBe(DEFAULT_TIER_MODELS.high);
  });

  it('prefers the repository override for a tier', () => {
    const settings = { ...SETTINGS, models: { high: 'openrouter/acme/house-model' } };
    expect(resolveModel(settings, 'high')).toBe('openrouter/acme/house-model');
    expect(resolveModel(settings, 'low')).toBe(DEFAULT_TIER_MODELS.low);
  });

  it('falls back to the repository’s own `model` when no tier was chosen', () => {
    expect(resolveModel(SETTINGS, undefined)).toBe(SETTINGS.model);
  });
});

describe('selectDefaultTier', () => {
  it('is the tier whose model the repository already names, so the picker opens on what runs today', () => {
    expect(selectDefaultTier(SETTINGS)).toBe('medium');
    expect(selectDefaultTier({ ...SETTINGS, model: DEFAULT_TIER_MODELS.free })).toBe('free');
  });

  it('honours an override that makes some other tier match the repository model', () => {
    const settings = {
      ...SETTINGS,
      model: 'openrouter/acme/house-model',
      models: { high: 'openrouter/acme/house-model' },
    };
    expect(selectDefaultTier(settings)).toBe('high');
  });

  it('is medium when the repository names a model no tier maps to', () => {
    expect(selectDefaultTier({ ...SETTINGS, model: 'openrouter/acme/other' })).toBe('medium');
  });
});

describe('tierModels', () => {
  it('lists every tier with the model that would actually run, for the configuration page', () => {
    const rows = tierModels({ ...SETTINGS, models: { free: 'openrouter/acme/free' } });
    expect(rows.map((row) => row.tier)).toEqual(MODEL_TIERS);
    expect(rows[0]).toEqual({ tier: 'free', model: 'openrouter/acme/free', overridden: true });
    expect(rows[1]).toEqual({ tier: 'low', model: DEFAULT_TIER_MODELS.low, overridden: false });
  });
});

describe('tierOfModel', () => {
  it('finds the tier behind a model in the table in force, and nothing for a model outside it', () => {
    expect(tierOfModel(DEFAULT_TIER_MODELS, DEFAULT_TIER_MODELS.high)).toBe('high');
    expect(
      tierOfModel(
        { ...DEFAULT_TIER_MODELS, low: 'openrouter/acme/house' },
        'openrouter/acme/house',
      ),
    ).toBe('low');
    expect(tierOfModel(DEFAULT_TIER_MODELS, 'openrouter/acme/other')).toBeNull();
    expect(tierOfModel(DEFAULT_TIER_MODELS, undefined)).toBeNull();
  });
});

describe('defaultTierOf', () => {
  it('is the settings’ default tier when settings have loaded, and medium when nothing has', async () => {
    const { defaultTierOf } = await import('@/lib/models');
    expect(defaultTierOf(SETTINGS)).toBe('medium');
    expect(defaultTierOf({ ...SETTINGS, model: DEFAULT_TIER_MODELS.extra })).toBe('extra');
    expect(defaultTierOf(null)).toBe('medium');
    expect(defaultTierOf(undefined)).toBe('medium');
  });
});

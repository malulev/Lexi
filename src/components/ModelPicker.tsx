'use client';

import { useId } from 'react';

import { useAdvancedMode } from './advanced-mode';
import { useTranslation } from './LocaleProvider';
import { describeExampleCost, displayModelName, type CostEstimate } from '@/lib/cost';
import { formatMessage, type Dictionary } from '@/lib/i18n';
import { DEFAULT_TIER_MODELS, MODEL_TIERS } from '@/lib/models';
import type { ModelTier } from '@/types';

/**
 * How much to spend on this change, as five plain choices.
 *
 * A radio group rather than a select: every option is visible at once with
 * its cost hint beside it, which is the whole point of offering tiers instead
 * of a model list. No model name appears here by default; a client is
 * choosing between "Free" and "Expert", not between two vendors' slugs.
 *
 * "Show details" is the exception, and it is opt-in: a person who wants to
 * know what runs sees each tier's model and, in a tooltip, what a small
 * example task — replacing a logo — would roughly cost with it. The choice
 * is remembered per browser, so it need not be pressed twice.
 */
interface ModelPickerProps {
  value: ModelTier;
  onChange: (tier: ModelTier) => void;
  disabled?: boolean;
  /** Distinguishes several pickers on one page, for the radio group's name. */
  name?: string;
  /** The model each tier actually runs on this installation; the built-in defaults otherwise. */
  models?: Record<ModelTier, string>;
}

/** The example-task estimate as words, in the page's language, with money formatted by `money`. */
export function describeCostEstimate(
  estimate: CostEstimate,
  t: Dictionary,
  money: (usd: number) => string,
): string {
  switch (estimate.kind) {
    case 'free':
      return t.composer.exampleFree;
    case 'under_cent':
      return t.composer.exampleUnderCent;
    case 'about':
      return formatMessage(t.composer.exampleAbout, { cost: money(estimate.usd) });
    default:
      return t.composer.exampleUnknown;
  }
}

export function ModelPicker({
  value,
  onChange,
  disabled = false,
  name = 'model-tier',
  models = DEFAULT_TIER_MODELS,
}: ModelPickerProps) {
  const { t, money } = useTranslation();
  const [advanced, setAdvanced] = useAdvancedMode();
  const tipBase = useId();
  const current = t.tiers[value];

  return (
    <fieldset className={`tiers${advanced ? ' tiers--advanced' : ''}`} disabled={disabled}>
      <legend className="tiers__legend">
        {t.composer.effort} <span className="tiers__hint">{current.hint}</span>
      </legend>
      <div className="tiers__row" role="radiogroup" aria-label={t.composer.spendAria}>
        {MODEL_TIERS.map((tier) => {
          const label = t.tiers[tier];
          const selected = tier === value;
          const model = displayModelName(models[tier]);
          const tipId = `${tipBase}-${tier}`;
          const estimate = describeCostEstimate(describeExampleCost(models[tier]), t, money);
          return (
            <label
              key={tier}
              className={`tiers__option${selected ? ' tiers__option--selected' : ''}`}
              title={advanced ? undefined : `${label.cost}. ${label.hint}`}
            >
              <input
                type="radio"
                className="tiers__input"
                name={name}
                value={tier}
                checked={selected}
                onChange={() => onChange(tier)}
                aria-describedby={advanced ? tipId : undefined}
              />
              <span className="tiers__name">{label.name}</span>
              <span className="tiers__cost">{label.cost}</span>
              {advanced ? (
                <>
                  <span className="tiers__model">{model}</span>
                  <span className="tiers__tip" role="tooltip" id={tipId}>
                    <span className="tiers__tip-model">
                      {formatMessage(t.composer.modelLabel, { model })}
                    </span>
                    <span className="tiers__tip-cost">
                      {t.composer.exampleTask}: {estimate}
                    </span>
                  </span>
                </>
              ) : null}
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className="tiers__details"
        aria-pressed={advanced}
        onClick={() => setAdvanced(!advanced)}
      >
        {advanced ? t.composer.hideDetails : t.composer.showDetails}
      </button>
    </fieldset>
  );
}

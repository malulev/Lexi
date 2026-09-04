'use client';

import type { ReactNode } from 'react';

import { useTranslation } from './LocaleProvider';
import type { Dictionary } from '@/lib/i18n';
import { en } from '@/lib/i18n/en';
import type { RequestKind, Stage } from '@/types';

/**
 * The stage vocabulary, translated once.
 *
 * Constitution Principle I: the client never reads the words `starting`,
 * `gating`, `pushing`, and so on — those are the job state machine's internal
 * names (src/types/index.ts `Stage`) and read as engineering jargon to a
 * marketing manager. This module is the one place that translation happens.
 * `Record<Stage, string>` makes each mapping exhaustive at compile time — a
 * `Stage` added without a label here fails to build, the same guarantee
 * `CLIENT_MESSAGES` (src/lib/jobs/messages.ts) gives the error vocabulary —
 * and `tests/unit/components/progress-trail.test.tsx` audits the result the
 * same way `tests/unit/messages.test.ts` audits that one.
 *
 * A stage means something different depending on what the request is for.
 * `pushing` is "saving your change" while a change is being made and
 * "publishing your change" while it is going live; the same word on the wire,
 * two honest sentences on the screen. So there is one table per request kind.
 * The English tables are the dictionary's (src/lib/i18n/en.ts); every other
 * language fills the same shape, and the component reads the page's.
 */
export const STAGE_LABELS: Record<Stage, string> = en.stages.change;
export const PUBLISH_STAGE_LABELS: Record<Stage, string> = en.stages.publish;
export const UNDO_STAGE_LABELS: Record<Stage, string> = en.stages.undo;

export const STAGE_LABELS_BY_KIND: Record<RequestKind, Record<Stage, string>> = en.stages;

/** What the trail is a trail of, for its accessible name and its heading. */
export const REQUEST_KIND_TITLES: Record<RequestKind, string> = en.trailTitles;

export function describeStage(
  stage: Stage,
  kind: RequestKind = 'change',
  t: Dictionary = en,
): string {
  return t.stages[kind][stage];
}

/** The order a change request moves through when nothing goes wrong. */
export const HAPPY_PATH_STAGES: Stage[] = [
  'starting',
  'running',
  'gating',
  'pushing',
  'building',
  'succeeded',
];

/**
 * Publishing and undoing run no agent and gate nothing, so those steps are
 * absent rather than shown as instantly done (src/lib/jobs/publication.ts).
 */
export const PUBLICATION_PATH_STAGES: Stage[] = [
  'starting',
  'gating',
  'pushing',
  'building',
  'succeeded',
];

export const HAPPY_PATH_BY_KIND: Record<RequestKind, Stage[]> = {
  change: HAPPY_PATH_STAGES,
  publish: PUBLICATION_PATH_STAGES,
  undo: PUBLICATION_PATH_STAGES,
};

export function isSetbackStage(stage: Stage): boolean {
  return stage === 'blocked' || stage === 'failed' || stage === 'abandoned';
}

/** `succeeded` and every setback end the request; nothing earlier does. */
export function isTerminalStage(stage: Stage): boolean {
  return stage === 'succeeded' || isSetbackStage(stage);
}

export type TrailStepStatus = 'done' | 'current' | 'pending';

export interface TrailStep {
  stage: Stage;
  label: string;
  status: TrailStepStatus;
}

/**
 * Turns the stages observed so far into a row of steps for display.
 *
 * On the happy path this marks everything up to the latest stage `done` and
 * the latest one `current`, with the rest still `pending`. A setback does
 * not continue that path — it is honest instead: the steps genuinely
 * completed stay `done`, and the setback itself is the final, `current`
 * step, without implying the request quietly kept moving through the
 * remaining happy-path stages it never reached.
 */
export function buildTrailSteps(
  stageHistory: Stage[],
  kind: RequestKind = 'change',
  t: Dictionary = en,
): TrailStep[] {
  if (stageHistory.length === 0) return [];

  const path = HAPPY_PATH_BY_KIND[kind];
  const latest = stageHistory[stageHistory.length - 1] as Stage;

  if (isSetbackStage(latest)) {
    const completedHappyStages = path.filter(
      (stage) => stage !== 'succeeded' && stageHistory.includes(stage),
    );
    return [
      ...completedHappyStages.map((stage) => ({
        stage,
        label: describeStage(stage, kind, t),
        status: 'done' as const,
      })),
      { stage: latest, label: describeStage(latest, kind, t), status: 'current' as const },
    ];
  }

  const latestIndex = path.indexOf(latest);
  if (latestIndex === -1) {
    // An off-path stage (`queued`): the steps genuinely reached stay done, the
    // wait itself is current, and the rest of the path is still ahead.
    return [
      ...path
        .filter((stage) => stage !== 'succeeded' && stageHistory.includes(stage))
        .map((stage) => ({ stage, label: describeStage(stage, kind, t), status: 'done' as const })),
      { stage: latest, label: describeStage(latest, kind, t), status: 'current' as const },
      ...path
        .filter((stage) => !stageHistory.includes(stage))
        .map((stage) => ({
          stage,
          label: describeStage(stage, kind, t),
          status: 'pending' as const,
        })),
    ];
  }

  // Reaching the end implies the whole path was walked, even when the record
  // only wrote the ending — a publish record carries its one terminal stage.
  return path.map((stage, index) => ({
    stage,
    label: describeStage(stage, kind, t),
    status:
      stage === latest
        ? ('current' as const)
        : stageHistory.includes(stage) || (latest === 'succeeded' && index < latestIndex)
          ? ('done' as const)
          : ('pending' as const),
  }));
}

interface ProgressTrailProps {
  stageHistory: Stage[];
  kind?: RequestKind;
  /** Whether the request is still moving, so the current step can breathe. */
  active?: boolean;
  /** Shown beneath the line while the request runs — the working indicator. */
  children?: ReactNode;
}

/** Live progress for a conversation view. Renders nothing until a request has started. */
export function ProgressTrail({
  stageHistory,
  kind = 'change',
  active = false,
  children,
}: ProgressTrailProps) {
  const { t } = useTranslation();
  const steps = buildTrailSteps(stageHistory, kind, t);
  if (steps.length === 0) return null;

  const latest = steps.find((step) => step.status === 'current');
  const settled = latest ? isTerminalStage(latest.stage) : false;

  return (
    <section
      className={`trail trail--${kind}${active && !settled ? ' trail--active' : ''}${
        latest && isSetbackStage(latest.stage) ? ' trail--setback' : ''
      }${settled && latest?.stage === 'succeeded' ? ' trail--settled' : ''}`}
      aria-live="polite"
    >
      <p className="trail__now">
        <span className="trail__now-label">{latest?.label}</span>
      </p>
      <ol className="stage-trail" aria-label={t.trailTitles[kind]}>
        {steps.map((step) => (
          <li
            key={step.stage}
            className={`stage-trail__step stage-trail__step--${step.status}${
              isSetbackStage(step.stage) ? ' stage-trail__step--setback' : ''
            }`}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className="stage-trail__dot" aria-hidden="true" />
            <span className="stage-trail__label">{step.label}</span>
          </li>
        ))}
      </ol>
      {children}
    </section>
  );
}

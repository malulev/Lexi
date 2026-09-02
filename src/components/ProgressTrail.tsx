'use client';

import type { Stage } from '@/types';

/**
 * The stage vocabulary, translated once.
 *
 * Constitution Principle I: the client never reads the words `starting`,
 * `gating`, `pushing`, and so on — those are the job state machine's internal
 * names (src/types/index.ts `Stage`) and read as engineering jargon to a
 * marketing manager. This table is the one place that translation happens.
 * `Record<Stage, string>` makes the mapping exhaustive at compile time — a
 * `Stage` added without a label here fails to build, the same guarantee
 * `CLIENT_MESSAGES` (src/lib/jobs/messages.ts) gives the error vocabulary —
 * and `tests/unit/components/progress-trail.test.tsx` audits the result the
 * same way `tests/unit/messages.test.ts` audits that one.
 */
export const STAGE_LABELS: Record<Stage, string> = {
  starting: 'Getting started',
  running: 'Making the change',
  gating: "Checking it's allowed",
  pushing: 'Saving your change',
  building: 'Building your preview',
  succeeded: 'Ready to look at',
  blocked: 'Stopped — not allowed',
  failed: 'Something went wrong',
  abandoned: 'Stopped without finishing',
};

export function describeStage(stage: Stage): string {
  return STAGE_LABELS[stage];
}

/** The order a request moves through when nothing goes wrong. */
export const HAPPY_PATH_STAGES: Stage[] = [
  'starting',
  'running',
  'gating',
  'pushing',
  'building',
  'succeeded',
];

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
export function buildTrailSteps(stageHistory: Stage[]): TrailStep[] {
  if (stageHistory.length === 0) return [];

  const latest = stageHistory[stageHistory.length - 1] as Stage;

  if (isSetbackStage(latest)) {
    const completedHappyStages = HAPPY_PATH_STAGES.filter(
      (stage) => stage !== 'succeeded' && stageHistory.includes(stage),
    );
    return [
      ...completedHappyStages.map((stage) => ({
        stage,
        label: describeStage(stage),
        status: 'done' as const,
      })),
      { stage: latest, label: describeStage(latest), status: 'current' as const },
    ];
  }

  return HAPPY_PATH_STAGES.map((stage) => ({
    stage,
    label: describeStage(stage),
    status:
      stage === latest ? ('current' as const) : stageHistory.includes(stage) ? ('done' as const) : ('pending' as const),
  }));
}

interface ProgressTrailProps {
  stageHistory: Stage[];
}

/** Live progress for a conversation view. Renders nothing until a request has started. */
export function ProgressTrail({ stageHistory }: ProgressTrailProps) {
  const steps = buildTrailSteps(stageHistory);
  if (steps.length === 0) return null;

  return (
    <ol className="stage-trail" aria-label="Progress on this request">
      {steps.map((step) => (
        <li
          key={step.stage}
          className={`stage-trail__step stage-trail__step--${step.status}${
            isSetbackStage(step.stage) ? ' stage-trail__step--setback' : ''
          }`}
        >
          <span className="stage-trail__dot" aria-hidden="true" />
          <span className="stage-trail__label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

import { describe, expect, it } from 'vitest';
import {
  STAGE_LABELS,
  HAPPY_PATH_STAGES,
  describeStage,
  isSetbackStage,
  isTerminalStage,
  buildTrailSteps,
} from '@/components/ProgressTrail';
import type { Stage } from '@/types';

/**
 * Constitution Principle I, applied to the progress stream: the client reads
 * `Stage` values off the wire (`starting`, `gating`, `pushing`, ...) but must
 * never render them. This is the same guarantee `tests/unit/messages.test.ts`
 * asserts over the error vocabulary, applied to the stage vocabulary, kept in
 * exactly one place (`STAGE_LABELS`) so a new `Stage` added without a label
 * fails to type-check before it ever reaches this test.
 */
describe('the stage-to-language vocabulary', () => {
  const entries = Object.entries(STAGE_LABELS) as Array<[Stage, string]>;

  it('covers every stage with a non-empty label', () => {
    for (const [stage, label] of entries) {
      expect(describeStage(stage), stage).toBe(label);
      expect(label.length, stage).toBeGreaterThan(0);
    }
  });

  it('never renders the bare stage word as the whole label', () => {
    // A label may legitimately contain an ordinary English word that happens
    // to overlap a stage name (`building` describes what is happening in
    // plain English); what it must never do is stand in for the stage name
    // untranslated.
    for (const [stage, label] of entries) {
      expect(label.toLowerCase(), stage).not.toBe(stage);
    }
  });

  it('uses no git or build vocabulary', () => {
    const forbidden =
      /\b(commit|branch|merge|rebase|diff|repository|repo|pull request|PR|push(?:ed|ing)?|SHA|stack trace|exception|npm|webpack|stderr|exit code|container|docker)\b/i;
    for (const [stage, label] of entries) {
      expect(label, stage).not.toMatch(forbidden);
    }
  });

  it('names no file path or extension', () => {
    for (const [stage, label] of entries) {
      expect(label, stage).not.toMatch(/\.(ts|tsx|js|jsx|json|yml|yaml|md|css)\b/);
      expect(label, stage).not.toMatch(/(^|\s)[\w.-]*\//);
    }
  });

  it('reads as a short, capitalised phrase', () => {
    for (const [stage, label] of entries) {
      expect(label.length, stage).toBeLessThan(40);
      expect(label[0], stage).toEqual(label[0]?.toUpperCase());
    }
  });
});

describe('buildTrailSteps', () => {
  it('renders nothing before any stage has been observed', () => {
    expect(buildTrailSteps([])).toEqual([]);
  });

  it('marks earlier happy-path stages done and the latest one current', () => {
    const steps = buildTrailSteps(['starting', 'running']);
    const byStage = Object.fromEntries(steps.map((s) => [s.stage, s.status]));
    expect(byStage.starting).toBe('done');
    expect(byStage.running).toBe('current');
    expect(byStage.succeeded).toBe('pending');
  });

  it('stops the happy path at a setback instead of implying progress continued', () => {
    const steps = buildTrailSteps(['starting', 'running', 'gating', 'blocked']);
    expect(steps.map((s) => s.stage)).toEqual(['starting', 'running', 'gating', 'blocked']);
    expect(steps[steps.length - 1]).toMatchObject({ stage: 'blocked', status: 'current' });
    // The happy path's remaining steps (pushing, building, succeeded) never appear —
    // a setback is not rendered as if the trail simply paused partway through them.
    expect(steps.some((s) => s.stage === 'building')).toBe(false);
  });

  it('shows the full happy path as done once the request succeeds', () => {
    const steps = buildTrailSteps(['starting', 'running', 'gating', 'pushing', 'building', 'succeeded']);
    expect(steps.every((s) => s.status === 'done' || s.stage === 'succeeded')).toBe(true);
    expect(steps[steps.length - 1]).toMatchObject({ stage: 'succeeded', status: 'current' });
  });
});

describe('stage classification', () => {
  it('treats blocked, failed, and abandoned as setbacks, and nothing else', () => {
    const setbacks: Stage[] = ['blocked', 'failed', 'abandoned'];
    const others: Stage[] = HAPPY_PATH_STAGES;
    for (const stage of setbacks) expect(isSetbackStage(stage), stage).toBe(true);
    for (const stage of others) {
      if (stage === 'succeeded') continue;
      expect(isSetbackStage(stage), stage).toBe(false);
    }
  });

  it('treats succeeded and every setback as terminal, and nothing earlier', () => {
    expect(isTerminalStage('succeeded')).toBe(true);
    expect(isTerminalStage('blocked')).toBe(true);
    expect(isTerminalStage('failed')).toBe(true);
    expect(isTerminalStage('abandoned')).toBe(true);
    expect(isTerminalStage('starting')).toBe(false);
    expect(isTerminalStage('running')).toBe(false);
    expect(isTerminalStage('gating')).toBe(false);
    expect(isTerminalStage('pushing')).toBe(false);
    expect(isTerminalStage('building')).toBe(false);
  });
});

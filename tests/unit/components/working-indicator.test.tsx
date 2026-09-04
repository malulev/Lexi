import { describe, expect, it } from 'vitest';

import { formatElapsed, pickLine, USUAL_DURATION, WORKING_LINES } from '@/components/WorkingIndicator';
import type { RequestKind } from '@/types';

/**
 * The lines shown while a request runs are client-facing prose, so they are
 * held to Principle I exactly as the error vocabulary is.
 */
const KINDS = Object.keys(WORKING_LINES) as RequestKind[];
const LINES = KINDS.flatMap((kind) =>
  Object.values(WORKING_LINES[kind]).flatMap((lines) => [...(lines ?? [])]),
);

describe('what the product says while it works', () => {
  it('has something to say at every stage a request can be waiting in, for every kind', () => {
    for (const kind of KINDS) {
      for (const stage of ['starting', 'gating', 'pushing', 'building'] as const) {
        expect(pickLine(kind, stage, 0), `${kind}/${stage}`).toBeTruthy();
      }
    }
    expect(pickLine('change', 'running', 0)).toBeTruthy();
  });

  it('rotates through the lines rather than repeating one', () => {
    const seen = new Set([0, 1, 2, 3].map((tick) => pickLine('change', 'running', tick)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('has nothing to say once a request has ended', () => {
    expect(pickLine('change', 'succeeded', 0)).toBeNull();
    expect(pickLine('publish', 'failed', 0)).toBeNull();
  });

  it('names no path, file, or git and hosting vocabulary (Principle I)', () => {
    const forbidden =
      /\b(commit|branch|merge|rebase|diff|repository|repo|pull request|PR|push(?:ed|ing)?|SHA|deploy|netlify|github|docker|container|npm|webpack|stderr|exit code|token|prompt|model|agent)\b/i;
    for (const line of [...LINES, ...Object.values(USUAL_DURATION)]) {
      expect(line, line).not.toMatch(forbidden);
      expect(line, line).not.toMatch(/\.(ts|tsx|js|jsx|json|yml|yaml|md|css|html)\b/);
      expect(line, line).not.toMatch(/(^|\s)[\w.-]*\//);
    }
  });

  it('reads as a short, capitalised phrase', () => {
    for (const line of LINES) {
      expect(line.length, line).toBeLessThan(60);
      expect(line[0], line).toEqual(line[0]?.toUpperCase());
    }
  });
});

describe('formatElapsed', () => {
  it('reads like a stopwatch', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59_000)).toBe('0:59');
    expect(formatElapsed(61_000)).toBe('1:01');
    expect(formatElapsed(10 * 60_000 + 5_000)).toBe('10:05');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

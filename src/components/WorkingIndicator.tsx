'use client';

import { useEffect, useState } from 'react';

import { useTranslation } from './LocaleProvider';
import { en } from '@/lib/i18n/en';
import type { RequestKind, Stage } from '@/types';

/**
 * What the product says while it works.
 *
 * A request takes minutes, and a stage name alone leaves a person staring at
 * the same three words for most of them. These lines rotate under the stage
 * so the wait reads as company rather than silence. They are written in the
 * client's world — words, pages, the kettle — and never in ours: no file, no
 * path, no build log (Principle I). `tests/unit/components/working-indicator.test.tsx`
 * audits them the way the error vocabulary is audited. The English lines
 * are the dictionary's (src/lib/i18n/en.ts); each language has its own.
 */
export type WorkingLines = Record<RequestKind, Partial<Record<Stage, readonly string[]>>>;

export const WORKING_LINES: WorkingLines = en.working.lines;

/** How long a request usually takes, in the client's terms, so the wait has a shape. */
export const USUAL_DURATION: Record<RequestKind, string> = en.working.usual;

const ROTATE_EVERY_MS = 5_000;

export function pickLine(
  kind: RequestKind,
  stage: Stage,
  tick: number,
  lines: WorkingLines = WORKING_LINES,
): string | null {
  const candidates = lines[kind][stage];
  if (!candidates || candidates.length === 0) return null;
  return candidates[tick % candidates.length] ?? null;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface WorkingIndicatorProps {
  kind: RequestKind;
  stage: Stage;
  /** When the request began, for the elapsed clock. */
  startedAt: number | null;
  /** The last liveness pulse, if any. */
  lastActivityAt: number | null;
  /** `large` fills the preview pane; `compact` sits under the trail. */
  size?: 'large' | 'compact';
}

/** Rotating company for a wait, with a clock so the wait has a length. */
export function WorkingIndicator({
  kind,
  stage,
  startedAt,
  lastActivityAt,
  size = 'compact',
}: WorkingIndicatorProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const tick = Math.floor(now / ROTATE_EVERY_MS);
  const line = pickLine(kind, stage, tick, t.working.lines);
  const elapsed = startedAt ? formatElapsed(now - startedAt) : null;
  const heardRecently = lastActivityAt !== null && now - lastActivityAt < 15_000;

  return (
    <div className={`working working--${size}`} role="status" aria-live="polite">
      {size === 'large' ? <Scribble /> : null}
      <p className="working__line" key={line}>
        {line ?? t.working.fallback}
        <span className="working__ellipsis" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
      <p className="working__meta">
        {elapsed ? <span className="working__clock">{elapsed}</span> : null}
        <span>{t.working.usual[kind]}</span>
        {heardRecently ? <span className="working__pulse">{t.working.pulse}</span> : null}
      </p>
    </div>
  );
}

/** A page writing itself, line by line, over and over: the mark, in motion. */
function Scribble() {
  return (
    <svg className="scribble" viewBox="0 0 120 96" aria-hidden="true">
      <rect className="scribble__page" x="2" y="2" width="116" height="92" rx="12" />
      <path className="scribble__line" style={{ animationDelay: '0s' }} d="M22 26h76" />
      <path className="scribble__line" style={{ animationDelay: '0.45s' }} d="M22 42h58" />
      <path className="scribble__line" style={{ animationDelay: '0.9s' }} d="M22 58h68" />
      <path
        className="scribble__line scribble__line--tick"
        style={{ animationDelay: '1.35s' }}
        d="M22 76h20l8 8 18-18"
      />
    </svg>
  );
}

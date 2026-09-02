'use client';

import { useState } from 'react';

export type PreviewState =
  | { kind: 'none' }
  | { kind: 'building' }
  | { kind: 'ready'; url: string; updating: boolean }
  | { kind: 'failed'; message: string };

/**
 * Which of the four honest preview states to show (FR-022, FR-024).
 *
 * A preview URL, once it exists, always wins: a failed follow-up never
 * touches the public site or the last good preview (FR-024), so the pane
 * keeps showing that preview — with a quiet "updating" note while a new
 * attempt runs — rather than replacing it with a failure screen. Only a
 * conversation that has never produced a usable preview can show `building`
 * or `failed`, and "nothing yet" is its own calm state, not an error.
 */
export function selectPreviewState(input: {
  previewUrl?: string;
  requestInFlight: boolean;
  lastFailureMessage?: string;
}): PreviewState {
  if (input.previewUrl) {
    return { kind: 'ready', url: input.previewUrl, updating: input.requestInFlight };
  }
  if (input.requestInFlight) {
    return { kind: 'building' };
  }
  if (input.lastFailureMessage) {
    return { kind: 'failed', message: input.lastFailureMessage };
  }
  return { kind: 'none' };
}

export type PreviewWidth = 'desktop' | 'mobile';

/** `null` means "fill the available space" rather than a fixed pixel width. */
export const PREVIEW_WIDTH_PX: Record<PreviewWidth, number | null> = {
  desktop: null,
  mobile: 390,
};

interface PreviewPaneProps {
  previewUrl?: string;
  requestInFlight: boolean;
  lastFailureMessage?: string;
}

export function PreviewPane({ previewUrl, requestInFlight, lastFailureMessage }: PreviewPaneProps) {
  const [width, setWidth] = useState<PreviewWidth>('desktop');
  const state = selectPreviewState({ previewUrl, requestInFlight, lastFailureMessage });

  return (
    <section className="preview-pane" aria-label="Preview">
      <header className="preview-pane__toolbar">
        <span className="preview-pane__title">Preview</span>
        <div className="preview-pane__toggle" role="group" aria-label="Preview width">
          {(['desktop', 'mobile'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`preview-pane__toggle-btn${
                width === option ? ' preview-pane__toggle-btn--active' : ''
              }`}
              aria-pressed={width === option}
              onClick={() => setWidth(option)}
            >
              {option === 'desktop' ? 'Desktop' : 'Mobile'}
            </button>
          ))}
        </div>
      </header>
      <div className="preview-pane__body">
        {state.kind === 'ready' ? (
          <div
            className="preview-pane__frame-wrap"
            style={width === 'mobile' ? { width: PREVIEW_WIDTH_PX.mobile ?? undefined } : undefined}
          >
            {state.updating ? <p className="preview-pane__updating">Updating your preview…</p> : null}
            <iframe
              className="preview-pane__frame"
              src={state.url}
              title="Your website preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
        ) : null}
        {state.kind === 'building' ? (
          <div className="preview-pane__placeholder">
            <p>Building your preview…</p>
            <p className="preview-pane__hint">This usually takes a few minutes.</p>
          </div>
        ) : null}
        {state.kind === 'failed' ? (
          <div className="preview-pane__placeholder preview-pane__placeholder--setback">
            <p>{state.message}</p>
          </div>
        ) : null}
        {state.kind === 'none' ? (
          <div className="preview-pane__placeholder">
            <p>No preview yet.</p>
            <p className="preview-pane__hint">Describe a change below and it will appear here.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

'use client';

import { useState } from 'react';

import { useTranslation } from './LocaleProvider';
import { WorkingIndicator } from './WorkingIndicator';
import type { RequestKind, Stage } from '@/types';

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
  /** The client's own website, once a publish has reached it. */
  liveUrl?: string;
  /**
   * The framed page is the live website, not a private preview — true for an
   * undone conversation, whose branch preview would otherwise still show the
   * change the client just took back. It suppresses the "Private" tag, since
   * a public live site is not private.
   */
  liveMode?: boolean;
  /** What is being built right now, when it is not a preview. */
  updatingLabel?: string;
  /** The running request, so the empty pane can keep the client company. */
  working?: {
    kind: RequestKind;
    stage: Stage;
    startedAt: number | null;
    lastActivityAt: number | null;
  };
  /**
   * Changes whenever a new attempt has produced a preview. The preview's
   * address stays the same for the life of a conversation — every follow-up
   * rebuilds the same one — so without this the browser would keep showing
   * the build it loaded first.
   */
  version?: string;
}

export function PreviewPane({
  previewUrl,
  requestInFlight,
  lastFailureMessage,
  liveUrl,
  liveMode = false,
  updatingLabel,
  working,
  version = '',
}: PreviewPaneProps) {
  const { t } = useTranslation();
  const [width, setWidth] = useState<PreviewWidth>('desktop');
  const [reloads, setReloads] = useState(0);
  const state = selectPreviewState({ previewUrl, requestInFlight, lastFailureMessage });

  return (
    <section className="preview-pane" aria-label={t.preview.ariaLabel}>
      <header className="preview-pane__toolbar">
        <div className="preview-pane__lead">
          <span className="preview-pane__title">{t.preview.title}</span>
          {state.kind === 'ready' && !liveMode ? (
            <span
              className={`preview-pane__state${state.updating ? ' preview-pane__state--busy' : ''}`}
            >
              {state.updating ? (updatingLabel ?? t.preview.updating) : t.preview.private}
            </span>
          ) : null}
        </div>

        <div className="preview-pane__tools">
          <div className="preview-pane__toggle" role="group" aria-label={t.preview.widthAria}>
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
                {option === 'desktop' ? t.preview.desktop : t.preview.mobile}
              </button>
            ))}
          </div>

          {state.kind === 'ready' ? (
            <>
              <button
                type="button"
                className="preview-pane__reload"
                onClick={() => setReloads((count) => count + 1)}
                title={t.preview.reloadTitle}
              >
                <span aria-hidden="true">↻</span> {t.preview.reload}
              </button>
              <a
                className="preview-pane__link"
                href={state.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.preview.openNewTab} <span aria-hidden="true">↗</span>
              </a>
            </>
          ) : null}
          {liveUrl ? (
            <a
              className="preview-pane__link preview-pane__link--live"
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.preview.visitWebsite} <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>
      </header>

      <div className={`preview-pane__body preview-pane__body--${state.kind}`}>
        {state.kind === 'ready' ? (
          <div
            className={`preview-pane__frame-wrap preview-pane__frame-wrap--${width}`}
            style={width === 'mobile' ? { width: PREVIEW_WIDTH_PX.mobile ?? undefined } : undefined}
          >
            <iframe
              key={`${version}:${reloads}`}
              className="preview-pane__frame"
              src={state.url}
              title={t.preview.frameTitle}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
        ) : null}
        {state.kind === 'building' ? (
          <div className="preview-pane__placeholder preview-pane__placeholder--working">
            {working ? (
              <WorkingIndicator
                kind={working.kind}
                stage={working.stage}
                startedAt={working.startedAt}
                lastActivityAt={working.lastActivityAt}
                size="large"
              />
            ) : (
              <span className="preview-pane__pulse" aria-hidden="true" />
            )}
            <p className="preview-pane__placeholder-title">{t.preview.onItsWay}</p>
            <p className="preview-pane__hint">{t.preview.keepOpen}</p>
          </div>
        ) : null}
        {state.kind === 'failed' ? (
          <div className="preview-pane__placeholder preview-pane__placeholder--setback">
            <p className="preview-pane__placeholder-title">{t.preview.noPreview}</p>
            <p className="preview-pane__hint">{state.message}</p>
          </div>
        ) : null}
        {state.kind === 'none' ? (
          <div className="preview-pane__placeholder">
            <PreviewSketch />
            <p className="preview-pane__placeholder-title">{t.preview.willAppear}</p>
            <p className="preview-pane__hint">{t.preview.describeAndSee}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A quiet outline of a page, so an empty pane still says what it is for. */
function PreviewSketch() {
  return (
    <svg className="preview-pane__sketch" viewBox="0 0 160 110" aria-hidden="true">
      <rect x="1" y="1" width="158" height="108" rx="8" />
      <line x1="1" y1="20" x2="159" y2="20" />
      <circle cx="12" cy="10.5" r="2.5" />
      <circle cx="21" cy="10.5" r="2.5" />
      <circle cx="30" cy="10.5" r="2.5" />
      <rect x="22" y="38" width="70" height="8" rx="3" />
      <rect x="22" y="54" width="116" height="4" rx="2" />
      <rect x="22" y="64" width="96" height="4" rx="2" />
      <rect x="22" y="80" width="34" height="12" rx="4" />
    </svg>
  );
}

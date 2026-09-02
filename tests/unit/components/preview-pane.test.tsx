import { describe, expect, it } from 'vitest';
import { selectPreviewState, PREVIEW_WIDTH_PX } from '@/components/PreviewPane';

/**
 * FR-022 / FR-024: the preview pane's state is one of four honest
 * possibilities — nothing sent yet, building, ready, or a failure with no
 * usable preview at all. "No preview yet" is a calm, ordinary state here,
 * not an error dressed down; a `failed` attempt that still leaves an earlier
 * good preview standing (the public site, and the last-known preview, are
 * never touched by a failed attempt — FR-024) must keep showing that
 * preview rather than a failure screen.
 */
describe('selectPreviewState', () => {
  it('shows nothing-yet when no preview exists and nothing is running or has failed', () => {
    expect(selectPreviewState({ requestInFlight: false })).toEqual({ kind: 'none' });
  });

  it('shows building when a first request is running and there is no preview yet', () => {
    expect(selectPreviewState({ requestInFlight: true })).toEqual({ kind: 'building' });
  });

  it('shows the preview, not building, once a preview URL exists — even mid follow-up', () => {
    expect(
      selectPreviewState({ previewUrl: 'https://preview.example', requestInFlight: true }),
    ).toEqual({ kind: 'ready', url: 'https://preview.example', updating: true });
  });

  it('shows the preview as settled once nothing is running', () => {
    expect(
      selectPreviewState({ previewUrl: 'https://preview.example', requestInFlight: false }),
    ).toEqual({ kind: 'ready', url: 'https://preview.example', updating: false });
  });

  it('shows the failure only when there has never been a usable preview', () => {
    expect(
      selectPreviewState({ requestInFlight: false, lastFailureMessage: 'The change broke the site build.' }),
    ).toEqual({ kind: 'failed', message: 'The change broke the site build.' });
  });

  it('prefers an existing preview over a later failure message (FR-024: a failed attempt leaves it untouched)', () => {
    expect(
      selectPreviewState({
        previewUrl: 'https://preview.example',
        requestInFlight: false,
        lastFailureMessage: 'The change broke the site build.',
      }),
    ).toEqual({ kind: 'ready', url: 'https://preview.example', updating: false });
  });

  it('gives the mobile width a fixed frame and lets desktop fill the pane', () => {
    expect(PREVIEW_WIDTH_PX.mobile).toBeGreaterThan(0);
    expect(PREVIEW_WIDTH_PX.desktop).toBeNull();
  });
});

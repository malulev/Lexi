import { describe, expect, it } from 'vitest';

import { selectEffectivePreview } from '@/components/ConversationView';

/**
 * Which page the preview pane frames.
 *
 * A conversation's branch preview keeps the change on it for good, so undo —
 * which reverses the change on the live site, never on the branch — must not
 * leave the client looking at the very change they took back. Once undone, the
 * pane frames the live website (the reverted truth); every other state frames
 * the branch preview.
 */
describe('selectEffectivePreview', () => {
  it('frames the branch preview while the conversation is live', () => {
    expect(
      selectEffectivePreview({
        publishState: 'ready',
        conversationPreviewUrl: 'https://preview.example',
      }),
    ).toEqual({ url: 'https://preview.example', live: false });
  });

  it('prefers a fresher stream preview over the durable one', () => {
    expect(
      selectEffectivePreview({
        publishState: 'ready',
        streamPreviewUrl: 'https://newer.example',
        conversationPreviewUrl: 'https://older.example',
      }),
    ).toEqual({ url: 'https://newer.example', live: false });
  });

  it('keeps framing the branch preview after publishing, when the change is live and matches', () => {
    expect(
      selectEffectivePreview({
        publishState: 'published',
        conversationPreviewUrl: 'https://preview.example',
        liveSiteUrl: 'https://client.example',
      }),
    ).toEqual({ url: 'https://preview.example', live: false });
  });

  it('frames the live website once undone, not the branch preview that still holds the change', () => {
    expect(
      selectEffectivePreview({
        publishState: 'undone',
        conversationPreviewUrl: 'https://preview.example',
        liveSiteUrl: 'https://client.example',
      }),
    ).toEqual({ url: 'https://client.example', live: true });
  });

  it('reports live mode with no url when undone and the website address is unknown', () => {
    expect(
      selectEffectivePreview({
        publishState: 'undone',
        conversationPreviewUrl: 'https://preview.example',
      }),
    ).toEqual({ live: true });
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildPublicationRecord,
  publicationProse,
  selectPublishState,
} from '@/lib/conversations';
import type { Conversation, RequestRecord } from '@/types';

/**
 * What a conversation may do next is derived, never remembered (constitution
 * VII). Whether a change is publishable, published, or already taken back is
 * read back out of the pull request and its own records — which is what makes
 * a restart, a second browser tab, and a colleague's screen agree.
 */

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    number: 42,
    title: 'Shorten the headline',
    status: 'open',
    branch: 'webagent/c-42',
    headSha: 'abc123',
    updatedAt: '2026-09-02T10:34:19Z',
    ...overrides,
  };
}

function record(overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    requestId: 'r_1',
    startedAt: '2026-09-02T10:31:02Z',
    finishedAt: '2026-09-02T10:34:19Z',
    outcome: 'succeeded',
    stages: [{ stage: 'succeeded', at: '2026-09-02T10:34:19Z' }],
    previewUrl: 'https://deploy-preview-42--client.netlify.app',
    ...overrides,
  };
}

describe('selectPublishState', () => {
  it('offers nothing to publish until a request has succeeded (FR-027)', () => {
    expect(selectPublishState({ conversation: conversation(), records: [] })).toBe('not_previewed');
  });

  it('offers approval once a preview stands', () => {
    expect(selectPublishState({ conversation: conversation(), records: [record()] })).toBe('ready');
  });

  it('withdraws approval when the newest attempt failed to build (FR-027)', () => {
    const failed = record({
      outcome: 'failed',
      errorCode: 'build_failed',
      errorDetail: 'the build exited non-zero',
      previewUrl: undefined,
    });

    expect(selectPublishState({ conversation: conversation(), records: [record(), failed] })).toBe(
      'not_previewed',
    );
  });

  it('withdraws approval when the newest attempt was refused by the policy', () => {
    const blocked = record({
      outcome: 'blocked',
      violation: 'not_allowed_path',
      blockedPath: 'config/payments.json',
      previewUrl: undefined,
    });

    expect(selectPublishState({ conversation: conversation(), records: [blocked] })).toBe(
      'not_previewed',
    );
  });

  it('offers no approval on a published conversation, only the way back (FR-027)', () => {
    const published = {
      conversation: conversation({ status: 'published' }),
      records: [record(), buildPublicationRecord({ kind: 'publish', at: '2026-09-02T11:00:00Z' })],
    };

    expect(selectPublishState(published)).toBe('published');
  });

  it('offers nothing once a published change has been taken back', () => {
    const undone = {
      conversation: conversation({ status: 'published' }),
      records: [
        record(),
        buildPublicationRecord({ kind: 'publish', at: '2026-09-02T11:00:00Z' }),
        buildPublicationRecord({ kind: 'undo', at: '2026-09-02T11:20:00Z' }),
      ],
    };

    expect(selectPublishState(undone)).toBe('undone');
  });

  it('offers nothing on a conversation that was closed without publishing', () => {
    expect(
      selectPublishState({ conversation: conversation({ status: 'closed' }), records: [record()] }),
    ).toBe('unavailable');
  });
});

describe('publicationProse', () => {
  it('names who did it, because the conversation is the audit trail (FR-031)', () => {
    const prose = publicationProse({ kind: 'publish', actor: 'jane@client.example' });

    expect(prose).toContain('jane@client.example');
    expect(prose.toLowerCase()).toContain('published');
  });

  it('links the client to their own site when publishing (FR-028)', () => {
    const prose = publicationProse({
      kind: 'publish',
      actor: 'jane@client.example',
      liveUrl: 'https://client-site.example',
    });

    expect(prose).toContain('https://client-site.example');
  });

  it('says a change is on its way back out when undoing', () => {
    const prose = publicationProse({ kind: 'undo', actor: 'jane@client.example' });

    expect(prose.toLowerCase()).toContain('undone');
  });

  it('never reaches for the vocabulary of the thing underneath (Principle I)', () => {
    for (const kind of ['publish', 'undo'] as const) {
      const prose = publicationProse({
        kind,
        actor: 'jane@client.example',
        liveUrl: 'https://client-site.example',
      });
      expect(prose, kind).not.toMatch(/\b(commit|branch|merge|pull request|revert|diff|sha)\b/i);
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { RequestRecord } from '@/types';
import { hasNotified, parseComment, renderRecord, withNotified } from '@/lib/record';

/**
 * contracts/durable-record.md is the authority here: one comment carries
 * client-facing prose plus a `webagent:v1` block, parsing never throws, and
 * an unrecognised or broken block degrades to prose rather than losing the
 * comment.
 */

const baseRecord: RequestRecord = {
  requestId: 'r_01J000000000000000000000',
  startedAt: '2026-09-02T10:31:02Z',
  finishedAt: '2026-09-02T10:34:19Z',
  outcome: 'succeeded',
  stages: [
    { stage: 'running', at: '2026-09-02T10:31:04Z' },
    { stage: 'succeeded', at: '2026-09-02T10:34:19Z' },
  ],
  commitSha: 'a1b2c3d',
  filesChanged: 3,
  diffLines: 47,
  model: 'anthropic/claude-sonnet-latest',
  tokensIn: 48211,
  tokensOut: 3140,
  costUsd: 0.42,
  previewUrl: 'https://deploy-preview-42--client.netlify.app',
};

function comment(body: string, overrides: Partial<{ id: number; author: string; createdAt: string }> = {}) {
  return {
    id: overrides.id ?? 1,
    author: overrides.author ?? 'webagent-bot',
    body,
    createdAt: overrides.createdAt ?? '2026-09-02T10:34:20Z',
  };
}

describe('renderRecord then parseComment', () => {
  it('yields the original prose and a deeply equal record', () => {
    const prose = 'I made the headline shorter and changed the button to dark blue.';
    const rendered = renderRecord(prose, baseRecord);

    const parsed = parseComment(comment(rendered));

    expect(parsed.prose).toBe(prose);
    expect(parsed.record).toEqual(baseRecord);
  });

  it('carries the comment envelope fields through untouched', () => {
    const rendered = renderRecord('Done.', baseRecord);

    const parsed = parseComment(comment(rendered, { id: 42, author: 'someone', createdAt: '2026-09-02T10:00:00Z' }));

    expect(parsed.commentId).toBe(42);
    expect(parsed.author).toBe('someone');
    expect(parsed.createdAt).toBe('2026-09-02T10:00:00Z');
  });

  it('places the prose before a blank line before the block, per the contract format', () => {
    const rendered = renderRecord('Hello.', baseRecord);

    expect(rendered.startsWith('Hello.\n\n<!-- webagent:v1\n')).toBe(true);
    expect(rendered.endsWith('\n-->')).toBe(true);
  });

  it('never injects paths, diffs, or build logs into the prose (Principle I)', () => {
    const prose = 'Your preview is ready.';
    const rendered = renderRecord(prose, baseRecord);

    // The prose half of the rendered comment, i.e. everything before the block,
    // must be exactly what the caller supplied — nothing appended by us.
    const proseHalf = rendered.split('\n\n<!-- webagent:v1')[0];
    expect(proseHalf).toBe(prose);
  });
});

describe('parseComment on a comment with no marker', () => {
  it('parses the whole body as prose, with no record', () => {
    const body = "Looks good, thanks! Can you also make the footer smaller?";

    const parsed = parseComment(comment(body));

    expect(parsed.prose).toBe(body);
    expect(parsed.record).toBeUndefined();
  });

  it('treats an empty body as prose too', () => {
    const parsed = parseComment(comment(''));

    expect(parsed.prose).toBe('');
    expect(parsed.record).toBeUndefined();
  });
});

describe('parseComment degrades an unparseable block to prose rather than throwing', () => {
  it('does not throw on truncated JSON', () => {
    const body = 'Working on it.\n\n<!-- webagent:v1\n{ "requestId": "r_1", \n-->';

    expect(() => parseComment(comment(body))).not.toThrow();
    const parsed = parseComment(comment(body));
    expect(parsed.record).toBeUndefined();
    expect(parsed.prose).toBe(body);
  });

  it('does not throw when the block has no closing marker', () => {
    const body = 'Working on it.\n\n<!-- webagent:v1\n{"requestId": "r_1"}';

    const parsed = parseComment(comment(body));

    expect(parsed.record).toBeUndefined();
    expect(parsed.prose).toBe(body);
  });

  it('degrades when the JSON is well-formed but fails schema validation', () => {
    const body = renderRecord('Done.', baseRecord).replace('"outcome": "succeeded"', '"outcome": "sideways"');

    const parsed = parseComment(comment(body));

    expect(parsed.record).toBeUndefined();
    expect(parsed.prose).toBe(body);
  });

  it('requires violation and blockedPath when outcome is blocked', () => {
    const blocked: RequestRecord = {
      ...baseRecord,
      outcome: 'blocked',
      // violation/blockedPath deliberately omitted — this block claims an
      // outcome the schema says must carry more detail, so it is untrustworthy.
    };
    const body = renderRecord('Blocked.', blocked);

    const parsed = parseComment(comment(body));

    expect(parsed.record).toBeUndefined();
  });

  it('accepts a blocked outcome once violation and blockedPath are present', () => {
    const blocked: RequestRecord = {
      ...baseRecord,
      outcome: 'blocked',
      violation: 'denied_path',
      blockedPath: '.env.production',
    };
    const body = renderRecord('Blocked.', blocked);

    const parsed = parseComment(comment(body));

    expect(parsed.record).toEqual(blocked);
  });

  it('requires errorCode and errorDetail when outcome is failed', () => {
    const failed: RequestRecord = { ...baseRecord, outcome: 'failed' };
    const body = renderRecord('It failed.', failed);

    const parsed = parseComment(comment(body));

    expect(parsed.record).toBeUndefined();
  });

  it('ignores a marker version it does not recognise, so old conversations stay readable', () => {
    const body = renderRecord('Done.', baseRecord).replace('webagent:v1', 'webagent:v2');

    const parsed = parseComment(comment(body));

    // A v2 reader does not exist yet; a v1 reader must not misread a v2 block
    // as its own, so the whole comment is treated as unstructured prose.
    expect(parsed.record).toBeUndefined();
    expect(parsed.prose).toBe(body);
  });
});

describe('a marker embedded in the prose itself', () => {
  // The contract requires exactly one block per rendered comment, but parsing
  // must still be total over comments we did not render ourselves. We take
  // the *last* occurrence of the marker in the body as the record, because
  // that is structurally where renderRecord always places the real one —
  // anything earlier is, by construction, part of the prose that came before it.

  it('round-trips prose that itself contains the string "-->"', () => {
    const prose = 'Tip: an HTML comment ends with --> in case that helps.';
    const rendered = renderRecord(prose, baseRecord);

    const parsed = parseComment(comment(rendered));

    expect(parsed.prose).toBe(prose);
    expect(parsed.record).toEqual(baseRecord);
  });

  it('round-trips prose that itself contains a fake webagent:v1 marker', () => {
    const prose = 'Earlier someone pasted <!-- webagent:v1\n{"bogus": true}\n--> by mistake.';
    const rendered = renderRecord(prose, baseRecord);

    const parsed = parseComment(comment(rendered));

    expect(parsed.prose).toBe(prose);
    expect(parsed.record).toEqual(baseRecord);
  });
});

describe('hasNotified / withNotified (OD-004 idempotency)', () => {
  it('reports false when notified is absent', () => {
    expect(hasNotified(baseRecord, 'preview_ready')).toBe(false);
  });

  it('reports false when the event is not in the list, true when it is', () => {
    const record = { ...baseRecord, notified: ['published' as const] };

    expect(hasNotified(record, 'preview_ready')).toBe(false);
    expect(hasNotified(record, 'published')).toBe(true);
  });

  it('withNotified returns a new record that now reports the event as notified', () => {
    const before = { ...baseRecord };
    const after = withNotified(before, 'preview_ready');

    expect(hasNotified(before, 'preview_ready')).toBe(false);
    expect(hasNotified(after, 'preview_ready')).toBe(true);
    expect(after).not.toBe(before);
  });

  it('withNotified does not duplicate an event already recorded', () => {
    const once = withNotified(baseRecord, 'preview_ready');
    const twice = withNotified(once, 'preview_ready');

    expect(twice.notified).toEqual(['preview_ready']);
  });
});

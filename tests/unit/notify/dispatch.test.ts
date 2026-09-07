import { describe, expect, it } from 'vitest';
import { notificationEventFor } from '@/lib/http/start-request';
import type { Outcome, RequestRecord } from '@/types';

function recordWith(outcome: Outcome): RequestRecord {
  return {
    requestId: 'r1',
    startedAt: '2026-09-07T10:00:00.000Z',
    finishedAt: '2026-09-07T10:04:00.000Z',
    outcome,
    stages: [],
  };
}

describe('which outcomes are worth an email', () => {
  /**
   * A preview is not an event a client needs pulled out of their inbox for:
   * they are already looking at the conversation that produced it, and the
   * page shows the preview the moment it exists. The email that matters is
   * the one about the live website, which `notifyPublication` sends.
   */
  it('sends nothing when a preview becomes ready', () => {
    expect(notificationEventFor(recordWith('succeeded'))).toBeNull();
  });

  it('still announces a refusal, which the client did not ask for and cannot see coming', () => {
    expect(notificationEventFor(recordWith('blocked'))).toBe('request_blocked');
  });

  it('still announces a failure', () => {
    expect(notificationEventFor(recordWith('failed'))).toBe('request_failed');
  });

  it('says nothing about an abandoned request', () => {
    expect(notificationEventFor(recordWith('abandoned'))).toBeNull();
  });
});

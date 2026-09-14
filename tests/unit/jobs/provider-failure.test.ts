import { describe, expect, it } from 'vitest';

import { classifyHostingMessage, classifyModelFailure } from '@/lib/jobs/provider-failure';

/**
 * A provider's refusal is a fact the client can act on only when it is named.
 * These map what OpenRouter and Netlify say to the closed vocabulary, so a
 * quota is read as a quota rather than as "something went wrong".
 */
describe('classifyModelFailure', () => {
  it('reads a 429 as the daily allowance being used up', () => {
    expect(
      classifyModelFailure({
        statusCode: 429,
        message:
          'Rate limit exceeded: free-models-per-day. Add 5 credits to unlock 1000 free model requests per day',
      }),
    ).toBe('model_quota');
  });

  it('reads a 402 as the account being out of credit', () => {
    expect(classifyModelFailure({ statusCode: 402, message: 'Insufficient credits' })).toBe(
      'model_credit',
    );
  });

  it('reads an insufficient-credits message as credit whatever the status', () => {
    expect(
      classifyModelFailure({ statusCode: 400, message: 'This request requires more credits.' }),
    ).toBe('model_credit');
  });

  it('reads a rejected key, a missing model, or a provider outage as unavailable', () => {
    for (const statusCode of [401, 403, 404, 500, 502, 503]) {
      expect(classifyModelFailure({ statusCode, message: 'x' }), String(statusCode)).toBe(
        'model_unavailable',
      );
    }
  });

  it('leaves anything else to the generic ending', () => {
    expect(classifyModelFailure({ statusCode: 400, message: 'bad request' })).toBeUndefined();
    expect(classifyModelFailure(undefined)).toBeUndefined();
  });
});

describe('classifyHostingMessage', () => {
  it('reads a plan-limit message as the hosting being capped', () => {
    for (const message of [
      'Your team has exceeded its build minutes allowance for this billing period.',
      'Build credits exhausted',
      'Builds are paused: payment required',
      'This site has been suspended',
      'Deploy failed: quota exceeded',
    ]) {
      expect(classifyHostingMessage(message), message).toBe('hosting_limit');
    }
  });

  it('reads an ordinary build error as a build failure', () => {
    for (const message of [
      'Build script returned non-zero exit code: 2',
      'Failed during stage "building site": Module not found',
      undefined,
    ]) {
      expect(classifyHostingMessage(message), String(message)).toBe('build_failed');
    }
  });
});

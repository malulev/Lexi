import { describe, expect, it } from 'vitest';

import { clientAddress, createRateLimiter } from '@/lib/http/rate-limit';

/**
 * The sliding-window limiter behind the sign-in endpoint (F3): it caps how
 * many links an inbox or a source can request, so a permitted address cannot
 * be email-bombed and the installation's SMTP quota cannot be burned.
 */
describe('createRateLimiter', () => {
  it('allows up to the limit, then refuses within the window', () => {
    const now = 1_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 1_000, now: () => now });

    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
  });

  it('counts each key separately', () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });

    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('b')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
  });

  it('lets an attempt through again once the window has passed', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });

    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);

    now = 1_001; // past the window
    expect(limiter.allow('a')).toBe(true);
  });
});

describe('clientAddress', () => {
  it('takes the first hop of X-Forwarded-For', () => {
    const request = new Request('http://x/', {
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    });
    expect(clientAddress(request)).toBe('203.0.113.7');
  });

  it('falls back to X-Real-IP, then to a constant', () => {
    expect(
      clientAddress(new Request('http://x/', { headers: { 'x-real-ip': '198.51.100.4' } })),
    ).toBe('198.51.100.4');
    expect(clientAddress(new Request('http://x/'))).toBe('unknown');
  });
});

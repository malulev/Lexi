import { describe, expect, it } from 'vitest';
import { describeUpdatedAt } from '@/lib/time';

const NOW = Date.parse('2026-09-03T12:00:00Z');

describe('describeUpdatedAt', () => {
  it('speaks in minutes, hours and days before it reaches for a date', () => {
    expect(describeUpdatedAt('2026-09-03T11:59:40Z', NOW)).toBe('Updated just now');
    expect(describeUpdatedAt('2026-09-03T11:35:00Z', NOW)).toBe('Updated 25 min ago');
    expect(describeUpdatedAt('2026-09-03T11:00:00Z', NOW)).toBe('Updated 1 hour ago');
    expect(describeUpdatedAt('2026-09-03T04:00:00Z', NOW)).toBe('Updated 8 hours ago');
    expect(describeUpdatedAt('2026-09-01T12:00:00Z', NOW)).toBe('Updated 2 days ago');
  });

  it('gives a date once a week has passed', () => {
    expect(describeUpdatedAt('2026-08-10T12:00:00Z', NOW)).toBe('Updated 10 Aug');
    expect(describeUpdatedAt('2025-08-10T12:00:00Z', NOW)).toBe('Updated 10 Aug 2025');
  });

  it('says nothing about a timestamp it cannot read', () => {
    expect(describeUpdatedAt('not a date', NOW)).toBe('');
  });
});

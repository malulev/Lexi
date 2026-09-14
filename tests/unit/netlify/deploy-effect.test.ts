import { describe, expect, it } from 'vitest';

import { deployEffect } from '@/lib/netlify/webhook';
import type { Deploy } from '@/lib/netlify/types';

function erroredDeploy(errorMessage: string | undefined): Deploy {
  return {
    id: 'd1',
    state: 'error',
    context: 'deploy-preview',
    reviewId: 7,
    commitRef: 'abc',
    deployUrl: undefined,
    createdAt: '2026-09-14T00:00:00Z',
    errorMessage,
  } as unknown as Deploy;
}

describe('deployEffect on an errored deploy', () => {
  it('reads a plan-limit message as the hosting being capped, not as a broken build', () => {
    const effect = deployEffect(
      erroredDeploy('Your team has exceeded its build minutes allowance for this billing period.'),
    );
    expect(effect.kind).toBe('hosting_limit');
    expect(effect.kind === 'hosting_limit' && effect.detail).toContain('build minutes');
  });

  it('still reads a compile error as a broken build', () => {
    expect(deployEffect(erroredDeploy('Build script returned non-zero exit code: 2')).kind).toBe(
      'build_failed',
    );
    expect(deployEffect(erroredDeploy(undefined)).kind).toBe('build_failed');
  });
});

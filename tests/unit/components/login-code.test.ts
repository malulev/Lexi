import { describe, expect, it } from 'vitest';

import { nextAfterCode } from '@/app/login/code/outcome';

/**
 * The code page's one decision. An expired pending cookie must send the
 * client back to request a new link rather than let them keep typing codes
 * into a form that can no longer succeed.
 */
describe('nextAfterCode', () => {
  it('goes home on success', () => {
    expect(nextAfterCode(200, { status: 'ok' } as never)).toEqual({ kind: 'home' });
  });

  it('goes back to sign-in when the link behind the code has expired', () => {
    expect(nextAfterCode(401, { error: 'expired' })).toEqual({ kind: 'signIn' });
  });

  it('treats a wrong code, a rate limit and an unreadable body alike: try again here', () => {
    expect(nextAfterCode(401, { error: 'refused' })).toEqual({ kind: 'refused' });
    expect(nextAfterCode(500, null)).toEqual({ kind: 'refused' });
  });
});

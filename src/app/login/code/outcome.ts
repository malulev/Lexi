/**
 * What the code page does with the code route's answer, as pure state so the
 * decision is testable without a browser: a 200 goes home, an expired
 * pending cookie goes back to the start, anything else is a refusal shown
 * in place with the field cleared for another try.
 */
export type CodeOutcome = { kind: 'home' } | { kind: 'signIn' } | { kind: 'refused' };

export function nextAfterCode(status: number, body: { error?: string } | null): CodeOutcome {
  if (status >= 200 && status < 300) return { kind: 'home' };
  if (body?.error === 'expired') return { kind: 'signIn' };
  return { kind: 'refused' };
}

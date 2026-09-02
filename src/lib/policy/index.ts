/**
 * Public surface of the policy module: deciding whether a change set may be
 * committed (`gate`), and turning `.webagent/policy.yml` into the `Policy`
 * that decision runs against (`parsePolicy` and its defaults).
 */

export { gate } from './gate';
export { DEFAULT_POLICY, UNCONDITIONAL_DENIES, parsePolicy } from './parse';

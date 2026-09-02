/**
 * Public surface of the auth module. Route handlers import from here rather
 * than reaching into individual files, so the module's boundary is this one
 * file rather than an implicit agreement about which internals are "really"
 * private.
 */

export { MAGIC_LINK_TTL_MS, issueMagicLinkToken, verifyMagicLinkToken } from '@/lib/auth/magic-link';
export {
  SESSION_COOKIE,
  issueSession,
  verifySession,
  inspectSession,
  sessionCookieOptions,
} from '@/lib/auth/session';
export type { SessionInspection } from '@/lib/auth/session';
export { authorizeSession } from '@/lib/auth/authorize';
export type { AuthResult } from '@/lib/auth/authorize';

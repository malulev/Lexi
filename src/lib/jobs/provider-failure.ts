import type { ErrorCode } from '@/types';

/**
 * What a provider's refusal means, in the closed vocabulary.
 *
 * A model provider answering 429 and a host answering "build minutes
 * exceeded" used to end as `internal_error`, which told the client nothing
 * they could act on and told the operator nothing without opening the
 * record. Each mapping here is a fact the operator can act on — top up,
 * wait for tomorrow, check the hosting plan — and the client reads the
 * matching sentence from `CLIENT_MESSAGES`.
 *
 * Pure: no I/O, no logging. Callers log the raw message next to the code.
 */

export interface ProviderError {
  statusCode: number;
  message: string;
}

const CREDIT_MESSAGE = /credit|insufficient funds|payment required/i;

/** `undefined` means "nothing specific": the caller keeps its generic ending. */
export function classifyModelFailure(error: ProviderError | undefined): ErrorCode | undefined {
  if (!error) return undefined;
  if (error.statusCode === 402) return 'model_credit';
  // Before the message check: OpenRouter's 429 text suggests buying credits
  // to raise the free allowance, and that is still a quota, not an empty account.
  if (error.statusCode === 429) return 'model_quota';
  if (CREDIT_MESSAGE.test(error.message)) return 'model_credit';
  if (error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 404) {
    return 'model_unavailable';
  }
  if (error.statusCode >= 500) return 'model_unavailable';
  return undefined;
}

// What a hosting provider says when the plan, not the code, stopped the build.
// Netlify's own wording varies by plan and year, so this matches the nouns a
// billing refusal has to contain rather than one exact sentence.
const HOSTING_LIMIT_MESSAGE =
  /build minutes|credits?\b|quota|allowance|payment required|billing|suspended|plan limit|exceeded (?:its|the|your) (?:limit|allowance)/i;

export function classifyHostingMessage(
  message: string | undefined,
): 'hosting_limit' | 'build_failed' {
  if (message && HOSTING_LIMIT_MESSAGE.test(message)) return 'hosting_limit';
  return 'build_failed';
}

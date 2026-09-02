import { createSign } from 'node:crypto';
import type { Env } from '@/types';

/**
 * GitHub App authentication.
 *
 * A GitHub App proves its identity with a short-lived JWT signed by its
 * private key, then exchanges that JWT for an installation access token —
 * the credential actually used against the REST API. Installation tokens
 * live one hour; this module caches one and refreshes it before it expires,
 * so every caller of `getToken` gets a token good for the request it is
 * about to make.
 *
 * The clock is injectable so tests can move time forward without waiting,
 * and `mintToken` is injectable so tests never reach the network.
 */

export interface TokenMinter {
  getToken(now?: Date): Promise<string>;
}

interface MintedToken {
  token: string;
  expiresAt: Date;
}

type MintTokenFn = (jwt: string) => Promise<MintedToken>;

/** Refresh this long before expiry, so a token never expires mid-flight. */
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * GitHub rejects a JWT whose `iat` is in the future according to its own
 * clock. Backdating by a minute is GitHub's documented tolerance for clock
 * drift between this host and GitHub's — see
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
const CLOCK_SKEW_BACKDATE_SECONDS = 60;

/** GitHub allows at most 10 minutes between `iat` and `exp`; stay well inside it. */
const JWT_LIFETIME_SECONDS = 9 * 60;

function signAppJwt(appId: string, privateKey: string, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000) - CLOCK_SKEW_BACKDATE_SECONDS;
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: issuedAt, exp: issuedAt + JWT_LIFETIME_SECONDS, iss: appId };
  const signingInput = [
    Buffer.from(JSON.stringify(header)).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
  ].join('.');
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

/**
 * The production path: exchange the App JWT for an installation access
 * token. Never log `jwt` or the response body — both carry credentials.
 */
async function mintInstallationToken(env: Env, jwt: string): Promise<MintedToken> {
  const url = `https://api.github.com/app/installations/${env.githubInstallationId}/access_tokens`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    // The response body is not included: on some failure modes GitHub
    // echoes request details we would rather not risk logging.
    throw new Error(
      `failed to mint installation token for installation ${env.githubInstallationId}: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as { token: string; expires_at: string };
  return { token: body.token, expiresAt: new Date(body.expires_at) };
}

export function createTokenMinter(
  env: Env,
  deps?: { now?: () => Date; mintToken?: MintTokenFn },
): TokenMinter {
  const clock = deps?.now ?? (() => new Date());
  const mint = deps?.mintToken ?? ((jwt: string) => mintInstallationToken(env, jwt));

  let cached: MintedToken | null = null;
  // Concurrent callers during a refresh share one in-flight mint rather than
  // each minting their own token.
  let inFlight: Promise<MintedToken> | null = null;

  const isFresh = (at: Date): boolean =>
    cached !== null && at.getTime() < cached.expiresAt.getTime() - REFRESH_SAFETY_MARGIN_MS;

  async function refresh(at: Date): Promise<MintedToken> {
    const jwt = signAppJwt(env.githubAppId, env.githubAppPrivateKey, at);
    try {
      const minted = await mint(jwt);
      cached = minted;
      return minted;
    } catch (error) {
      // Re-wrapped so a caller never sees the raw upstream error, which may
      // carry request internals; the message here names only the operation.
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to mint GitHub App installation token: ${reason}`);
    }
  }

  return {
    async getToken(now?: Date): Promise<string> {
      const at = now ?? clock();
      if (isFresh(at)) {
        return cached!.token;
      }
      if (!inFlight) {
        inFlight = refresh(at).finally(() => {
          inFlight = null;
        });
      }
      const minted = await inFlight;
      return minted.token;
    },
  };
}

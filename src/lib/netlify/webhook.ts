/**
 * Netlify webhook handling (T052, R4, contracts/http-api.md's Webhook
 * section): verifying a delivery is genuinely from Netlify, parsing it into
 * a `Deploy`, correlating it with a conversation, and deciding what it
 * means. No I/O lives here — the route handler that will call this owns
 * reading the request body and the shared secret.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Deploy } from './types';
import { rawDeploySchema, toDeploy } from './types';

export type WebhookResult =
  { ok: true; deploy: Deploy } | { ok: false; reason: 'bad_signature' | 'unparseable' };

export interface Correlation {
  conversationNumber: number;
}

export type DeployEffect =
  | { kind: 'preview_ready'; previewUrl: string }
  | { kind: 'build_failed'; detail: string }
  | { kind: 'ignore' };

function base64urlDecode(segment: string): Buffer {
  return Buffer.from(segment, 'base64url');
}

/**
 * Verifies the HMAC over `header.payload` and the `sha256` claim against
 * the raw body, both with `timingSafeEqual` so a mismatch cannot be timed.
 * Any malformed input (wrong number of segments, non-base64url content, a
 * hex digest of the wrong length) is treated as a signature failure rather
 * than allowed to throw past this function — a delivery this malformed was
 * never going to be genuine.
 *
 * VERIFIED FROM NETLIFY'S OWN DOCS (docs.netlify.com/deploy/deploy-notifications):
 * the header is `X-Webhook-Signature`, the token is a compact JWS signed
 * HS256 with the configured secret, and its claims include `iss: "netlify"`
 * and `sha256`, the hex SHA-256 digest of the raw body. Netlify's own code
 * samples verify with a JWT library configured for `issuer: "netlify"` and
 * `algorithms: ["HS256"]"` and then compare the `sha256` claim.
 *
 * NOT VERIFIED FROM AN ACTUAL DELIVERY: whether the JWS header carries
 * exactly `{"alg":"HS256","typ":"JWT"}` or additional parameters, whether
 * the claim set carries anything besides `iss` and `sha256` (harmless
 * either way, since only those two are checked here), and whether every
 * deploy event type Netlify can send this installation is signed the same
 * way. See specs/001-conversational-site-editing/notes/netlify-payload-fields.md.
 */
function verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const segments = signatureHeader.split('.');
  if (segments.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = segments as [string, string, string];

  try {
    const expectedSignature = createHmac('sha256', secret)
      .update(`${headerPart}.${payloadPart}`)
      .digest();
    const givenSignature = base64urlDecode(signaturePart);
    if (givenSignature.length !== expectedSignature.length) return false;
    if (!timingSafeEqual(givenSignature, expectedSignature)) return false;

    const claims: unknown = JSON.parse(base64urlDecode(payloadPart).toString('utf8'));
    if (typeof claims !== 'object' || claims === null) return false;
    const { iss, sha256 } = claims as Record<string, unknown>;
    if (iss !== 'netlify' || typeof sha256 !== 'string') return false;

    const claimedDigest = Buffer.from(sha256, 'hex');
    const actualDigest = createHash('sha256').update(rawBody).digest();
    if (claimedDigest.length !== actualDigest.length) return false;
    return timingSafeEqual(claimedDigest, actualDigest);
  } catch {
    // A segment that is not valid base64url, or claims that are not valid
    // JSON, is exactly as untrustworthy as a wrong signature.
    return false;
  }
}

/**
 * Verifies `X-Webhook-Signature` against `rawBody`, then parses the body
 * into a `Deploy`. The two failure modes are kept distinct (contracts/
 * http-api.md): `bad_signature` means this delivery cannot be trusted at
 * all; `unparseable` means it was genuinely from Netlify but this
 * installation cannot make sense of its shape — worth logging differently.
 *
 * Unknown fields never cause `unparseable` (R4): `rawDeploySchema` is
 * `.passthrough()`, so only a payload missing the couple of fields this
 * installation actually requires (`id`, `state`) fails to parse.
 */
export function verifyAndParseWebhook(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): WebhookResult {
  if (!signatureHeader) return { ok: false, reason: 'bad_signature' };
  if (!verifySignature(rawBody, signatureHeader, secret))
    return { ok: false, reason: 'bad_signature' };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  const result = rawDeploySchema.safeParse(parsedJson);
  if (!result.success) return { ok: false, reason: 'unparseable' };

  return { ok: true, deploy: toDeploy(result.data) };
}

/**
 * Correlates a deploy to the conversation it belongs to (R4): by pull
 * request number first, since that is unambiguous when present, falling
 * back to matching the deploy's commit against a conversation's head
 * commit. Returns `null` when neither matches anything open — Netlify
 * sends deploys for pushes unrelated to this product, and silently
 * ignoring those is correct, not a swallowed error.
 */
export function correlateDeploy(
  deploy: Deploy,
  openConversations: Array<{ number: number; headSha: string }>,
): Correlation | null {
  if (deploy.reviewId !== undefined) {
    const byPullRequest = openConversations.find(
      (conversation) => conversation.number === deploy.reviewId,
    );
    if (byPullRequest) return { conversationNumber: byPullRequest.number };
  }

  if (deploy.commitRef !== undefined) {
    const byCommit = openConversations.find(
      (conversation) => conversation.headSha === deploy.commitRef,
    );
    if (byCommit) return { conversationNumber: byCommit.number };
  }

  return null;
}

/**
 * What a deploy event means for the conversation it belongs to, as a pure
 * function of the deploy's own content.
 *
 * There is no datastore to record "this delivery was already handled"
 * (constitution VII), and Netlify may redeliver an event. Making this
 * function pure is what makes that safe without one: the same deploy
 * always yields the same effect, so a caller that writes the effect into
 * the durable record (data-model.md's Request Record) simply overwrites the
 * same fields with the same values on a repeat delivery. The action is
 * idempotent because it is memoryless, not because delivery is deduplicated.
 */
export function deployEffect(deploy: Deploy): DeployEffect {
  if (deploy.state === 'ready' && deploy.deployUrl) {
    return { kind: 'preview_ready', previewUrl: deploy.deployUrl };
  }

  if (deploy.state === 'error') {
    return {
      kind: 'build_failed',
      detail: deploy.errorMessage ?? 'The build failed for an unspecified reason.',
    };
  }

  return { kind: 'ignore' };
}

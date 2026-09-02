/**
 * Netlify's deploy shape, narrowed to what the rest of the installation
 * needs (R4, data-model.md's Deploy entity).
 *
 * A deploy is read two ways: fetched from the REST API (`client.ts`) and
 * delivered as an outgoing webhook body (`webhook.ts`). Netlify's own docs
 * say a webhook body is "a JSON representation of the object relevant to
 * the event" — i.e. the same Deploy object the API returns — so both paths
 * share one raw schema and one mapping function here.
 *
 * FIELD NAMES ARE NOT VERIFIED AGAINST A LIVE DELIVERY. They are taken from
 * Netlify's public API reference for the Deploy resource (open-api.netlify.com)
 * and its deploy-notifications docs, fetched during implementation of this
 * module — not from an actual webhook this installation received. See
 * specs/001-conversational-site-editing/notes/netlify-payload-fields.md for
 * the exact list of what must be confirmed against a real delivery before
 * this ships.
 */
import { z } from 'zod';

export type DeployState = 'building' | 'ready' | 'error' | 'enqueued' | 'processing' | 'other';
export type DeployContext = 'production' | 'deploy-preview' | 'branch-deploy' | 'other';

export interface Deploy {
  id: string;
  state: DeployState;
  context: DeployContext;
  /** The commit this deploy was built from. */
  commitRef?: string;
  /** The pull request number, when this is a deploy preview. */
  reviewId?: number;
  /** Where the built site can be seen. */
  deployUrl?: string;
  /** Present when the build failed. Never shown to a client (Principle I). */
  errorMessage?: string;
  createdAt?: string;
}

// Only `id` and `state` are required: everything else is legitimately absent
// on some deploys (a production deploy has no `review_id`; a deploy that
// never left `enqueued` has no `deploy_url`). `.passthrough()` is the load
// -bearing choice here (R4) — a payload carrying a field this schema has
// never seen, whether a genuinely new one or one this schema names wrong,
// must still parse. That is the opposite of `.strict()` in
// src/lib/policy/parse.ts, and deliberately so: a settings typo there is a
// developer's mistake to catch; an unknown field here is a provider's
// business, not this installation's to reject.
export const rawDeploySchema = z
  .object({
    id: z.string(),
    state: z.string(),
    context: z.string().optional(),
    branch: z.string().optional(),
    commit_ref: z.string().optional(),
    review_id: z.number().optional(),
    deploy_url: z.string().optional(),
    ssl_url: z.string().optional(),
    error_message: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

export type RawDeploy = z.infer<typeof rawDeploySchema>;

// Documented states, per Netlify's build-status materials: a new deploy
// passes through `new`, `enqueued`, `building`, `uploading`, `uploaded`,
// `preparing`, `prepared`, `processing`, `processed`, to `ready`, or to
// `error`. Only the ones this installation acts on differently are named;
// everything else — including states Netlify adds later — maps to `other`.
const KNOWN_STATES: ReadonlySet<string> = new Set([
  'building',
  'ready',
  'error',
  'enqueued',
  'processing',
]);

// Netlify also has a `dev` context (Netlify Dev, local only) which cannot
// reach this webhook and is deliberately left to fall through to `other`.
const KNOWN_CONTEXTS: ReadonlySet<string> = new Set([
  'production',
  'deploy-preview',
  'branch-deploy',
]);

function mapState(raw: string): DeployState {
  return KNOWN_STATES.has(raw) ? (raw as DeployState) : 'other';
}

function mapContext(raw: string | undefined): DeployContext {
  return raw !== undefined && KNOWN_CONTEXTS.has(raw) ? (raw as DeployContext) : 'other';
}

/**
 * Maps Netlify's raw deploy onto the installation's narrow `Deploy`.
 *
 * Unknown states and contexts fall through to `'other'` rather than
 * throwing — a provider that adds a state must not break the installation.
 * `deployUrl` prefers `deploy_url` and falls back to `ssl_url`, since which
 * of the two names Netlify actually sends is itself part of what this
 * module cannot verify from here (see the reconciliation note).
 */
export function toDeploy(raw: RawDeploy): Deploy {
  return {
    id: raw.id,
    state: mapState(raw.state),
    context: mapContext(raw.context),
    commitRef: raw.commit_ref,
    reviewId: raw.review_id,
    deployUrl: raw.deploy_url ?? raw.ssl_url,
    errorMessage: raw.error_message,
    createdAt: raw.created_at,
  };
}

// The site object returned by `GET /sites/{site_id}`. Passthrough for the
// same reason as the deploy schema: this installation only needs `id` and a
// public URL, and must not choke on the rest of Netlify's site shape.
export const rawSiteSchema = z
  .object({
    id: z.string(),
    url: z.string().optional(),
    ssl_url: z.string().optional(),
  })
  .passthrough();

export type RawSite = z.infer<typeof rawSiteSchema>;

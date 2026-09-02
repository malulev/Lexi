# Netlify payload fields — reconciliation with R4 (T099, partial)

**Status: unverified against a live delivery.** This note exists because R4 (research.md)
flagged the deploy object's field names as an assumption to confirm in implementation, and
because `verifyAndParseWebhook`'s signature scheme is a security path where an unverifiable
claim must be written down as unverified rather than asserted as fact.

No live Netlify webhook could be captured from this environment: there is no reachable
Netlify site, no way to receive an inbound HTTP delivery, and no existing recorded delivery
in the repository. Everything below is built from Netlify's own published documentation,
fetched during this task, not from a payload this installation actually received.

## What was checked, and against what

| Claim | Source | Confidence |
|---|---|---|
| A webhook body is "a JSON representation of the object relevant to the event" | `docs.netlify.com/deploy/deploy-notifications/` (fetched directly) | Netlify's own words, but prose, not a schema or example payload |
| Deploy object field names: `id`, `state`, `context`, `branch`, `commit_ref`, `review_id`, `deploy_url`, `ssl_url`, `admin_url`, `error_message`, `created_at`, `updated_at`, `published_at`, `review_url`, `site_id` | Netlify's public API reference for the Deploy resource (`open-api.netlify.com`), fetched and summarized | The API reference for the REST resource, not a captured webhook body |
| `context` values: `production`, `deploy-preview`, `branch-deploy`, `dev` | `docs.netlify.com/deploy/deploy-overview/` and related docs | Documented enum |
| `state` values include `new`, `enqueued`, `building`, `uploading`, `uploaded`, `preparing`, `prepared`, `processing`, `processed`, `ready`, `error`, `retrying` | Netlify blog post and support-forum references, not one authoritative enum table | Fragmented — no single canonical list found |
| Signature header is `X-Webhook-Signature`, a compact JWS, HS256 | `docs.netlify.com/deploy/deploy-notifications/` (fetched directly, includes Ruby and Node.js code samples) | Netlify's own code sample — the strongest source in this note |
| JWS claims include `iss: "netlify"` and `sha256` (hex SHA-256 digest of the raw body) | Same page, same code samples | Same as above |

## What this implementation assumes, matching R4's fallback design

`src/lib/netlify/types.ts`'s `rawDeploySchema` treats only `id` and `state` as required and
uses `.passthrough()` for everything else, precisely so that a wrong guess at a field name
degrades to "that field reads as `undefined`" rather than "the payload fails to parse".
Concretely:

- If `review_id` is not the correct field name for the pull request number, correlation
  silently falls through to the commit-reference fallback R4 already names as the intended
  degradation path — not a crash.
- If `commit_ref` is wrong, correlation for that deploy fails and `correlateDeploy` returns
  `null` (contracts/http-api.md: "ignores deploys it cannot correlate"), which is the correct,
  documented behaviour for an uncorrelatable deploy, just triggered for the wrong reason.
- If `deploy_url` is wrong but `ssl_url` is right (or vice versa), `toDeploy` already falls
  back between the two.
- If `error_message` is wrong, a failed build is still detected via `state === 'error'`
  (`deployEffect` returns `build_failed`), just with a generic `detail` string instead of
  Netlify's actual message.

The one field this degradation path cannot save is `id` or `state` itself being named
differently than assumed — that would make every deploy in the payload unparseable
(`WebhookResult` reason `'unparseable'`), which is at least a loud, observable failure rather
than a silent misroute.

## Precise list to confirm against a real delivery before this ships

1. **Whether the webhook body is byte-for-byte the same shape as the REST API's Deploy
   object**, or wraps it (e.g. under a `payload` or `deploy` key, or alongside a `site`
   object). This implementation assumes the body *is* the deploy object, flat, at the
   top level.
2. **The exact field name carrying the pull request number** — assumed to be `review_id`
   (integer). Confirm it is not, e.g., `pr_number`, `pull_request_id`, or nested inside
   another object.
3. **Whether `review_id` is present and non-null specifically when `context` is
   `deploy-preview`**, and whether it is ever present for other contexts.
4. **The exact field name and format of the commit reference** — assumed `commit_ref`
   (full 40-character SHA). Confirm it is not abbreviated, and not named `sha` or `commit`.
5. **Which of `deploy_url` and `ssl_url` (if either) Netlify actually sends on a webhook
   body**, and whether there is a third, more authoritative field (e.g. `links.permalink`)
   this schema does not know about.
6. **The exact field name for the build failure message** — assumed `error_message`.
7. **Whether every event type this installation subscribes to (deploy started, succeeded,
   failed, locked, unlocked, restored, deleted) sends the same shape**, or whether some
   carry additional or differently-named fields.
8. **Whether `X-Webhook-Signature` is sent on every event type**, or only some.
9. **The exact JWS header** (`alg`/`typ` and whether any other header parameters are
   present) — irrelevant to verification as implemented (the header is taken as delivered
   and only the computed HMAC over it is checked), but worth confirming there is no
   `alg: "none"` downgrade path a real delivery could exploit if this code is ever
   refactored to trust the header's own `alg` field instead of hard-coding HS256, which it
   currently does not do.
10. **Whether the JWS claims carry anything beyond `iss` and `sha256`** that a future version
    of this code might want to check (e.g. an `iat` for replay-window enforcement) — currently
    irrelevant since only `iss` and `sha256` are validated, but worth knowing for defence in
    depth.

## How to confirm

Point a real Netlify site's outgoing webhook (deploy started / succeeded / failed) at a
temporary inspection endpoint (e.g. a `webhook.site` URL or a throwaway logging route), open
a pull request against the linked repository to trigger a Deploy Preview, and capture:

- the raw request body, unmodified, for at least one `deploy_preview` succeeded event and one
  production deploy event, and
- the full `X-Webhook-Signature` header value alongside the body used to compute it.

Reconcile both against `src/lib/netlify/types.ts` (`rawDeploySchema`, `toDeploy`) and
`src/lib/netlify/webhook.ts` (`verifySignature`), updating field names and adding fixtures
under `tests/fixtures/netlify/` from the real capture (with any genuinely secret values
redacted — the shape matters, not particular tokens or SHAs).

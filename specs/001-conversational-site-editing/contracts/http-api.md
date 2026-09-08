# Contract: HTTP Interface

All routes require a valid session cookie unless stated. Session identity must appear in the
installation's configured `ALLOWED_EMAILS`, checked per request rather than at sign-in only, so
removing an address takes effect on the next request.

## Authentication

| Route                | Method | Body        | Response                                                                                                                                                                                                     |
| -------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/auth/request`  | POST   | `{ email }` | `202` always — never reveals whether an address is permitted                                                                                                                                                 |
| `/api/auth/callback` | GET    | `?token`    | `302` to `/login/code`, sets a ten-minute pending cookie; a session is not issued yet                                                                                                                        |
| `/api/auth/code`     | POST   | `{ code }`  | `200 { status: 'ok' }` sets the session cookie and clears the pending one. `401 { error: 'expired' }` with no valid pending cookie; `401 { error: 'refused' }` on a wrong code or over the per-address limit |
| `/api/auth/logout`   | POST   | —           | `303` to the sign-in page, clears the session and pending cookies                                                                                                                                            |
| `/login/enroll`      | GET    | `?token`    | Operator-issued (`npm run enroll:link`), valid 24 hours: the page that shows the authenticator QR                                                                                                            |

The second factor is a six-digit TOTP code from an authenticator seeded with the installation's
one shared `TOTP_SECRET`. There is no configuration surface.

## Conversations

| Route                                  | Method | Body                                                                                                 | Response                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/conversations`                   | GET    | —                                                                                                    | `{ conversations: [{ number, title, status, updatedAt, previewUrl? }] }`                                                                                                                                                                                                                                      |
| `/api/conversations`                   | POST   | `{ message, modelTier? }`, or `multipart/form-data` with the same fields plus `files[]`              | `201 { number }` — opens a branch, a pull request, and starts a request. `400` on a tier outside the vocabulary; `413`/`415` with a client sentence on a refused attachment                                                                                                                                   |
| `/api/conversations/{number}`          | GET    | —                                                                                                    | `{ conversation, messages[], pendingRequest? }` — assembled from comments. A message carries `model` and `costUsd` when its record has them                                                                                                                                                                   |
| `/api/conversations/{number}/messages` | POST   | `{ message, targetHint?, modelTier? }`, or `multipart/form-data` with the same fields plus `files[]` | `202` — starts a request. `409` if one is in flight; `413`/`415` on a refused attachment                                                                                                                                                                                                                      |
| `/api/conversations/{number}/stream`   | GET    | —                                                                                                    | `text/event-stream`                                                                                                                                                                                                                                                                                           |
| `/api/conversations/{number}/approve`  | POST   | —                                                                                                    | `202 { requestId }` — brings the branch up to date with the site if it has moved on (merge, fresh preview), merges, then reports the production build on the stream as a `publish` request. `409` if no successful preview, if a change is in flight, or if the site changed the same lines (`site_conflict`) |
| `/api/conversations/{number}/undo`     | POST   | —                                                                                                    | `202 { requestId }` — reverts the merge, then reports the rebuild on the stream as an `undo` request                                                                                                                                                                                                          |

`409` on a second message is the enforcement behind the disabled input (FR-007a): a stale browser
tab is refused by the server, not merely discouraged by the interface.

`modelTier` is one of `free`, `low`, `medium`, `high`, `extra` (src/lib/models.ts). Absent, the
repository's own `model` runs. `files[]` accepts PNG, JPEG, GIF, WebP, SVG and PDF, typed by their
bytes rather than their label: at most 5 files, 10 MB each, 25 MB together. Accepted files are
written into the site's upload directory before the agent runs and gated and committed with the
change.

## Progress stream

The stream belongs to a conversation, not to one request, and stays open for the life of the
page. Every request that begins on the conversation while it is open — a follow-up, a publish,
an undo, something started from another device — is announced and then followed, so an open
page never needs a reload to see progress.

```text
event: request
data: {"requestId":"r_…","kind":"change","live":true,"resumed":false}

event: stage
data: {"stage":"running","at":"2026-09-02T10:31:04Z"}

event: output
data: {"text":"Reading src/components/Hero.tsx"}

event: done
data: {"outcome":"succeeded","previewUrl":"https://..."}

event: sync
data: {"inFlight":false}
```

| Event     | Meaning                                                                                                                                                                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request` | A request begins; the stages that follow belong to it. `kind` is `change`, `publish` or `undo` and decides how the interface labels the stages. `live: false` marks a replayed durable record; `resumed: true` marks a live request that was already running when the stream connected. |
| `stage`   | A stage the request reached.                                                                                                                                                                                                                                                            |
| `output`  | Live agent output. Best effort, and never shown verbatim (Principle I).                                                                                                                                                                                                                 |
| `done`    | The request ended. Carries `previewUrl` for a change, `liveUrl` for a publish or an undo that reached the site, `errorCode` for a failure.                                                                                                                                              |
| `sync`    | Replay is over, and whether a request is running right now. Until it arrives the interface trusts the snapshot it was rendered with; after it, the stream is the authority.                                                                                                             |

On connection the durable records are replayed first (each as `request` → `stage`… → `done`),
then any request under way (its `request` carrying `live: true`), then `sync`, then live events.
Live output is best effort; stages and outcome are not.

## Webhook

`POST /api/webhooks/netlify` — unauthenticated by session, verified by shared secret. Correlates
the deploy to a conversation by pull request number, falling back to commit reference. Ignores
deploys it cannot correlate. Must be idempotent: the same event may arrive more than once.

## Client-facing error vocabulary

Every error reaching a client surface is one of these, in plain language, never a stack trace,
a path, or a build log:

| Code                | What the client sees                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `blocked_by_policy` | Your developer has protected this part of the site                                                              |
| `request_in_flight` | A change is already being applied — one moment                                                                  |
| `too_busy`          | Things are busy right now, so your change did not run. Please try again in a few minutes. Nothing was published |
| `agent_timeout`     | That took too long. Try a smaller or more specific change                                                       |
| `build_failed`      | The change broke the site build. I can try to fix it                                                            |
| `site_unreachable`  | Can't reach your website's hosting right now                                                                    |
| `cost_ceiling`      | That request was larger than this site's limit allows                                                           |
| `out_of_date`       | Your website changed while this was being saved. Try again in a moment                                          |
| `site_conflict`     | Your website changed in the same place as this one. Start a new conversation and ask for it again               |
| `nothing_to_change` | Nothing needed changing for that                                                                                |

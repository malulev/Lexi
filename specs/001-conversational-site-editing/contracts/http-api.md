# Contract: HTTP Interface

All routes require a valid session cookie unless stated. Session identity must appear in the
installation's configured `ALLOWED_EMAILS`, checked per request rather than at sign-in only, so
removing an address takes effect on the next request.

## Authentication

| Route | Method | Body | Response |
|---|---|---|---|
| `/api/auth/request` | POST | `{ email }` | `202` always — never reveals whether an address is permitted |
| `/api/auth/callback` | GET | `?token` | `302` to the conversation list, sets the session cookie |
| `/api/auth/logout` | POST | — | `204` |

The configuration surface additionally requires a password and a time-based one-time code, and
grants a separate short-lived cookie scoped to `/settings`.

## Conversations

| Route | Method | Body | Response |
|---|---|---|---|
| `/api/conversations` | GET | — | `{ conversations: [{ number, title, status, updatedAt, previewUrl? }] }` |
| `/api/conversations` | POST | `{ message }` | `201 { number }` — opens a branch, a pull request, and starts a request |
| `/api/conversations/{number}` | GET | — | `{ conversation, messages[], pendingRequest? }` — assembled from comments |
| `/api/conversations/{number}/messages` | POST | `{ message }` | `202` — starts a request. `409` if one is in flight |
| `/api/conversations/{number}/stream` | GET | — | `text/event-stream` |
| `/api/conversations/{number}/approve` | POST | — | `202` — merges. `409` if no successful preview, or if the branch is out of date |
| `/api/conversations/{number}/undo` | POST | — | `202` — reverts the merge |

`409` on a second message is the enforcement behind the disabled input (FR-007a): a stale browser
tab is refused by the server, not merely discouraged by the interface.

## Progress stream

```text
event: stage
data: {"stage":"running","at":"2026-09-02T10:31:04Z"}

event: output
data: {"text":"Reading src/components/Hero.tsx"}

event: done
data: {"outcome":"succeeded","previewUrl":"https://..."}
```

Reconnection sends the durable records first, then resumes live output. Live output is best
effort; stages and outcome are not.

## Webhook

`POST /api/webhooks/netlify` — unauthenticated by session, verified by shared secret. Correlates
the deploy to a conversation by pull request number, falling back to commit reference. Ignores
deploys it cannot correlate. Must be idempotent: the same event may arrive more than once.

## Client-facing error vocabulary

Every error reaching a client surface is one of these, in plain language, never a stack trace,
a path, or a build log:

| Code | What the client sees |
|---|---|
| `blocked_by_policy` | Your developer has protected this part of the site |
| `request_in_flight` | A change is already being applied — one moment |
| `agent_timeout` | That took too long. Try a smaller or more specific change |
| `build_failed` | The change broke the site build. I can try to fix it |
| `site_unreachable` | Can't reach your website's hosting right now |
| `cost_ceiling` | That request was larger than this site's limit allows |
| `out_of_date` | Your site changed since this was made — it needs rebuilding first |
| `nothing_to_change` | Nothing needed changing for that |

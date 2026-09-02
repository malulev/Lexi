# Phase 1 Data Model: Conversational Site Editing

**Date**: 2026-09-02

There is no database. Every entity below is either **derived** — read on demand from GitHub or
Netlify — or **ephemeral** — held only while a request runs. The column that matters most is
"where it lives", because it is what stops this design drifting back into owning state.

## Entities

### Installation

The deployment itself. Exactly one per website.

| Field | Type | Source | Notes |
|---|---|---|---|
| `repo` | `owner/name` | environment | The one repository this install manages |
| `installationId` | number | environment | GitHub App installation |
| `netlifySiteId` | string | environment | The one Netlify site |
| `allowedEmails` | string[] | environment | Who may sign in. Deliberately not in the repository (FR-003c1) |
| `defaultBranch` | string | derived | Read from the repository, not configured |
| `publicUrl` | URL | derived | Read from the Netlify site |

Validated at startup (FR-003b). A failure here prevents the application from serving, rather
than surfacing at the first client request.

### Settings

Non-secret, developer-editable. Lives at `.webagent/config.yml` in the site's repository.

| Field | Type | Rules |
|---|---|---|
| `alertContact` | email | Required. Receives cost-ceiling and settings-fault alerts |
| `costCeilingUsd` | number | > 0. Per request, not per period |
| `model` | string | `provider/model` passed to the agent |
| `maxRequestMinutes` | number | 1–30. Also the lock staleness threshold |

Read and validated at startup and on change. On a parse or validation failure the last valid
settings remain in force and the fault is reported to the alert contact (FR-003f) — access
control never fails open.

### Policy

Lives at `.webagent/policy.yml`. Consumed only by the gate.

| Field | Type | Default when absent |
|---|---|---|
| `allow` | glob[] | `["**"]` |
| `deny` | glob[] | see below |
| `maxFilesChanged` | number | 15 |
| `maxDiffLines` | number | 800 |
| `forbidNewDependencies` | boolean | true |

**Unconditional denies**, applied ahead of and independent of any site declaration, and not
waivable (FR-003e, FR-019): `.webagent/**`, `AGENTS.md`, `**/.env*`, `.github/**`, `netlify.toml`,
and dependency manifests and lockfiles.

### Conversation

**Is** a pull request. Not stored, not mirrored.

| Field | Where it lives |
|---|---|
| identity | pull request number |
| title | pull request title |
| branch | `webagent/c-<number>` |
| status | open / merged / closed, from the pull request |
| pending change | the pull request's diff |
| history | the pull request's comments |

State transitions: `open → published` on merge; `published → open` is impossible — a new request
against a merged conversation starts a fresh one (spec Edge Cases). `open → closed` when the
client abandons it.

### Message

**Is** a pull request comment. Client requests are comments authored on the client's behalf;
agent and system messages are comments written by the app.

### Request

Ephemeral while running; durable only as its record.

| Field | Lifetime |
|---|---|
| `stage` | in memory, streamed |
| `containerId` | in memory |
| live output | in memory, streamed, discarded |
| outcome, extent, cost | written to the durable record on exit |

Stages: `starting → running → gating → pushing → building → succeeded`, with `blocked` from
gating, and `failed` from any stage. Every terminal stage releases the lock and writes a record.

### Request Record

The durable residue of a request: one pull request comment carrying prose plus a machine-readable
block. Format is specified in [contracts/durable-record.md](./contracts/durable-record.md).
Rendering and parsing are inverses; history is reconstructed by parsing these (FR-009a, FR-009b).

### Lock

**Is** the git reference `refs/webagent/lock` in the site's repository.

| Property | Rule |
|---|---|
| acquire | create the reference; rejection means another request holds it |
| identity | points at a commit whose message names the request and its start time |
| release | delete the reference on any terminal stage |
| abandonment | older than `maxRequestMinutes` may be broken; breaking is recorded |

### Deploy

**Is** a Netlify deploy. Correlated to a conversation by pull request number, falling back to
commit reference. Preview context for pending changes, production context after merge.

### Session

A signed cookie carrying the email address and an expiry. No server-side session record exists.

### Audit

**Is** the pull request timeline plus git history: who merged, who reverted, when. Unalterable
because it is upstream, not ours (FR-031).

## Relationships

```text
Installation ──1:1── Site ──1:1── Netlify site
     │
     └──1:N── Conversation (pull request)
                 ├──1:N── Message (comment)
                 ├──1:N── Request Record (comment)
                 ├──1:N── Deploy (preview; one production on merge)
                 └──0:1── Request (in flight, ephemeral)

Installation ──0:1── Lock (git reference)
```

## What is deliberately not modelled

Users beyond an allow-list of addresses; queued requests, because requests are refused rather
than queued (FR-007a); per-message cost, because cost is per request; and anything cross-site,
because no installation knows of another.

# Implementation Plan: Conversational Site Editing with Preview and One-Click Deploy

**Branch**: `001-conversational-site-editing` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-conversational-site-editing/spec.md`

## Summary

A single-tenant web application, installed once per client website, that turns a plain-language
chat request into a reviewed change on that site. Each request runs an autonomous coding agent
in a throwaway container against a working copy of the site's repository. The container holds no
credentials and has no git remote, so it can only commit locally; the worker then validates the
resulting diff against the site's declared policy before pushing anything. A pushed branch
becomes a pull request, the hosting provider builds a preview, and the client approves to merge
and publish, or undoes by reverting.

The product stores nothing. Conversations are pull requests, messages are comments, settings and
policy are files in the site's repository, and the single-flight lock is a git reference. What
cannot be written back is treated as ephemeral.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS

**Primary Dependencies**: Next.js (App Router) for the dashboard and route handlers; Octokit for
the GitHub App; `dockerode` for container control; `simple-git` for local repository operations;
`zod` for configuration and payload validation; `yaml` for the settings and policy files;
`minimatch` for policy globs; `nodemailer` for notifications; `otplib` and `argon2` for the
configuration credential.

**Storage**: None. GitHub and Netlify are the system of record; see spec Assumptions and
constitution Principle VII. The only durable local artefact is a bare repository mirror, which
is a rebuildable cache.

**Testing**: Vitest for unit and integration tests, with recorded HTTP fixtures for the GitHub
and Netlify clients; Playwright for the two end-to-end journeys.

**Target Platform**: Linux container, run via Docker Compose. One deployment per client site.

**Project Type**: Web application, single deployable, with a separate agent container image.

**Performance Goals**: Median request-to-preview under 4 minutes, 90th percentile under 8 (SC-002);
first progress feedback within 10 seconds and a meaningful stage within 60 (SC-003).

**Constraints**: No datastore of any kind (constitution VII). The agent container holds no
credential able to write to the repository or hosting (FR-015). One in-flight request per
installation, enforced independently of the interface (FR-007b). Conversation history is
reconstructed from upstream systems only (FR-009b).

**Scale/Scope**: One site per installation; a handful of client users; a handful of requests per
day. Roughly 40 source files, two end-to-end journeys, one container image.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. The Client Never Sees Code | Client surfaces render the durable summary and preview only. Raw diffs, paths, and build logs are confined to the failure detail supplied to the agent, never to client-facing views. | Pass |
| II. Nothing Reaches Production Without Explicit Human Approval | Merge occurs only from the approval route handler, which requires an authenticated client identity. No scheduled or agent-initiated merge path exists in the design. | Pass |
| III. Policy Gate Machine-Enforced | The container has no remote and no credential; push is a worker capability that runs after the diff gate. The gate is a pure function over a file list, unit-testable without any network. | Pass |
| IV. Test-First | The gate, the lock, the state machine, and the auth path are specified as pure modules with fixture-driven tests; tasks are ordered test-first. | Pass |
| V. Observability and Cost Accountability | Every finished request writes a durable comment carrying stages, outcome, extent of change, and cost. Live output is explicitly ephemeral. | Pass |
| VI. One Installation, One Website | Configuration names exactly one repository and one site; there is no collection of sites anywhere in the design. | Pass |
| VII. State Lives Where It Already Lives | No datastore. Mirror is a cache. Settings, policy, history, lock, and audit all live upstream. | Pass |
| VIII. Ship the Smallest Thing | Deferred by decision: element picking, queueing, container-side builds, passkeys, multi-model routing. | Pass |

**Post-design re-check**: Pass. One narrowing to record — R6 defers passkeys in favour of a
password plus a time-based one-time code, because a passkey needs a stored credential and
counter, which Principle VII forbids. FR-003a is satisfied by the alternative it names.

## Project Structure

### Documentation (this feature)

```text
specs/001-conversational-site-editing/
├── spec.md
├── plan.md              # This file
├── plan-inputs.md       # Decisions carried in from brainstorming
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Created by the tasks command, not by this one
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (client)/
│   │   ├── page.tsx                    # Conversation list for the one site
│   │   └── c/[number]/page.tsx         # One conversation: messages, preview, approve
│   ├── (config)/settings/page.tsx      # Configuration surface, stronger credential
│   ├── login/page.tsx
│   └── api/
│       ├── auth/[...route]/route.ts    # Magic link request and callback
│       ├── conversations/route.ts      # List and create
│       ├── conversations/[number]/messages/route.ts   # Send a request
│       ├── conversations/[number]/stream/route.ts     # Server-sent progress
│       ├── conversations/[number]/approve/route.ts
│       ├── conversations/[number]/undo/route.ts
│       └── webhooks/netlify/route.ts
├── lib/
│   ├── config/          # Load, validate, cache settings and policy from the repo
│   ├── auth/            # Magic link, session cookie, configuration credential
│   ├── github/          # App tokens, refs, branches, pull requests, comments
│   ├── netlify/         # Deploy lookup, webhook payload parsing
│   ├── policy/          # Diff gate: pure, no network
│   ├── lock/            # Reference-based single-flight, staleness handling
│   ├── runner/          # JobRunner interface and Docker implementation
│   ├── mirror/          # Bare mirror cache and per-job working tree
│   ├── record/          # Durable comment: render and parse the metadata block
│   ├── jobs/            # State machine, orchestration, event bus
│   └── notify/          # Email, with idempotency derived from the record
└── types/

agent/
├── Dockerfile           # node + git + opencode
└── entrypoint.sh        # Reads prompt, runs opencode, commits locally, exits

tests/
├── unit/                # policy gate, record parsing, state machine, config validation
├── integration/         # route handlers against recorded GitHub and Netlify fixtures
└── e2e/                 # request-to-preview, approve-and-undo

docker-compose.yml
.env.example
```

**Structure Decision**: One Next.js application containing both the interface and the worker,
plus a separate agent image. A single deployable matches a single-tenant install and keeps the
self-host story to one compose file. The worker runs in the same process as the route handlers;
this is what makes the reference lock necessary rather than optional, since a deploy that
overlaps two processes must not produce two agents on one branch.

## Design Notes

### Request lifecycle

```text
message
  └─ acquire refs/webagent/lock            (422 → refused, not queued)
     └─ working tree from bare mirror, branch from default or existing conversation branch
        └─ container: opencode run --format json --auto   (no remote, no credentials)
           └─ policy gate over changed paths and change size
              ├─ violation → discard tree, release lock, blocked message
              └─ pass → push branch, open or update pull request
                 └─ Netlify webhook → preview ready or build failed
                    └─ durable comment written, lock released, notification sent
```

Stage transitions are published on an in-process event bus that the stream route subscribes to.
The same transitions accumulate into the durable comment written when the request ends.

### What each module owns

- `policy/` is a pure function: given changed paths, a diff size, and a policy, return allow or a
  named violation. No network, no filesystem. This is the security boundary and is the most
  heavily tested module.
- `lock/` owns acquisition, release, and the abandonment rule. It never decides whether work
  should happen, only whether this process may do it.
- `record/` owns the durable comment format in both directions. Rendering and parsing are
  inverses and are property-tested as such, because history reconstruction depends on it.
- `runner/` exposes `start`, `logs`, `cancel`. Docker is the only implementation; the interface
  exists so that the worker is testable without Docker, not to anticipate other backends.

### Failure and recovery

Every failure path releases the lock and writes a durable record. A process that dies mid-job
leaves a lock that the staleness rule breaks on the next request, and a conversation whose last
durable record is the request's start; the interface renders that as an interrupted request the
client can retry. No partial state is repaired, because there is none to repair.

## Complexity Tracking

> No constitution violations require justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | — | — |

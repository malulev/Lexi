# Website AI Auto Builder Constitution

## Core Principles

### I. The Client Never Sees Code

Every interaction a client has with the product is chat, preview, or a single approval
button. No diffs, no file paths, no branch names, no build logs, no git vocabulary are
exposed in the client-facing UI. Failures surface as plain-language messages inside the
same chat thread, never as dead-end error screens. If a feature cannot be expressed in
that vocabulary, it does not ship to clients — it belongs in the admin surface.

### II. Nothing Reaches Production Without Explicit Human Approval

The agent may propose changes; only a human may publish them. Preview deploys are
automatic; production deploys require a client pressing "Approve & Deploy". Every
approval and every undo is recorded in an immutable audit log with actor, target, and
timestamp. There is no auto-merge, no scheduled deploy, and no agent-initiated
production write, in any code path.

### III. The Policy Gate Is Machine-Enforced, Not Model-Enforced (NON-NEGOTIABLE)

Repository owners declare what the agent may and may not touch. Those limits are
enforced by the system after the agent finishes and before any push — by validating the
produced diff against declared path globs and change limits — never by prompt
instruction alone. The agent process holds no credential that can write to a remote.
Prompt-level rules (AGENTS.md) are a usability layer; the diff gate is the security
boundary. A change that violates the policy is discarded, not negotiated.

### IV. Test-First (NON-NEGOTIABLE)

TDD is mandatory: write the failing test, get it approved, watch it fail, then
implement. The policy gate, the job state machine, and every authorization rule ship
with tests written before their implementation. Agent behavior is tested against recorded fixtures,
never against live client repositories.

### V. Observability and Cost Accountability

Every job emits an ordered stream of stage transitions, agent output, diff summary, and
deploy status while it runs. Live output may be ephemeral; the job's outcome may not be.
Every finished job writes a durable record of what it did, what it changed, and what it
cost, attributable to a site and an organization, into a system of record that outlives
the process. Errors are recorded with the job identifier, the site, and the stage. If a
finished job's outcome cannot be reconstructed after a restart, the observability is
incomplete.

### VI. One Installation, One Website

The product is installed once per website, the way a self-hosted content management system
is. An installation knows about one site, holds credentials for one site, and can be
pointed at no other. Isolation between clients is therefore structural: there is no second
client's data present to leak, and no partitioning logic to get wrong. Every request is
authorized at a single choke point against the identities that installation is configured
for. Agent execution is sandboxed per job, with no network access to version control and
no long-lived credentials. The credential that can change an installation's configuration
is stronger than the credential that can use it.

### VII. State Lives Where It Already Lives

The version control system and the hosting provider are the system of record. Pending
changes, conversation history, published state, and the audit trail are read from them
rather than mirrored into an application database. Phase 1 introduces no application
database: durable state is limited to the installation's own configuration — which site it
manages and who may sign in. Anything else the product needs is either derived on read from
the systems above, written back to them, or accepted as ephemeral. A datastore is added
only against a named, observed pain — not in anticipation of one — and the decision is
recorded when it is made.

### VIII. Ship the Smallest Thing That Proves the Loop

Scope is defended, not accumulated. The product's value is the loop — ask, preview,
approve, live. Anything that does not shorten, harden, or clarify that loop waits.
Deferred by explicit decision, not oversight: visual element picking, self-serve
onboarding, container-side builds, multi-model routing, billing, and any application
datastore.

## Operational Constraints

**Hosting model.** One installation per client website. Phase 1 installations are hosted
and operated by the maintainer on clients' behalf, but the same artifact must be
installable by any developer for their own client: no dependency on a proprietary
orchestration service, and job execution behind a runner interface whose default
implementation runs on plain Docker. Operating several instances, and rolling updates
across them, is the accepted cost of structural isolation.

**Credentials.** Repository write access is via a scoped GitHub App with short-lived
installation tokens minted per job. Per-site third-party tokens live in a secrets vault
and are decrypted only inside the job worker. No client-supplied long-lived personal
access tokens.

**Change unit.** One chat thread maps to one branch and one pull request. Follow-up
messages add commits to that branch and refresh the same preview. Approval merges the
pull request. Undo reverts the merge and rebuilds production, so repository state and
live state never diverge.

**Concurrency.** At most one in-flight job per site. Subsequent requests queue. The
mechanism is chosen at planning time and must not require an application database at
phase-1 scale.

**Latency budget.** Median time from client message to a live preview URL is under four
minutes. Stage-by-stage progress is streamed so first meaningful feedback arrives within
sixty seconds. Regressions past this budget are treated as defects.

## Development Workflow

- Specification precedes planning; planning precedes tasks; tasks precede code. Technical
  design decisions do not belong in the specification.
- Every pull request states which principles it touches and how it complies.
- The policy gate, authentication, authorization, and the job state machine require tests
  that fail before the implementation exists.
- Complexity must be justified in writing against Principle VII, or removed.
- Client-facing copy is reviewed against Principle I before merge.

## Governance

This constitution supersedes other practices and conventions in this repository. Where a
plan, task, or review conflicts with it, the constitution wins and the conflicting
artifact is revised.

Amendments require: a written rationale, a version bump under the policy below, and an
update to any dependent templates in the same change. Principles marked NON-NEGOTIABLE
may not be waived for expediency, deadlines, or pilot demos; they may only be amended by
an explicit, documented amendment.

Versioning follows semantic rules: MAJOR for removing or redefining a principle, MINOR
for adding a principle or materially expanding guidance, PATCH for clarifications that
do not change meaning.

**Version**: 1.2.0 | **Ratified**: 2026-09-02 | **Last Amended**: 2026-09-02

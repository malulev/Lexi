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
implement. The policy gate, the job state machine, and every RLS rule ship with tests
written before their implementation. Agent behavior is tested against recorded fixtures,
never against live client repositories.

### V. Observability and Cost Accountability

Every job emits an ordered, append-only event stream: stage transitions, agent output,
diff summary, deploy status. Every job records model, token counts, and cost in USD,
attributable to a site and an organization. Errors are logged with the job id, site id,
and stage. If a job's outcome cannot be reconstructed from stored events after the fact,
the observability is incomplete.

### VI. Tenant Isolation by Default

Isolation is enforced at the database layer through row-level security keyed on
organization membership, not by application code remembering to filter. Secrets are
never stored in ordinary tables. Agent execution is sandboxed per job, with no network
access to version control and no long-lived credentials. A bug in a route handler must
not be able to leak one client's data to another.

### VII. Ship the Smallest Thing That Proves the Loop

Scope is defended, not accumulated. The product's value is the loop — ask, preview,
approve, live. Anything that does not shorten, harden, or clarify that loop waits.
Deferred by explicit decision, not oversight: visual element picking, self-serve
onboarding, container-side builds, multi-model routing, billing.

## Operational Constraints

**Hosting model.** Phase 1 is hosted and operated by the maintainer for a small set of
pilot clients. The architecture must nonetheless remain self-hostable: no dependency on
a proprietary orchestration service, and job execution behind a runner interface whose
default implementation runs on plain Docker.

**Credentials.** Repository write access is via a scoped GitHub App with short-lived
installation tokens minted per job. Per-site third-party tokens live in a secrets vault
and are decrypted only inside the job worker. No client-supplied long-lived personal
access tokens.

**Change unit.** One chat thread maps to one branch and one pull request. Follow-up
messages add commits to that branch and refresh the same preview. Approval merges the
pull request. Undo reverts the merge and rebuilds production, so repository state and
live state never diverge.

**Concurrency.** At most one in-flight job per site, enforced by a database constraint
rather than by application logic. Subsequent requests queue.

**Latency budget.** Median time from client message to a live preview URL is under four
minutes. Stage-by-stage progress is streamed so first meaningful feedback arrives within
sixty seconds. Regressions past this budget are treated as defects.

## Development Workflow

- Specification precedes planning; planning precedes tasks; tasks precede code. Technical
  design decisions do not belong in the specification.
- Every pull request states which principles it touches and how it complies.
- The policy gate, authentication, RLS, and the job state machine require tests that fail
  before the implementation exists.
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

**Version**: 1.0.0 | **Ratified**: 2026-09-02 | **Last Amended**: 2026-09-02

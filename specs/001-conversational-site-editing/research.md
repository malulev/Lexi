# Phase 0 Research: Conversational Site Editing

**Date**: 2026-09-02 | **Feature**: 001-conversational-site-editing

Each entry resolves an unknown that blocked the technical context. Verified facts are
marked as such; inferences are labelled as assumptions to be confirmed in implementation.

## R1. Running the coding agent non-interactively

**Decision**: Invoke OpenCode as `opencode run --model <provider/model> --format json --auto
"<prompt>"` inside the job container, reading its stdout as a stream of JSON events.

**Verified**: `opencode run` is the documented non-interactive form. `--model` takes
`provider/model`, `--format json` emits raw JSON events rather than formatted text, `--auto`
auto-approves permissions not explicitly denied, and `--agent` selects a named agent.
`OPENCODE_CONFIG` points at a config file. OpenCode reads `AGENTS.md` from the repository as
project instructions, falling back to `CLAUDE.md`.

**Rationale**: `--format json` gives parseable stage and tool events for the progress stream
without scraping human-formatted output. `--auto` is required because no human is present to
approve tool calls; the safety boundary is the post-run diff gate, not interactive approval.

**Consequences**: The prompt must carry the conversation history explicitly, since each job
runs in a fresh container with no session continuity. `--continue`/`--session` are not usable
across containers without shared state, which we do not have.

**Alternatives considered**: `opencode serve` with a long-lived HTTP server per site — keeps
sessions but turns the container into a stateful service and conflicts with per-job isolation.
Writing a bespoke agent loop against OpenRouter — maximum control, but re-implements repository
navigation and tool use that OpenCode already provides.

## R2. Preventing the agent from pushing

**Decision**: The container receives the repository as a plain working tree with no git remote
and no credentials. It commits locally. The worker, outside the container, inspects the diff,
then pushes.

**Rationale**: Principle III requires the gate be structural. A container holding a token can
push before the gate runs, no matter what the prompt says. Removing the remote makes pushing
impossible rather than forbidden.

**Consequences**: The container still needs outbound network to reach the model provider.
Network egress should be restricted to the model provider's host; where that restriction is not
practical, the absence of credentials remains the enforced boundary and the network restriction
is defence in depth.

## R3. Single-flight lock without shared storage

**Decision**: Claim a git reference in the site's repository — `refs/webagent/lock` — created
through the version control API before a job starts, deleted when it ends.

**Verified**: Creating a reference that already exists is rejected by the GitHub API with 422
rather than silently overwriting, which makes reference creation a compare-and-swap.

**Rationale**: The lock lives in the same system as everything else, is visible to every
process, and survives a restart of the product.

**Consequences**: A crashed job leaves the reference behind. The reference points at a commit
whose committer date gives its age; a lock older than the maximum job duration is treated as
abandoned, broken, and the breakage recorded. Two API calls are added per job.

**Alternatives considered**: In-process lock — correct only for a single process, and silently
wrong afterwards. No lock, relying on the interface — a stale browser tab defeats it.

## R4. Preview builds and their status

**Decision**: Rely on the client's existing Netlify site building Deploy Previews for pull
requests. Subscribe to outgoing webhook notifications for deploy events; identify the deploy
belonging to a conversation by its pull request number, falling back to the commit reference.

**Verified**: Netlify emits distinct outgoing webhook events for deploy started, deploy
succeeded, deploy failed, deploy locked, deploy unlocked, deploy restored, and deploy deleted.
The webhook body is a JSON representation of the object relevant to the event. Pull request
events trigger Deploy Previews on a linked site.

**Assumption to confirm in implementation**: the deploy object carries the fields needed to
correlate a deploy with a conversation — its state, its context, the commit reference, the
review identifier, the deploy URL, and an error message on failure. The exact field names must
be confirmed against a live payload before the correlation logic is written; the fallback is
polling the site's deploy list and matching on commit reference.

**Consequences**: Preview availability depends on the client's Netlify site being linked to the
repository with Deploy Previews enabled. That becomes an installation prerequisite, checked at
startup by Principle-driven configuration validation (FR-003b).

## R5. Publishing and undoing

**Decision**: Publish by merging the pull request. Undo by reverting the merge commit on the
default branch and letting the resulting production build deploy.

**Rationale**: FR-029 requires the public site and the source of truth to return to their prior
state together. Netlify offers restoring a previous deploy, which reverts the site but not the
repository; the next unrelated deploy would then reintroduce the change.

**Consequences**: Undo takes a production build cycle rather than seconds. Netlify's restore of
the previous deploy may additionally be used as an immediate stopgap while the revert builds,
but the revert is what makes the states agree.

## R6. Authentication with no datastore

**Decision**: Two distinct paths.

- **Clients** sign in by email magic link. The permitted addresses are read from the site's
  settings file. The link carries a short-lived token signed with a server-held key; the
  session is a signed cookie. Nothing per-user is stored.
- **Configuration access** requires a password verified against a hash supplied as deployment
  configuration, combined with a time-based one-time code whose shared secret is likewise
  deployment configuration.

**Rationale**: Magic links need no per-user secret at rest, which is what makes them compatible
with having no datastore. FR-003a demands a stronger credential for configuration; a password
hash plus a time-based code satisfies "password with a second factor" using only deployment
configuration.

**Consequences**: Passkeys were preferred in clarification. A passkey requires storing a
credential public key and, ideally, a signature counter. The public key is not secret and could
live in the settings file in the repository, but the counter cannot be updated without writes.
Passkey support is therefore deferred; the accepted phase-1 form is password plus time-based
code. This is a deliberate narrowing of the clarified answer and is recorded as such.

**Alternatives considered**: Provider-hosted authentication — introduces an external identity
store, which is state, and adds a dependency the installation does not otherwise need.

## R7. Streaming progress to the browser

**Decision**: Server-sent events from a route handler running on the Node runtime, fed by the
container's stdout. Reconnection replays the durable record of finished steps, then resumes the
live stream.

**Rationale**: Progress is one-directional and text-shaped; server-sent events need no
additional protocol or dependency. Streaming requires the Node runtime, not an edge runtime.

**Consequences**: Live output is bound to the process that owns the job. If that process dies,
the client sees the conversation reload from durable records and the request marked failed by
the stale-lock path. This is the accepted consequence of ephemeral live output (FR-009).

## R8. Repository fetch strategy

**Decision**: Maintain a bare mirror per installation on the host, updated by fetch, and create
a fresh working tree per job from it.

**Rationale**: Cloning a large repository on every request adds seconds to a latency budget
whose median target is four minutes end to end. A mirror makes the repository step
approximately constant.

**Consequences**: The mirror is a cache, not state: deleting it costs time, not correctness. It
must be treated as such — never read as a source of truth, and rebuilt automatically when
missing or corrupt.

## R9. The settings and policy files

**Decision**: A single directory in the site's repository, `.webagent/`, holding
`config.yml` (permitted sign-ins, alert contact, cost ceiling, model), `policy.yml` (allowed
and denied paths, change limits), and the site's `AGENTS.md` guidance is read from the
repository root as OpenCode already expects.

**Rationale**: FR-003c places non-secret settings in the repository. Keeping them adjacent to
the policy means one place for a developer to look, and one path for the gate to protect.

**Consequences**: `.webagent/` must be denied to the agent unconditionally, ahead of any
site-declared policy, per FR-003e. A malformed `config.yml` must leave the last valid settings
in force (FR-003f), which means settings are read and validated at startup and on change, not
per request.

## R10. Cost accounting

**Decision**: Read cost from the model provider's reported usage for each run, recorded into
the durable pull request comment. Per-installation attribution follows from each installation
holding its own provider credential.

**Consequences**: There is no cross-installation cost view, by design. The cost ceiling
(FR-014) is enforced per request, from the usage reported for that request, and cannot account
for spend across concurrent installations.

## Open items carried into implementation

- **OD-004**: Notification idempotency without a delivery record. Candidate approach: derive a
  deterministic identifier from the conversation and the event, and record its delivery in the
  same durable comment that already records the request outcome, so a repeated send is
  detectable by reading what is already there.
- Netlify deploy payload field names (R4).
- Whether egress restriction to the model provider is practical in the target Docker
  environment (R2).

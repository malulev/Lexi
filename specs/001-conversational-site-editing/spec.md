# Feature Specification: Conversational Site Editing with Preview and One-Click Deploy

**Feature Branch**: `001-conversational-site-editing`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "A visual, AI-powered website manager. Phase 1: a non-technical client opens a chat, describes a change to their live website in plain language, an autonomous agent implements it, the client reviews a private preview, and publishes it live with one click."

## Clarifications

### Session 2026-09-02

- Q: Where does a finished request's durable record live, given there is no application database? (OD-002) → A: One pull request comment per finished request, carrying a plain-language summary for people plus an embedded machine-readable block for the dashboard.
- Q: With the interface already preventing a second request while one is running, is a system-level lock still wanted? (OD-003) → A: Yes. The interface disables further input, and behind it the worker claims an exclusive, atomically created marker in the site's repository before starting, releasing it when the request ends.
- Q: Where does the sites-and-permitted-users configuration live, and how is it edited? (OD-001) → A: The question dissolves: the product is installed once per website, the way a self-hosted content system is. A developer installs and configures it for one client site; there is no multi-site administration and no tenancy.
- Q: How does the person with configuration privileges authenticate? → A: A passkey, or a password with a second factor. This credential can change a live website, so a single password is insufficient.
- Q: Where do post-install settings live — permitted sign-ins, cost ceiling, alert contact? (OD-006) → A: In the site's own repository alongside the declared policy and agent guidance, with secrets remaining in deployment configuration. The agent is forbidden from editing that location.
- Q: Which conditions should trigger reconsidering the no-database decision? (OD-005) → A: None during the minimum viable product. It ships with no datastore. A requirement that appears to need one is dropped from scope rather than met by adding storage, and the decision is revisited only after the loop is proven.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Request a change and see it in a preview (Priority: P1)

A non-technical client signs in, opens the site they own, and types a change request in
plain language — "make the headline on the homepage shorter and change the button colour
to dark blue". The system acknowledges the request and shows progress in the same
conversation: it is reading the site, then editing, then building a preview. Within a few
minutes the conversation shows a summary of what changed in plain language and a private
preview link the client can open and interact with. The client can view that preview at
desktop and mobile widths. The client's public website is untouched.

**Why this priority**: This is the product. Without it there is nothing to preview and
nothing to approve. It is the smallest slice that delivers standalone value — even with
no publishing step, a client can commission changes and see them, and their developer can
publish manually.

**Independent Test**: Sign in as a client of a connected site, send one change request,
and confirm a working preview URL appears in the conversation showing the requested
change, while the public site remains unchanged.

**Acceptance Scenarios**:

1. **Given** a client signed in with a connected site, **When** they send a change
   request, **Then** the conversation shows an acknowledgement and a visible progress
   stage within 10 seconds.
2. **Given** a request is being worked on, **When** the client watches the conversation,
   **Then** stage changes (reading, editing, building) appear as they happen without a
   page refresh.
3. **Given** the agent finished successfully, **When** the preview build completes,
   **Then** the conversation shows a plain-language summary of the change and a preview
   link that renders the requested change.
4. **Given** a preview is shown, **When** the client switches to mobile width, **Then**
   the same preview renders at a mobile viewport inside the dashboard.
5. **Given** a client sends a follow-up message in the same conversation, **When** the
   agent finishes, **Then** the same preview link updates to include both changes rather
   than producing a second, competing preview.
6. **Given** a request is already in progress for a site, **When** the client sends
   another message, **Then** the new request is queued and shown as waiting, and starts
   only after the first finishes.

---

### User Story 2 - Approve and publish, with a way back (Priority: P2)

The client is happy with the preview and presses "Approve & Deploy". The conversation
shows that the change is publishing, then confirms it is live and links to the public
site. If the client later realises the change was wrong, the same conversation offers
"Undo this deploy", which returns the public site to its previous state and confirms
when the reversal is live.

**Why this priority**: Publishing is what makes the loop self-service, but the loop still
delivers value without it (the developer can publish). Undo is bundled here because a
non-technical client will not press a publish button they cannot take back.

**Independent Test**: With an approved preview, press Approve & Deploy and confirm the
public site shows the change; then press Undo and confirm the public site returns to its
prior content.

**Acceptance Scenarios**:

1. **Given** a conversation with a ready preview, **When** the client presses "Approve &
   Deploy", **Then** the conversation shows publishing progress and, on completion, a
   confirmation with the public site link.
2. **Given** a change was published, **When** the client presses "Undo this deploy",
   **Then** the public site returns to the state before that change and the conversation
   confirms the reversal is live.
3. **Given** a conversation has been published, **When** the client opens it again,
   **Then** it is clearly marked as published and no longer offers "Approve & Deploy".
4. **Given** any approval or undo, **When** the record is inspected afterwards, **Then**
   the acting person, the site, the change, and the time are recorded and cannot be
   altered.
5. **Given** a preview build failed, **When** the client views the conversation, **Then**
   no approval control is offered.

---

### User Story 3 - Developer-declared limits on what may change (Priority: P2)

The developer responsible for a site declares, inside the site's own repository, what the
agent may touch and what it must never touch, plus site-specific guidance such as brand
rules and tone. When a client's request would change something forbidden, the system
discards the work before it reaches the site's repository and tells the client, in plain
language, that their developer has protected that part of the site.

**Why this priority**: Equal in priority to publishing, because publishing without limits
is what makes the product unsafe to put in front of a real client's live site. It is
separately testable and separately valuable.

**Independent Test**: Add a declared limit to a test repository, send a request that
violates it, and confirm nothing is written to the repository and the client sees a clear
blocked message.

**Acceptance Scenarios**:

1. **Given** a site declaring forbidden areas, **When** the agent's work touches one,
   **Then** the work is discarded, nothing is written to the site's repository, and the
   conversation explains which area is protected.
2. **Given** a site declaring a limit on how much may change at once, **When** the agent
   exceeds it, **Then** the change is blocked with a plain-language explanation.
3. **Given** a site with written guidance about brand and tone, **When** the agent works,
   **Then** that guidance is supplied to the agent as part of its instructions.
4. **Given** a site that declares no limits, **When** the agent works, **Then** a safe
   default set of protected areas still applies.
5. **Given** a blocked request, **When** the client rephrases within the allowed areas,
   **Then** the request proceeds normally.

---

### User Story 4 - A developer installs the product for one client site (Priority: P3)

A developer deploys their own instance of the product for a single client website. They
point it at that site's code repository and its hosting, grant the access it needs, and
set who may sign in. They hand the client a URL and a sign-in. Nothing about the install
is shared with any other client or site.

**Why this priority**: The first install can be configured by hand while the loop is being
proven, but every client after the first depends on this being repeatable and documented.

**Independent Test**: Follow the installation instructions from nothing to a running
instance connected to a test site, sign in as the configured client user, and complete a
change request end to end.

**Acceptance Scenarios**:

1. **Given** a developer with access to a client's repository and hosting, **When** they
   follow the installation instructions, **Then** they reach a running instance connected
   to exactly that one site.
2. **Given** a running instance, **When** the configured client signs in, **Then** they
   see that site's conversations and nothing else exists to see.
3. **Given** an instance, **When** anyone attempts to reconfigure which site it manages
   without the configuration credential, **Then** the attempt fails.
4. **Given** the instance's access to the repository is revoked, **When** a request runs,
   **Then** it fails with a clear message identifying the missing access, and no partial
   change is published.
5. **Given** an installation is misconfigured — unreachable repository, wrong hosting
   reference — **When** it starts, **Then** it reports the specific misconfiguration rather
   than failing at the first client request.

---

### User Story 5 - Failures stay inside the conversation (Priority: P3)

When something goes wrong — the agent cannot complete the request, the preview fails to
build, or hosting is unreachable — the client sees a plain-language message in the same
conversation explaining what happened and what they can do next. They can reply to try
again. Nothing about the failure requires reading code or logs.

**Why this priority**: The loop works without polished failure handling, but pilot trust
does not survive dead ends. Testable independently by forcing each failure class.

**Independent Test**: Force an agent timeout, a failing preview build, and an unreachable
host, and confirm each produces a distinct, plain-language message in the conversation
with the conversation still usable.

**Acceptance Scenarios**:

1. **Given** the agent exceeds its time limit, **When** the job ends, **Then** the
   conversation says the request could not be completed in time and invites a simpler or
   more specific instruction.
2. **Given** the preview build fails, **When** the client views the conversation, **Then**
   they see that the change broke the site build and that the agent can attempt a fix,
   and their next message includes that failure context automatically.
3. **Given** the client's browser disconnects mid-job, **When** they return, **Then** the
   conversation shows the complete history of what happened while they were away, in
   order and without gaps.
4. **Given** any failure, **When** the client looks at their public website, **Then** it
   is unchanged.

### Edge Cases

- Two people signed in to the same installation send requests at the same time: the second is refused with a plain-language explanation that a change is already
  being applied, and both see the same shared conversation state.
- A client's browser holds a stale page that still allows typing while a request is in
  progress: the submission is refused by the system, not merely by the interface.
- A request crashes without releasing its exclusive marker: the next request proceeds once
  the marker is older than the maximum request duration.
- A client opens two conversations for the same site and publishes both: the second
  publish must incorporate the first, or be blocked as out of date rather than silently
  reverting it.
- A request is ambiguous ("make it pop"): the agent asks a clarifying question in the
  conversation rather than guessing destructively.
- A request is outside the product's remit ("connect my Stripe account"): the client is
  told this needs their developer.
- The site's repository has changed since the conversation's branch was created: the
  change is rebuilt against the current state before publishing, or the client is told it
  is out of date.
- A hosting build succeeds but produces a blank or broken page: the preview is still
  shown; the client is the judge, and undo exists after publish.
- Repository access is revoked mid-job.
- A published conversation is reopened with a new request: it starts a fresh change rather
  than reusing a merged one.
- The settings file is edited into an invalid state: the installation keeps running on the
  last valid settings and reports the fault, rather than admitting everyone or no one.
- A client request would, if satisfied, require editing the settings or policy themselves:
  the request is refused and the client is told this needs their developer.
- The agent produces no changes at all: the client is told nothing needed changing, and
  no empty preview is created.
- The agent's cost for a single request exceeds a configured ceiling: the job stops and
  the installation's configured contact is alerted.

## Requirements *(mandatory)*

### Functional Requirements

**Installation, access, and configuration**

- **FR-001**: System MUST require authentication for all surfaces.
- **FR-001a**: An installation MUST manage exactly one website. Isolation between clients
  is achieved by separate installations, not by partitioning within one.
- **FR-002**: System MUST restrict every surface to the identities configured for that
  installation, and MUST hold no data belonging to any other site.
- **FR-003**: A developer MUST be able to configure, for an installation, the site's code
  repository, its hosting, and the identities permitted to sign in.
- **FR-003a**: Configuration changes MUST require a credential distinct from and stronger
  than a client sign-in — a passkey, or a password combined with a second factor — because
  that credential can redirect the installation at a different website.
- **FR-003b**: System MUST validate its configuration at startup and report a specific,
  actionable error for each unreachable or invalid setting, rather than failing at the
  first client request.
- **FR-003c**: Non-secret settings — permitted sign-ins, cost ceiling, alert contact —
  MUST be read from a declared location in the site's own repository, alongside the site's
  policy and agent guidance, so that changing them is a reviewable, versioned edit rather
  than a redeployment.
- **FR-003d**: Secrets MUST NOT be stored in the site's repository. They MUST be supplied
  as deployment configuration.
- **FR-003e**: System MUST forbid the agent from changing the declared location holding
  settings, policy, and agent guidance, regardless of what a site's own policy declares.
  A change that governs the agent may not be authored by the agent.
- **FR-003f**: System MUST detect an invalid or unparseable settings file and MUST
  continue running on the last valid settings it holds, reporting the fault to the alert
  contact, rather than failing open on access control.
- **FR-004**: Clients MUST NOT be exposed to repository, hosting, or branch configuration.

**Conversation and change requests**

- **FR-005**: Clients MUST be able to open a conversation about a site and send change
  requests in natural language.
- **FR-006**: System MUST treat one conversation as one accumulating change: follow-up
  messages refine the same pending change and refresh the same preview.
- **FR-007**: System MUST allow at most one request per site to be in progress at a time.
- **FR-007a**: System MUST prevent a client from submitting a further request while one is
  in progress for that site, by disabling message entry and stating plainly why it is
  unavailable. Requests are not queued in this phase.
- **FR-007b**: System MUST additionally enforce single-flight independently of the
  interface, by acquiring an exclusive marker for the site that is created atomically —
  such that a second attempt observably fails rather than proceeding — and releasing it
  when the request ends. Enforcement MUST hold across separate processes and MUST survive
  a process restart.
- **FR-007c**: System MUST recover from a marker left behind by a crashed request by
  treating a marker older than the maximum request duration as abandoned, and MUST record
  when it does so.
- **FR-008**: System MUST stream progress stages for an in-flight request to all viewers
  of that conversation without requiring a page refresh.
- **FR-009**: System MUST retain a durable, ordered history of every completed step of a
  conversation, including outcomes and failures, so a client returning later — including
  after a restart of the system — sees what happened and why. Live output produced while a
  request is running MAY be ephemeral, provided its outcome is recorded durably when the
  request ends.
- **FR-009a**: System MUST record each finished request as a single durable entry against
  that conversation's pending change, containing both a plain-language summary readable by
  a person and a machine-readable block sufficient for the dashboard to reconstruct the
  request's stages, outcome, extent of change, and cost without re-running it.
- **FR-009b**: System MUST reconstruct a conversation's client-facing history solely from
  those durable entries and the state of the pending change, holding no history of its
  own.
- **FR-010**: System MUST present a plain-language summary of what changed, and MUST NOT
  require the client to read code, diffs, file paths, or build logs.

**Agent execution**

- **FR-011**: System MUST implement each request by running an autonomous coding agent
  against a working copy of the site's code, supplying the conversation history and any
  site-specific guidance declared in the repository.
- **FR-012**: System MUST enforce a maximum duration for a single request and MUST end the
  attempt cleanly when exceeded.
- **FR-013**: System MUST make the model used, tokens consumed, and cost of each request
  retrievable for the installation's site. The record MAY live in an external system
  rather than in the product; per-client separation follows from each installation using
  its own model provider credential.
- **FR-014**: System MUST stop a request and raise an alert to the installation's
  configured contact when its cost exceeds a configured ceiling.
- **FR-015**: The agent's execution environment MUST NOT hold any credential capable of
  writing to the site's repository or hosting.

**Policy enforcement**

- **FR-016**: System MUST read a machine-readable policy declared in the site's repository
  specifying which paths may be changed, which are forbidden, and limits on the size of a
  single change.
- **FR-017**: System MUST validate the agent's proposed change against that policy after
  the agent finishes and before anything is written to the site's repository.
- **FR-018**: System MUST discard a proposed change that violates the policy, MUST NOT
  write it to the repository, and MUST explain the block to the client in plain language
  naming the protected area.
- **FR-019**: System MUST apply a default protective policy — at minimum covering
  environment and secret files, dependency manifests and lockfiles, continuous integration
  and hosting configuration, and the location holding the site's settings, policy, and
  agent guidance — when a site declares none. The protection of that last location is not
  waivable by a site's own policy.
- **FR-020**: System MUST supply repository-declared written guidance to the agent as
  instructions, while treating the machine-readable policy as the enforced boundary.

**Preview**

- **FR-021**: System MUST produce a private preview of the pending change, isolated from
  the public website.
- **FR-022**: System MUST show the preview inside the dashboard and MUST allow the client
  to view it at desktop and mobile widths and to interact with it.
- **FR-023**: System MUST report preview build failures to the conversation in plain
  language and MUST make the failure detail available to the agent on the next attempt.
- **FR-024**: System MUST NOT alter the public website at any point before approval.

**Approval, publish, and undo**

- **FR-025**: Any client identity configured for the installation MUST be able to approve
  and publish a pending change.
- **FR-026**: System MUST publish only on explicit human approval; no change may reach the
  public website automatically.
- **FR-027**: System MUST offer approval only when a successful preview exists for the
  pending change.
- **FR-028**: System MUST confirm in the conversation when the change is live and link to
  the public website.
- **FR-029**: System MUST offer a one-click undo for a published change that returns both
  the public website and the site's source of truth to their prior state.
- **FR-030**: System MUST detect when a pending change is based on an outdated version of
  the site and MUST either update it before publishing or block publishing with a clear
  explanation.
- **FR-031**: System MUST record every approval and undo with actor, site, change, and
  timestamp, in a form that cannot be altered after the fact and that survives loss of the
  running system.

**Notifications**

- **FR-032**: System MUST notify the requesting client by email when a preview becomes
  ready, when a request fails, and when a publish completes, so they need not keep the
  page open.

**Failure handling**

- **FR-033**: System MUST express every failure as a message in the affected conversation
  and MUST leave the conversation usable for a follow-up attempt.
- **FR-034**: System MUST ensure that a failure at any stage leaves the public website
  unchanged and leaves no partially applied change in the site's repository.
- **FR-035**: System MUST ask a clarifying question in the conversation, rather than
  guessing, when a request is too ambiguous to implement safely.

### Key Entities

- **Installation**: One deployment of the product, serving exactly one website. The unit
  of isolation, of configuration, and of cost.
- **Configuration**: The installation's settings — which repository, which hosting, which
  identities may sign in, which limits apply. Changed only with the configuration
  credential.
- **User**: A person who signs in to an installation. Either a client, who may request and
  publish changes, or a developer, who may also change configuration.
- **Site**: The one website an installation manages. Holds its code repository, its
  hosting, its public address, and its effective policy.
- **Conversation**: An ordered exchange about one site that accumulates into a single
  pending change. Has a lifecycle: open, published, or closed.
- **Message**: One entry in a conversation, authored by a client, the agent, or the
  system. System messages carry progress and failures.
- **Request (job)**: One attempt by the agent to satisfy a message. Has a stage, an
  outcome, a duration, and a recorded cost.
- **Request event**: An ordered record of a stage change or agent output within a request.
  Drives streamed progress while the request runs; its durable residue is the outcome
  recorded when the request ends.
- **Preview**: A private, viewable build of a pending change, with its status and address.
- **Publication**: A record of a change made public, and of any undo applied to it.
- **Policy**: The declared, machine-readable limits on what a site's agent may change.
  Lives in the site's repository beside the site's settings and agent guidance, in a
  location the agent itself may never edit.
- **Audit record**: An unalterable record of who approved, published, or undid what, and
  when.

Entities describe concepts the product reasons about, not storage. Where an entity already
exists in the version control system or the hosting provider, it is read from there rather
than duplicated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A client with no technical background completes their first change — from
  typing the request to a live published update — without assistance and without
  encountering code, file names, or build logs.
- **SC-002**: The median time from sending a request to a viewable preview is under 4
  minutes; the 90th percentile is under 8 minutes.
- **SC-003**: The first visible progress feedback appears within 10 seconds of sending a
  request, and a meaningful stage update within 60 seconds.
- **SC-004**: Across a pilot period, zero changes reach any public website without a
  recorded human approval.
- **SC-005**: Across a pilot period, zero changes are written to a client repository in
  violation of that site's declared policy.
- **SC-006**: At least 70% of change requests reach a preview the client approves without
  needing developer intervention.
- **SC-007**: A published change can be fully reverted within 3 minutes of a client
  pressing undo.
- **SC-008**: Every completed request has a retrievable, ordered record of its stages and
  a recorded cost.
- **SC-009**: Clients report the loop as usable without training, evidenced by at least
  three pilot clients completing changes unaided in the first month.

## Assumptions

- The product is installed once per website, in the manner of a self-hosted content
  management system. Pilot scope is 3-5 such installations, each serving one client's site,
  hosted and operated by the maintainer on the client's behalf. There is no multi-site
  administration surface and no shared instance.
- Running one installation per client is what makes isolation structural rather than
  enforced: there is no second client's data present to leak. The cost accepted in exchange
  is operating several instances and rolling updates to each, and having no view across
  clients.
- Client websites are code repositories that build to a hosted site with per-branch
  preview builds already available; the product does not provision hosting.
- Client sites vary in framework and structure; the agent locates what to change by
  reading the repository, without any build-time instrumentation of the site.
- Selecting elements by clicking on the rendered page is explicitly out of scope for this
  phase; the client describes the change in words and may name the page.
- The system verifies changes through the hosting provider's preview build rather than by
  building the site itself.
- Each site's developer is available to declare policy and guidance in the repository, and
  to handle requests beyond the product's remit.
- Installation and configuration are performed by a developer; self-service signup,
  billing, and plan limits are out of scope for this phase.
- Each installation uses its own model provider credential, which is what makes per-client
  cost attribution possible without the product tracking it. Per-client model selection is
  out of scope for this phase.
- Clients access the dashboard on desktop browsers; the dashboard itself need not be
  mobile-optimised, though previews must be viewable at mobile widths.
- The version control system and the hosting provider are the system of record. The
  product introduces no application database in this phase; durable state is limited to a
  small configuration of which sites exist and who may access them. Requirements are
  written so that they can be satisfied by reading from and writing back to those systems.
- The minimum viable product ships with no datastore of any kind. Where a requirement
  cannot be satisfied without one, it is removed from this phase rather than met by adding
  storage. Accepting that constraint means accepting its consequences at pilot scale: dashboard
  reads are bounded by third-party API latency and rate limits, concurrency control is
  process-local, and cross-site reporting is unavailable. These are acceptable for 3-5
  clients and are the trigger conditions for revisiting the decision.
- Conversation history recorded against a site's repository is visible to anyone with
  access to that repository — in practice, the site's own developer.

## Open Decisions

Deliberately unresolved here; to be settled during planning, not by assumption.

- ~~**OD-001**~~: Resolved 2026-09-02 — dissolved by the single-installation-per-site
  model. Configuration belongs to the installation and is set by the developer who installs
  it. See FR-001a and FR-003 through FR-003b. What remains open is the configuration
  surface itself, recorded as OD-006.
- ~~**OD-006**~~: Resolved 2026-09-02 — non-secret settings live in the site's own
  repository beside its policy and agent guidance; secrets stay in deployment
  configuration; the agent may not edit that location. See FR-003c through FR-003f and
  FR-019.
- ~~**OD-002**~~: Resolved 2026-09-02 — written back to the version control system as one
  comment per finished request, prose plus embedded machine-readable metadata. See FR-009a
  and FR-009b.
- ~~**OD-003**~~: Resolved 2026-09-02 — interface-level prevention plus an atomically
  created exclusive marker held in the site's repository, valid across processes, with a
  staleness timeout. See FR-007a through FR-007c.
- **OD-004**: How email notification is made idempotent without a delivery record.
  Deliberately deferred to planning: low impact, and constrained enough by the no-datastore
  decision that the options are few.
- ~~**OD-005**~~: Resolved 2026-09-02 — the minimum viable product ships with no
  datastore, and that is not revisited within its scope. A requirement that cannot be met
  without storage is dropped from this phase rather than satisfied by introducing storage.
  Trigger conditions for a later phase are deliberately not enumerated now, to avoid
  designing for a reversal that may never be needed.

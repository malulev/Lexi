# Feature Specification: Conversational Site Editing with Preview and One-Click Deploy

**Feature Branch**: `001-conversational-site-editing`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "A visual, AI-powered website manager. Phase 1: a non-technical client opens a chat, describes a change to their live website in plain language, an autonomous agent implements it, the client reviews a private preview, and publishes it live with one click."

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
no publishing step, a client can commission changes and see them, and the operator can
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
delivers value without it (the operator can publish). Undo is bundled here because a
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
4. **Given** any approval or undo, **When** an operator inspects the record, **Then**
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

### User Story 4 - Operator onboards a client and their site (Priority: P3)

The operator connects a client's website: granting the system access to the site's code
repository, linking the site's hosting so previews and publishes work, and inviting the
client by email. The client receives an invitation, signs in, and sees only their own
sites.

**Why this priority**: Needed for a second client to exist, but the first pilot can be
connected by the operator through direct configuration. Deliberately kept out of the
client-facing experience in this phase.

**Independent Test**: Connect a repository and hosting for a new site as operator, invite
an email address, and confirm that account can sign in, sees exactly that site, and sees
no other organisation's sites.

**Acceptance Scenarios**:

1. **Given** an operator with access granted to a client's repository, **When** they
   create the site record and link its hosting, **Then** the site becomes available for
   conversations.
2. **Given** a site exists, **When** the operator invites an email address, **Then** that
   person can sign in and see that site.
3. **Given** two client organisations exist, **When** a member of one is signed in,
   **Then** no data belonging to the other is reachable by any means.
4. **Given** the client's access is revoked at the repository, **When** a job runs,
   **Then** it fails with a clear operator-facing error and no partial change is
   published.

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

- Two people from the same client organisation send requests for the same site at the
  same time: the second is queued, both see the same shared conversation state.
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
- A published conversation is reopened with a new request: it starts a fresh change
  rather than reusing a merged one.
- The agent produces no changes at all: the client is told nothing needed changing, and
  no empty preview is created.
- The agent's cost for a single request exceeds a configured ceiling: the job stops and
  the operator is alerted.

## Requirements *(mandatory)*

### Functional Requirements

**Access and tenancy**

- **FR-001**: System MUST require authentication for all client-facing surfaces.
- **FR-002**: System MUST scope every site, conversation, message, and deploy record to a
  single client organisation, and MUST prevent any member of one organisation from
  reading or acting on another's data.
- **FR-003**: Operators MUST be able to create a site, associate it with a client's code
  repository and hosting, and invite client users by email.
- **FR-004**: Clients MUST NOT be exposed to repository, hosting, or branch configuration.

**Conversation and change requests**

- **FR-005**: Clients MUST be able to open a conversation about a site and send change
  requests in natural language.
- **FR-006**: System MUST treat one conversation as one accumulating change: follow-up
  messages refine the same pending change and refresh the same preview.
- **FR-007**: System MUST allow at most one request per site to be worked on at a time
  and MUST queue further requests, showing their queued state.
- **FR-008**: System MUST stream progress stages for an in-flight request to all viewers
  of that conversation without requiring a page refresh.
- **FR-009**: System MUST persist the full ordered history of a conversation, including
  progress stages and failures, so a client returning later sees exactly what happened.
- **FR-010**: System MUST present a plain-language summary of what changed, and MUST NOT
  require the client to read code, diffs, file paths, or build logs.

**Agent execution**

- **FR-011**: System MUST implement each request by running an autonomous coding agent
  against a working copy of the site's code, supplying the conversation history and any
  site-specific guidance declared in the repository.
- **FR-012**: System MUST enforce a maximum duration for a single request and MUST end the
  attempt cleanly when exceeded.
- **FR-013**: System MUST record, per request, the model used, tokens consumed, and cost,
  attributable to the site and organisation.
- **FR-014**: System MUST stop a request and alert the operator when its cost exceeds a
  configured ceiling.
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
  environment and secret files, dependency manifests and lockfiles, and continuous
  integration and hosting configuration — when a site declares none.
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

- **FR-025**: Any invited member of the owning organisation MUST be able to approve and
  publish a pending change.
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
  timestamp in an append-only audit record.

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

- **Organisation**: A client company. Owns sites and has member users. The boundary of all
  data isolation.
- **User**: A person who signs in. Belongs to an organisation as a member, or is an
  operator with administrative reach across organisations.
- **Site**: One client website. Holds the association to its code repository, its hosting,
  its public address, and its effective policy.
- **Conversation**: An ordered exchange about one site that accumulates into a single
  pending change. Has a lifecycle: open, published, or closed.
- **Message**: One entry in a conversation, authored by a client, the agent, or the
  system. System messages carry progress and failures.
- **Request (job)**: One attempt by the agent to satisfy a message. Has a stage, an
  outcome, a duration, and a recorded cost.
- **Request event**: An ordered, append-only record of a stage change or agent output
  within a request. The source of streamed progress and of after-the-fact reconstruction.
- **Preview**: A private, viewable build of a pending change, with its status and address.
- **Publication**: A record of a change made public, and of any undo applied to it.
- **Policy**: The declared, machine-readable limits on what a site's agent may change.
- **Audit record**: An immutable record of who approved, published, or undid what, and
  when.

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
  needing operator intervention.
- **SC-007**: A published change can be fully reverted within 3 minutes of a client
  pressing undo.
- **SC-008**: Every completed request has a retrievable, ordered record of its stages and
  a recorded cost.
- **SC-009**: Clients report the loop as usable without training, evidenced by at least
  three pilot clients completing changes unaided in the first month.

## Assumptions

- Pilot scope is 3-5 client organisations, each with one website; the system is hosted and
  operated by the maintainer.
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
- Onboarding is performed by the operator; self-service signup, billing, and plan limits
  are out of scope for this phase.
- One shared model provider account is used across pilot clients; per-client model
  selection is out of scope for this phase.
- Clients access the dashboard on desktop browsers; the dashboard itself need not be
  mobile-optimised, though previews must be viewable at mobile widths.

---

description: "Task list for conversational site editing"
---

# Tasks: Conversational Site Editing with Preview and One-Click Deploy

**Input**: Design documents from `/specs/001-conversational-site-editing/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included and non-optional. Constitution Principle IV makes test-first mandatory; the
policy gate, the lock, the state machine, and the authorization path each require a failing test
before implementation.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete work
- **[Story]**: US1–US5, matching spec.md user stories
- File paths are exact

## Path Conventions

Single Next.js application at repository root: `src/app/`, `src/lib/`, `tests/`, plus the agent
image under `agent/`. Per plan.md Structure Decision.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project skeleton and tooling.

- [X] T001 Initialize Next.js 15 App Router project with TypeScript 5 and Node 22 in repository root, App Router only, no `src/pages`
- [X] T002 Add dependencies to `package.json`: `octokit`, `dockerode`, `simple-git`, `zod`, `yaml`, `minimatch`, `nodemailer`, `otplib`, `argon2`
- [X] T003 [P] Configure Vitest with `vitest.config.ts` and separate `unit`, `int` projects mapped to `tests/unit` and `tests/integration`
- [X] T004 [P] Configure Playwright in `playwright.config.ts` pointing at `tests/e2e`
- [X] T005 [P] Configure ESLint and Prettier in `eslint.config.mjs` and `.prettierrc`
- [X] T006 [P] Create directory skeleton `src/lib/{config,auth,github,netlify,policy,lock,runner,mirror,record,jobs,notify}` each with an `index.ts` exporting nothing yet
- [X] T007 [P] Write `.env.example` with every variable from quickstart.md, with comments and no real values

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Everything every user story needs. No user story can start until this completes.

**⚠️ Nothing in Phase 3 onward is startable until Phase 2 is done.**

### Configuration

- [X] T008 [P] Write failing tests for the environment schema in `tests/unit/config/env.test.ts`: every required variable, rejection of malformed repository references, a non-empty `ALLOWED_EMAILS` list normalised to lower case, and a readable aggregated error naming each fault
- [X] T009 Implement the environment schema and loader in `src/lib/config/env.ts` using zod, failing fast at import time
- [X] T010 [P] Write failing tests for settings parsing in `tests/unit/config/settings.test.ts` covering valid input, unknown-field rejection, explicit rejection of an `allowedEmails` key with a message pointing to deployment configuration, and `maxRequestMinutes` bounds
- [X] T011 Implement `.webagent/config.yml` parsing and validation in `src/lib/config/settings.ts` per contracts/repo-files.md
- [X] T012 [P] Write failing tests in `tests/unit/config/cache.test.ts` proving that invalid settings leave the previously valid settings in force and surface a fault, never falling open
- [X] T013 Implement the settings cache with last-known-good retention in `src/lib/config/cache.ts` (FR-003f)

### Version control client

- [X] T014 [P] Write failing tests for installation token minting and caching in `tests/unit/github/auth.test.ts` with a clock stub, asserting refresh before expiry
- [X] T015 Implement GitHub App authentication in `src/lib/github/auth.ts`
- [X] T016 [P] Record HTTP fixtures for repository read, ref create and delete, branch push, pull request create, and comment create under `tests/fixtures/github/`
- [X] T017 Implement the repository client in `src/lib/github/client.ts`: read file, create ref, delete ref, get ref with committer date, push branch, create and update pull request, list and create comments, merge, revert
- [X] T018 [P] Write failing tests in `tests/unit/config/loader.test.ts` for reading `.webagent/config.yml`, `.webagent/policy.yml`, and `AGENTS.md` from the repository through the client
- [X] T019 Implement repository-backed configuration loading in `src/lib/config/loader.ts`

### The policy gate

- [X] T020 [P] Write failing tests for the gate in `tests/unit/policy/gate.test.ts`: unconditional denies win over site `allow`; a path matching no `allow` is denied; `maxFilesChanged` and `maxDiffLines`; `forbidNewDependencies`; and a violation naming the offending path
- [X] T021 [P] Write a failing test in `tests/unit/policy/gate.test.ts` asserting `.webagent/**` and `AGENTS.md` are denied even when a site policy explicitly allows them (FR-003e)
- [X] T022 Implement the gate as a pure function in `src/lib/policy/gate.ts` — no filesystem, no network — evaluating in the order given in contracts/repo-files.md
- [X] T023 [P] Write failing tests for policy parsing and defaults in `tests/unit/policy/parse.test.ts`, including an absent policy file yielding the documented defaults (FR-019)
- [X] T024 Implement policy parsing and defaulting in `src/lib/policy/parse.ts`

### The lock

- [X] T025 [P] Write failing tests in `tests/unit/lock/lock.test.ts`: acquisition succeeds once; a second acquisition observes rejection; release deletes the ref; a ref older than `maxRequestMinutes` is breakable; a fresh ref is not
- [X] T026 Implement `refs/webagent/lock` acquisition, release, and staleness handling in `src/lib/lock/lock.ts` (FR-007b, FR-007c)

### The durable record

- [X] T027 [P] Write failing tests in `tests/unit/record/record.test.ts`: render then parse yields the original; a comment with no marker parses as prose; an unparseable block degrades to prose rather than throwing
- [X] T028 Implement rendering and parsing of the `webagent:v1` block in `src/lib/record/record.ts` per contracts/durable-record.md
- [X] T029 [P] Write a property test in `tests/unit/record/roundtrip.test.ts` asserting render and parse are inverses across generated records

### Authentication

- [X] T030 [P] Write failing tests in `tests/unit/auth/magic-link.test.ts`: token signing and verification, expiry, single use within its window, and that an address absent from the configured `ALLOWED_EMAILS` produces no token
- [X] T031 Implement magic-link token issue and verification in `src/lib/auth/magic-link.ts`
- [X] T032 [P] Write failing tests in `tests/unit/auth/session.test.ts` for signed cookie issue, verification, tamper rejection, and expiry
- [X] T033 Implement the session cookie in `src/lib/auth/session.ts`
- [X] T034 [P] Write a failing test in `tests/unit/auth/authorize.test.ts` proving authorization is re-checked against the configured `ALLOWED_EMAILS` on every request, and a failing test proving an `allowedEmails` key in the repository settings grants nobody access (FR-003c1)
- [X] T035 Implement the single authorization choke point in `src/lib/auth/authorize.ts` (Principle VI)

### Repository working copies

- [X] T036 [P] Write failing tests in `tests/unit/mirror/mirror.test.ts` against a local temporary repository: mirror creation, fetch update, working tree creation at a branch, and rebuild when the mirror is missing or corrupt
- [X] T037 Implement the bare mirror cache and per-job working tree in `src/lib/mirror/mirror.ts` (R8)

### Job execution

- [X] T038 [P] Write failing tests in `tests/unit/runner/contract.test.ts` against a fake runner covering `start`, `logs`, `cancel`, and timeout kill
- [X] T039 Define the `JobRunner` interface and a fake implementation in `src/lib/runner/index.ts` and `src/lib/runner/fake.ts`
- [X] T040 Implement the Docker runner in `src/lib/runner/docker.ts` using dockerode: mount the working tree at `/work` and the control directory at `/control`, pass only `OPENROUTER_API_KEY` and `MODEL`, stream stdout, enforce the timeout, always destroy the container
- [X] T041 [P] Write the agent image in `agent/Dockerfile` with node and opencode pinned to explicit versions — **no git**, since the container never commits
- [X] T042 Write `agent/entrypoint.sh`: read `/control/prompt.json`, run `opencode run --model "$MODEL" --format json --auto`, edit files under `/work` only, write `/control/result.json`, exit
- [X] T043 [P] Write a failing test in `tests/unit/runner/isolation.test.ts` asserting the container receives no GitHub or Netlify credential, that the working tree has no configured git remote, and that no control file is reachable from inside `/work` (FR-015)
- [X] T043a [P] Write a failing test in `tests/unit/mirror/changeset.test.ts` asserting the change set derived from the working tree includes untracked additions and deletions, not only tracked modifications
- [X] T043b Implement working-tree change-set derivation and controlled commit in `src/lib/mirror/changeset.ts`: gate first, then stage exactly the permitted paths and commit with an author and message the host controls

### Progress plumbing

- [X] T044 [P] Write failing tests in `tests/unit/jobs/bus.test.ts` for publish, subscribe, unsubscribe, and late-subscriber behaviour
- [X] T045 Implement the in-process event bus in `src/lib/jobs/bus.ts`
- [X] T046 [P] Write failing tests in `tests/unit/jobs/state.test.ts` for the stage machine: legal transitions, every terminal stage releasing the lock and writing a record, and rejection of illegal transitions
- [X] T047 Implement the stage machine in `src/lib/jobs/state.ts`

**Checkpoint**: Foundation ready. User stories may proceed.

---

## Phase 3: User Story 1 — Request a change and see it in a preview (Priority: P1) 🎯 MVP

**Goal**: A client sends a plain-language request and receives a working preview link, with the
public site untouched.

**Independent test**: Sign in, send one change request, confirm a preview URL appears in the
conversation showing the requested change while the public site is unchanged.

### Tests

- [X] T048 [P] [US1] Write failing integration tests in `tests/integration/conversations.test.ts` for creating a conversation, posting a message, and receiving `409` when a request is already in flight (FR-007b)
- [X] T048a [P] [US1] Write a failing integration test in the same file asserting a follow-up message commits to the **same** branch and pull request, refreshing the existing preview rather than opening a competing one (FR-006, US1 acceptance 5)
- [X] T049 [P] [US1] Write failing integration tests in `tests/integration/stream.test.ts` asserting stage events are emitted in order and that reconnection replays durable records before resuming live output
- [X] T050 [P] [US1] Write failing integration tests in `tests/integration/netlify-webhook.test.ts` covering correlation by pull request number, fallback to commit reference, an uncorrelatable deploy being ignored, and repeated delivery of the same event being idempotent

### Implementation

- [X] T051 [US1] Implement the Netlify client in `src/lib/netlify/client.ts`: fetch deploys for the site, find by pull request number and by commit reference
- [X] T052 [US1] Implement webhook payload parsing and signature verification in `src/lib/netlify/webhook.ts`, tolerating unknown fields (R4 assumption)
- [X] T053 [US1] Implement prompt assembly in `src/lib/jobs/prompt.ts`: current request, conversation history from records, `AGENTS.md` guidance, optional page hint
- [X] T054 [US1] Implement the orchestrator in `src/lib/jobs/run.ts`: acquire lock, build working tree, run container, derive the change set, gate it, stage and commit, push, open or update the pull request, await preview, write the record, release the lock — releasing on every path including failure. A blocked change is discarded by deleting the working tree; nothing was committed
- [X] T055 [US1] Implement `POST /api/conversations` in `src/app/api/conversations/route.ts` creating branch `webagent/c-<number>`, opening a pull request, and starting a request
- [X] T056 [US1] Implement `GET /api/conversations` in the same file, assembling the list from pull requests
- [X] T057 [US1] Implement `GET /api/conversations/[number]` in `src/app/api/conversations/[number]/route.ts`, assembling history by parsing comments (FR-009b)
- [X] T058 [US1] Implement `POST /api/conversations/[number]/messages` in `src/app/api/conversations/[number]/messages/route.ts`, returning `409` when a request is in flight
- [X] T059 [US1] Implement `GET /api/conversations/[number]/stream` in `src/app/api/conversations/[number]/stream/route.ts` as server-sent events on the Node runtime
- [X] T060 [US1] Implement `POST /api/webhooks/netlify` in `src/app/api/webhooks/netlify/route.ts`
- [X] T061 [P] [US1] Implement the magic-link routes in `src/app/api/auth/[...route]/route.ts`, returning `202` regardless of whether the address is permitted
- [X] T062 [P] [US1] Build the sign-in page in `src/app/login/page.tsx`
- [X] T063 [US1] Build the conversation list in `src/app/(client)/page.tsx`
- [X] T064 [US1] Build the conversation view in `src/app/(client)/c/[number]/page.tsx`: messages, live progress, and message entry disabled while a request runs with a stated reason (FR-007a)
- [X] T065 [P] [US1] Build the preview panel in `src/components/PreviewPane.tsx` with desktop and mobile width toggle (FR-022)
- [X] T066 [P] [US1] Implement email notification in `src/lib/notify/email.ts`, reading `notified` from the durable record before sending and appending to it after (OD-004)

**Checkpoint**: US1 is independently deliverable. A client can commission changes and see them; publishing is manual.

---

## Phase 4: User Story 3 — Developer-declared limits (Priority: P2)

**Goal**: The gate honours site-declared policy and explains blocks in plain language.

**Independent test**: Add a limit to a test repository, send a violating request, confirm nothing
is written to the repository and the client sees a clear blocked message.

**Note**: Sequenced before US2 because publishing without enforced limits is the unsafe ordering.

### Tests

- [X] T067 [P] [US3] Write a failing integration test in `tests/integration/policy-block.test.ts` asserting a violating run pushes no branch and creates no commit, and that the record carries `blocked` with the offending path
- [X] T068 [P] [US3] Write a failing integration test in the same file asserting a request to modify `.webagent/policy.yml` is refused even when the site policy allows that path

### Implementation

- [X] T069 [US3] Wire site-declared policy loading into the orchestrator in `src/lib/jobs/run.ts`, discarding the working tree on violation
- [X] T069a [P] [US3] Write a failing test in `tests/integration/policy-block.test.ts` asserting that no control file and no agent scratch file appears in any commit, whatever the agent leaves in the working tree
- [X] T070 [US3] Implement blocked-outcome rendering in `src/lib/record/record.ts` carrying `violation` and `blockedPath`
- [X] T071 [US3] Map violations to client-facing language in `src/lib/jobs/messages.ts` per the error vocabulary in contracts/http-api.md
- [X] T072 [P] [US3] Inject `AGENTS.md` guidance into the prompt in `src/lib/jobs/prompt.ts` (FR-020)

**Checkpoint**: The gate is load-bearing and demonstrated.

---

## Phase 5: User Story 2 — Approve, publish, undo (Priority: P2)

**Goal**: A client publishes a previewed change and can reverse it.

**Independent test**: Approve a ready preview, confirm the public site shows the change; press
undo, confirm the public site returns to its prior content.

### Tests

- [X] T073 [P] [US2] Write failing integration tests in `tests/integration/approve.test.ts`: approval merges; approval is refused with `409` when no successful preview exists; approval is refused when the branch is out of date (FR-030)
- [X] T074 [P] [US2] Write a failing integration test in `tests/integration/undo.test.ts` asserting undo creates a revert on the default branch, not merely a hosting rollback

### Implementation

- [X] T075 [US2] Implement staleness detection against the default branch in `src/lib/github/staleness.ts`
- [X] T076 [US2] Implement `POST /api/conversations/[number]/approve` in `src/app/api/conversations/[number]/approve/route.ts`
- [X] T077 [US2] Implement `POST /api/conversations/[number]/undo` in `src/app/api/conversations/[number]/undo/route.ts`
- [X] T078 [US2] Add approval and undo controls to `src/app/(client)/c/[number]/page.tsx`, offering approval only with a successful preview and hiding it once published (FR-027)
- [X] T079 [P] [US2] Add publish-complete and undo-complete notifications in `src/lib/notify/email.ts`

**Checkpoint**: The full loop is client-operable.

---

## Phase 6: User Story 4 — Installation and configuration (Priority: P3)

**Goal**: A developer installs an instance for one client site, repeatably.

**Independent test**: Follow the instructions from nothing to a running instance connected to a
test site, sign in as the configured client, and complete a change request.

### Tests

- [X] T080 [P] [US4] Write failing tests in `tests/integration/startup.test.ts` asserting startup fails with a specific, actionable message for each of: unreachable repository, missing installation, and unreachable hosting site (FR-003b)
- [X] T081 [P] [US4] Write failing tests in `tests/unit/auth/config-credential.test.ts` for password verification and time-based code verification, including rejection of a valid password with a wrong code

### Implementation

- [X] T082 [US4] Implement startup validation in `src/lib/config/startup.ts`, refusing to serve on any invalid setting
- [X] T083 [US4] Implement the configuration credential in `src/lib/auth/config-credential.ts` using argon2 and otplib (FR-003a, R6)
- [X] T084 [US4] Build the configuration surface in `src/app/(config)/settings/page.tsx`, read-only over repository settings, showing effective policy and any settings fault
- [X] T085 [P] [US4] Write `docker-compose.yml` with the application, the Docker socket mount, and a note recording the socket's root-equivalence and the hardening path
- [X] T086 [P] [US4] Write `README.md` installation instructions matching quickstart.md, including the Deploy Previews prerequisite and the Netlify webhook setup

---

## Phase 7: User Story 5 — Failures stay in the conversation (Priority: P3)

**Goal**: Every failure class reads as a plain-language message, and the conversation stays usable.

**Independent test**: Force an agent timeout, a failing preview build, and an unreachable host;
confirm three distinct plain-language messages and a still-usable conversation.

### Tests

- [X] T087 [P] [US5] Write failing integration tests in `tests/integration/failures.test.ts` for agent timeout, build failure, unreachable hosting, cost ceiling, and empty diff — each producing its own vocabulary entry and leaving the public site unchanged (FR-034)
- [X] T088 [P] [US5] Write a failing test in `tests/integration/recovery.test.ts` asserting that a request abandoned by a process restart is recorded as abandoned when the stale lock is broken, and that the conversation renders it as interrupted

### Implementation

- [X] T089 [US5] Implement the failure taxonomy and its client-facing vocabulary in `src/lib/jobs/messages.ts`
- [X] T090 [US5] Implement cost-ceiling enforcement and the alert to the configured contact in `src/lib/jobs/run.ts` (FR-014)
- [X] T091 [US5] Feed preview build failure detail into the next request's prompt in `src/lib/jobs/prompt.ts` (FR-023)
- [X] T092 [US5] Implement stale-lock recovery writing an `abandoned` record in `src/lib/lock/lock.ts`
- [X] T093 [US5] Handle the empty-diff case in `src/lib/jobs/run.ts`, reporting that nothing needed changing and creating no pull request

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T094 [P] Write the end-to-end journey `tests/e2e/request-to-preview.spec.ts` against a fixture site, asserting the production URL is unchanged once the preview is ready (FR-024)
- [X] T095 [P] Write the end-to-end journey `tests/e2e/approve-and-undo.spec.ts`
- [X] T096 [P] Add timing assertions to the end-to-end journeys: first feedback within 10 seconds and a stage update within 60 (SC-003), request to preview within 4 minutes (SC-002), and undo complete within 3 minutes (SC-007)
- [X] T097 [P] Audit every client-facing string against Principle I in `tests/unit/messages.test.ts`, asserting no file paths, diffs, or build logs appear in the vocabulary
- [X] T097a [P] Write a test in `tests/unit/config/secrets.test.ts` asserting the settings schema accepts no secret-shaped field, so a secret committed to the site's repository is rejected rather than honoured (FR-003d)
- [X] T097b [P] Add a quickstart validation step confirming the approval and undo are visible in the pull request timeline and git history after publishing (FR-031)
- [X] T098 Confirm the gate module imports neither `dockerode` nor any network client, enforced by a lint rule in `eslint.config.mjs`
- [X] T099 [P] Record a real Netlify deploy payload into `tests/fixtures/netlify/` and reconcile the correlation fields with R4's assumption
- [~] T100 Walk quickstart.md end to end on a clean host and correct any step that does not work verbatim — corrected against a real installation (state directory, dotenv expansion of the argon2 hash, the webhook being optional, App permissions, the Deploy Previews failure mode, the helper scripts). A genuinely clean host has not been used, so the remaining risk is a step that only a first-time machine would trip.

---

## Dependencies

```text
Setup (T001–T007)
   └─ Foundational (T008–T047)   ← blocks everything below
         ├─ US1 (T048–T066)      P1, MVP
         │     └─ US3 (T067–T072)   P2, extends the gate US1 already uses
         │           └─ US2 (T073–T079)   P2, publishing after limits are enforced
         ├─ US4 (T080–T086)      P3, independent of US1 once Foundational is done
         └─ US5 (T087–T093)      P3, hardens paths introduced by US1 and US2
                └─ Polish (T094–T100)
```

US3 is sequenced before US2 despite equal priority: publishing without an enforced gate is the
unsafe ordering, and the spec makes both P2 precisely because they belong together.

## Parallel Opportunities

- **Setup**: T003–T007 together.
- **Foundational**: all test-writing tasks (T008, T010, T012, T014, T016, T018, T020, T021, T023, T025, T027, T029, T030, T032, T034, T036, T038, T041, T043, T044, T046) are independent files and can be written in parallel before their implementations.
- **US1**: T061, T062, T065, T066 touch separate files and can proceed alongside the route work.
- **Cross-story**: once Foundational completes, US4 can proceed alongside US1 — it shares no files.

## Implementation Strategy

**MVP is US1 alone.** It delivers a client who can commission changes and see them previewed,
with publishing done by the developer. Everything after it is an increment that can ship
separately.

**Recommended order**: Foundational → US1 → US3 → US2 → US5 → US4 → Polish. US4 is last among
the stories because the first installation can be configured by hand while the loop is proven;
it becomes urgent only for the second client.

**Test-first is not optional here.** T020–T022 in particular: the gate is the only thing standing
between an autonomous agent and a client's live website, and it is the one module that must be
correct before anything it protects exists.

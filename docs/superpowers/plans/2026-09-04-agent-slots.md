# Host-wide Agent Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap how many agent containers run on one host at once, across every client installation sharing that host's Docker daemon, and let a client see that their request is waiting its turn.

**Architecture:** The Docker daemon is the semaphore. Every agent container carries the label `webagent.agent=true`; before starting one, the orchestrator counts running containers with that label and waits (polling) while the count is at or above `MAX_CONCURRENT_RUNS`. No new service, no shared file, no stale-lock logic: a dead container drops out of the list by itself. The wait is a new request stage, `queued`, shown to the client as "Waiting for a free turn"; a wait that outlasts 15 minutes ends the request with a new error code, `too_busy`.

**Tech Stack:** TypeScript, Next.js 15, dockerode 4, Zod v4, Vitest (`unit` and `int` projects).

**Spec:** No separate spec document. Design agreed in conversation on 2026-09-04 ("Layer 2: host-wide slots, Docker as the semaphore"). This plan is the written record.

## Global Constraints

- Constitution Principle I: client-facing copy never contains a path, git vocabulary, build logs, or the words "slot", "container", "queue depth", "Docker". Every new sentence is audited by the existing vocabulary tests (`tests/unit/messages.test.ts`, `tests/unit/components/progress-trail.test.tsx`, `tests/unit/components/working-indicator.test.tsx`, `tests/unit/i18n/dictionaries.test.ts`).
- Constitution VII: no database. The daemon's container list is the only shared state.
- Every dictionary (`en`, `he`, `nl`, `fr`) is typed by one `Dictionary` interface; `stages` is `Record<RequestKind, Record<Stage, string>>` and `errors` is `Record<ErrorCode, string>`, so a missing key fails `npm run typecheck`.
- TDD: failing test first, then the smallest change that passes.
- Before every commit: `npm run typecheck && npm run lint && npm test` (unit). Integration tests: `npm run test:int -- <file>`.
- Never run `npm run build` while `next dev` is running (both write `.next/`).
- Commit messages: present tense, what and why, ending with the attribution trailer below.

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Di5VJ2B6ycxcQkGrygTg8g
```

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/config/env.ts`, `src/types/index.ts` (`Env`) | Parse `MAX_CONCURRENT_RUNS`, default 2, integers 1 to 16. |
| `src/types/index.ts` (`Stage`, `ErrorCode`) | Add `queued` stage and `too_busy` error code to the closed vocabularies. |
| `src/lib/jobs/state.ts` | Legal transitions: `starting -> queued -> running`. |
| `src/lib/record/record.ts` | Durable record schema accepts the new stage and code. |
| `src/lib/jobs/messages.ts` | Client sentence and HTTP status for `too_busy`. |
| `src/lib/i18n/{en,he,nl,fr}.ts` | Labels for `queued` (three request kinds), working lines while queued, `too_busy` sentence. |
| `src/lib/runner/slots.ts` (new) | `AgentSlots` contract, `createDockerSlots`, `UNLIMITED_SLOTS`, `AGENT_LABEL`. Pure polling logic over an injected `listContainers`. |
| `src/lib/runner/docker.ts` | Label the agent container so it can be counted. |
| `src/lib/runner/index.ts` | Re-export the slots module. |
| `src/lib/jobs/run.ts` | Wait for a slot between preparing the tree and starting the agent; end with `too_busy` on timeout. |
| `src/lib/installation.ts`, `src/lib/http/start-request.ts` | One `Docker` instance shared by runner and slots; wire `slots` into `RunDeps`. |
| `tests/integration/harness.ts` | Optional `slots` on the harness. |
| `README.md`, `docker-compose.yml`, `specs/.../data-model.md`, `specs/.../contracts/http-api.md` | Document the variable, the stage, and the code. |

Out of scope (separate follow-up, "Layer 1"): memory and CPU caps on the agent container.

---

### Task 1: `MAX_CONCURRENT_RUNS` deployment variable

**Files:**
- Modify: `src/types/index.ts:18-37` (`Env`)
- Modify: `src/lib/config/env.ts:57-113`
- Modify: `tests/integration/harness.ts` (the `ENV` literal, around line 50-66)
- Test: `tests/unit/config/env.test.ts`
- Modify: `README.md` (env section, after the `ALLOWED_EMAILS` block near line 99-104)

**Interfaces:**
- Produces: `Env.maxConcurrentRuns: number` (integer, 1 to 16, default 2).

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('parseEnv', ...)` block of `tests/unit/config/env.test.ts`:

```ts
  describe('MAX_CONCURRENT_RUNS', () => {
    it('defaults to two agents at once when unset', () => {
      expect(parseEnv(validRawEnv()).maxConcurrentRuns).toBe(2);
    });

    it('reads a positive integer', () => {
      expect(parseEnv({ ...validRawEnv(), MAX_CONCURRENT_RUNS: '4' }).maxConcurrentRuns).toBe(4);
    });

    it.each(['0', '-1', '1.5', 'two', '17'])('rejects %s', (value) => {
      expect(() => parseEnv({ ...validRawEnv(), MAX_CONCURRENT_RUNS: value })).toThrow(
        /MAX_CONCURRENT_RUNS/,
      );
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit tests/unit/config/env.test.ts`
Expected: FAIL. `maxConcurrentRuns` is `undefined`, and the rejections do not throw.

- [ ] **Step 3: Add the field to `Env`**

In `src/types/index.ts`, after `publicBaseUrl: string;` inside `Env`:

```ts
  /**
   * How many agent containers may run at once on the Docker daemon this
   * installation uses. Counted across every installation sharing that
   * daemon, not per site: the daemon is the shared resource.
   */
  maxConcurrentRuns: number;
```

- [ ] **Step 4: Parse it**

In `src/lib/config/env.ts`, add to `rawEnvSchema` after `PUBLIC_BASE_URL`:

```ts
  MAX_CONCURRENT_RUNS: z
    .string()
    .optional()
    .default('2')
    .refine((value) => /^\d+$/.test(value), 'must be a whole number')
    .transform(Number)
    .refine((value) => value >= 1 && value <= 16, 'must be between 1 and 16'),
```

And in `toEnv`, after `publicBaseUrl: data.PUBLIC_BASE_URL,`:

```ts
    maxConcurrentRuns: data.MAX_CONCURRENT_RUNS,
```

- [ ] **Step 5: Fix every `Env` literal in tests**

Run: `grep -rln "configTotpSecret:" tests`
Add `maxConcurrentRuns: 2,` to each `Env` literal found (at least `tests/integration/harness.ts`).

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run --project unit tests/unit/config/env.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Document it**

In `README.md`, directly after the `ALLOWED_EMAILS` code block (ends with the line about write access, around line 104), add:

````markdown
One more variable is optional and matters only when several installations share one host:

```bash
# How many agent containers may run at once on this host's Docker daemon.
# Counted across every installation that uses the daemon. A request that
# arrives while the limit is reached waits its turn (the client sees
# "Waiting for a free turn"), and gives up after fifteen minutes.
# Default 2. Rule of thumb: one per 1 GB of RAM left after the app containers.
MAX_CONCURRENT_RUNS=2
```
````

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/lib/config/env.ts tests/unit/config/env.test.ts tests/integration/harness.ts README.md
git commit -m "read MAX_CONCURRENT_RUNS so a shared host can cap agent containers

Several installations on one machine share one Docker daemon. This is the
number the next commits enforce against it."
```

---

### Task 2: The `queued` stage

**Files:**
- Modify: `src/types/index.ts:132-141` (`Stage`)
- Modify: `src/lib/jobs/state.ts:23-33`
- Modify: `src/lib/record/record.ts:36-46`
- Modify: `src/lib/i18n/en.ts` (`stages.change`, `stages.publish`, `stages.undo`, `working.lines.change`)
- Modify: `src/lib/i18n/he.ts`, `src/lib/i18n/nl.ts`, `src/lib/i18n/fr.ts` (same keys)
- Modify: `specs/001-conversational-site-editing/data-model.md:91`
- Test: `tests/unit/jobs/state.test.ts`, `tests/unit/record/roundtrip.test.ts`

**Interfaces:**
- Produces: `Stage` includes `'queued'`. Legal: `starting -> queued`, `queued -> running`, `queued -> failed`. `queued` is NOT on `HAPPY_PATH_STAGES` (`src/components/ProgressTrail.tsx`), so the trail does not show a step for it; the working indicator line and the stage headline do.

- [ ] **Step 1: Write the failing state tests**

In `tests/unit/jobs/state.test.ts`, add to the `legal` array:

```ts
    ['starting', 'queued'],
    ['queued', 'running'],
    ['queued', 'failed'],
```

Add to the `illegal` array:

```ts
    ['queued', 'gating'],
    ['queued', 'abandoned'],
    ['running', 'queued'],
```

In `tests/unit/record/roundtrip.test.ts` line 79, add `'queued'` after `'starting'` in the stage list so the round-trip covers it.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit tests/unit/jobs/state.test.ts tests/unit/record/roundtrip.test.ts`
Expected: FAIL, plus a type error on `'queued'` not being a `Stage`.

- [ ] **Step 3: Add the stage to the vocabulary**

`src/types/index.ts`:

```ts
export type Stage =
  | 'starting'
  /** Waiting for a free agent slot on a shared host. Absent when one was free at once. */
  | 'queued'
  | 'running'
  | 'gating'
  | 'pushing'
  | 'building'
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'abandoned';
```

`src/lib/jobs/state.ts`, replace `LEGAL_NEXT`:

```ts
const LEGAL_NEXT: Record<Stage, readonly Stage[]> = {
  starting: ['queued', 'running', 'abandoned'],
  queued: ['running'],
  running: ['gating'],
  gating: ['pushing', 'blocked'],
  pushing: ['building'],
  building: ['succeeded'],
  succeeded: [],
  blocked: [],
  failed: [],
  abandoned: [],
};
```

Update the module comment's legal path line to: `` `starting -> (queued ->) running -> gating -> pushing -> building -> succeeded` ``.

`src/lib/record/record.ts`, add `'queued',` after `'starting',` in `STAGE_VALUES`.

- [ ] **Step 4: Label it in every dictionary**

`src/lib/i18n/en.ts`, add after each `starting:` line in `stages.change`, `stages.publish`, `stages.undo`:

```ts
      queued: 'Waiting for a free turn',
```

And in `working.lines.change`, after the `starting:` array:

```ts
        queued: ['Someone else is being helped first', 'Holding your place in line', 'Your turn is coming'],
```

`src/lib/i18n/he.ts`, same three `stages` tables:

```ts
      queued: 'ממתינים לתור פנוי',
```

`working.lines.change`:

```ts
        queued: ['עוזרים קודם למישהו אחר', 'שומרים לכם את המקום בתור', 'התור שלכם מתקרב'],
```

`src/lib/i18n/nl.ts`:

```ts
      queued: 'Wachten op een vrije beurt',
```

```ts
        queued: ['Iemand anders wordt eerst geholpen', 'Je plek in de rij wordt vastgehouden', 'Je beurt komt eraan'],
```

`src/lib/i18n/fr.ts`:

```ts
      queued: 'En attente d’un tour libre',
```

```ts
        queued: ['Quelqu’un d’autre est servi en premier', 'Votre place dans la file est gardée', 'Votre tour arrive'],
```

- [ ] **Step 5: Run the vocabulary audits**

Run: `npm run typecheck && npx vitest run --project unit tests/unit/jobs tests/unit/record tests/unit/i18n tests/unit/components`
Expected: PASS. The dictionaries test checks `working.lines` keys match across locales; the trail test checks every stage of every kind has a label with no git or path vocabulary.

- [ ] **Step 6: Document the stage**

`specs/001-conversational-site-editing/data-model.md` line 91, change the stage line to:

```
Stages: `starting → (queued →) running → gating → pushing → building → succeeded`, with `blocked` from
gating, `failed` from any stage, and `queued` present only when the host had no free agent slot
when the request was ready to run. Every terminal stage releases the lock and writes a record.
```

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/lib/jobs/state.ts src/lib/record/record.ts src/lib/i18n tests/unit/jobs/state.test.ts tests/unit/record/roundtrip.test.ts specs/001-conversational-site-editing/data-model.md
git commit -m "add a queued stage for a request waiting its turn on a shared host

Optional between starting and running, labelled in every language, and
kept off the happy-path trail so a request that never waited shows no
empty step."
```

---

### Task 3: The `too_busy` error code

**Files:**
- Modify: `src/types/index.ts:146-159` (`ErrorCode`)
- Modify: `src/lib/jobs/messages.ts` (`CLIENT_MESSAGES`, `ERROR_STATUS`)
- Modify: `src/lib/jobs/run.ts:590-606` (`DEFAULT_ERROR_DETAIL`)
- Modify: `src/lib/record/record.ts:61-71`
- Modify: `src/lib/i18n/he.ts`, `nl.ts`, `fr.ts` (`errors`); `en.ts` reuses `CLIENT_MESSAGES`
- Modify: `specs/001-conversational-site-editing/contracts/http-api.md` (error table near line 89)
- Test: `tests/unit/messages.test.ts` (existing parity tests cover it), `tests/unit/record/roundtrip.test.ts`

**Interfaces:**
- Produces: `ErrorCode` includes `'too_busy'`; `CLIENT_MESSAGES.too_busy`; `ERROR_STATUS.too_busy === 503`; `DEFAULT_ERROR_DETAIL.too_busy`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/record/roundtrip.test.ts`, find the test that round-trips a failed record with an error code (search `errorCode:`) and add a sibling:

```ts
  it('round-trips a request that never got a turn', () => {
    const record: RequestRecord = {
      requestId: 'r_busy',
      startedAt: '2026-09-04T10:00:00.000Z',
      finishedAt: '2026-09-04T10:15:00.000Z',
      outcome: 'failed',
      stages: [
        { stage: 'queued', at: '2026-09-04T10:00:01.000Z' },
        { stage: 'failed', at: '2026-09-04T10:15:00.000Z' },
      ],
      errorCode: 'too_busy',
      errorDetail: 'no agent slot became free within 15 minutes (MAX_CONCURRENT_RUNS=2)',
    };
    const parsed = parseComment(renderRecord('prose', record));
    expect(parsed.record).toEqual(record);
  });
```

Use the same import names the file already uses for `parseComment`, `renderRecord`, and `RequestRecord`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit tests/unit/record/roundtrip.test.ts`
Expected: FAIL with a type error on `'too_busy'`.

- [ ] **Step 3: Add the code everywhere the vocabulary lives**

`src/types/index.ts`, in `ErrorCode` after `'request_in_flight'`:

```ts
  | 'too_busy'
```

`src/lib/jobs/messages.ts`, in `CLIENT_MESSAGES` after `request_in_flight`:

```ts
  too_busy:
    'Things are busy right now, so your change did not run. Please try again in a few minutes. Nothing was published.',
```

In `ERROR_STATUS` after `request_in_flight: 409,`:

```ts
  too_busy: 503,
```

`src/lib/jobs/run.ts`, in `DEFAULT_ERROR_DETAIL` after `request_in_flight`:

```ts
  too_busy: 'no agent slot became free on this host within the queue wait (MAX_CONCURRENT_RUNS)',
```

`src/lib/record/record.ts`, in `ERROR_CODE_VALUES` after `'request_in_flight',`:

```ts
  'too_busy',
```

`src/lib/i18n/he.ts` `errors`, after `request_in_flight`:

```ts
    too_busy: 'עמוס כרגע, אז השינוי שלכם לא רץ. נסו שוב בעוד כמה דקות. שום דבר לא פורסם.',
```

`src/lib/i18n/nl.ts`:

```ts
    too_busy:
      'Het is nu druk, dus je wijziging is niet uitgevoerd. Probeer het over een paar minuten opnieuw. Er is niets gepubliceerd.',
```

`src/lib/i18n/fr.ts`:

```ts
    too_busy:
      'C’est chargé en ce moment, votre modification n’a donc pas été lancée. Réessayez dans quelques minutes. Rien n’a été publié.',
```

- [ ] **Step 4: Run the audits**

Run: `npm run typecheck && npx vitest run --project unit tests/unit/messages.test.ts tests/unit/record tests/unit/i18n`
Expected: PASS. `messages.test.ts` checks every code has a message and a status, and that the sentence names no path, git word, or build log.

- [ ] **Step 5: Document the code**

`specs/001-conversational-site-editing/contracts/http-api.md`, add a row under `request_in_flight` in the error table:

```
| `too_busy` | Things are busy right now, so your change did not run. Please try again in a few minutes. Nothing was published | 503 | The host had no free agent slot for fifteen minutes (`MAX_CONCURRENT_RUNS`). |
```

Match the column layout of the surrounding rows; if the table has fewer columns, keep only the code and the sentence.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/jobs/messages.ts src/lib/jobs/run.ts src/lib/record/record.ts src/lib/i18n tests/unit/record/roundtrip.test.ts specs/001-conversational-site-editing/contracts/http-api.md
git commit -m "add too_busy, the ending for a request that never got a turn

Its own sentence rather than internal_error, because a client who waited
fifteen minutes deserves to be told why and what to do."
```

---

### Task 4: The slots module

**Files:**
- Create: `src/lib/runner/slots.ts`
- Modify: `src/lib/runner/index.ts`
- Test: `tests/unit/runner/slots.test.ts`

**Interfaces:**
- Produces:

```ts
export const AGENT_LABEL = 'webagent.agent';
export type SlotOutcome = { ok: true } | { ok: false; waitedMs: number };
export interface AgentSlots {
  acquire(options?: { onWait?: () => void }): Promise<SlotOutcome>;
}
export const UNLIMITED_SLOTS: AgentSlots;
export interface CreateDockerSlotsOptions {
  docker: Pick<Docker, 'listContainers'>;
  limit: number;
  pollMs?: number;      // default 3_000
  maxWaitMs?: number;   // default 15 * 60_000
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export function createDockerSlots(options: CreateDockerSlotsOptions): AgentSlots;
export function countRunningAgents(docker: Pick<Docker, 'listContainers'>): Promise<number>;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/runner/slots.test.ts`:

```ts
import type Docker from 'dockerode';
import { describe, expect, it, vi } from 'vitest';

import { AGENT_LABEL, countRunningAgents, createDockerSlots, UNLIMITED_SLOTS } from '@/lib/runner/slots';

/**
 * The Docker daemon is the semaphore: every installation on a host shares it,
 * so counting labelled containers there is a host-wide count with no shared
 * file and no stale-lock logic. A dead container simply stops being listed.
 */

/** A daemon whose running-agent count follows a script, one entry per call. */
function daemonReporting(counts: number[]): Pick<Docker, 'listContainers'> & { filters: unknown[] } {
  const filters: unknown[] = [];
  let call = 0;
  return {
    filters,
    listContainers: (async (options: Docker.ContainerListOptions) => {
      filters.push(options.filters);
      const count = counts[Math.min(call, counts.length - 1)] ?? 0;
      call += 1;
      return Array.from({ length: count }, (_, index) => ({ Id: `agent-${index}` }));
    }) as Docker['listContainers'],
  };
}

function clock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

describe('countRunningAgents', () => {
  it('asks the daemon only for running containers carrying the agent label', async () => {
    const docker = daemonReporting([3]);
    expect(await countRunningAgents(docker)).toBe(3);
    expect(docker.filters).toEqual([{ label: [`${AGENT_LABEL}=true`] }]);
  });

  it('counts zero, and says so in the log, when the daemon cannot be asked', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const docker = {
      listContainers: (async () => {
        throw new Error('connect ENOENT /var/run/docker.sock');
      }) as Docker['listContainers'],
    };
    expect(await countRunningAgents(docker)).toBe(0);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe('createDockerSlots', () => {
  it('returns at once when fewer agents run than the limit, without announcing a wait', async () => {
    const onWait = vi.fn();
    const slots = createDockerSlots({ docker: daemonReporting([1]), limit: 2, ...clock() });
    expect(await slots.acquire({ onWait })).toEqual({ ok: true });
    expect(onWait).not.toHaveBeenCalled();
  });

  it('waits while the host is full, announces the wait exactly once, and proceeds when a slot frees', async () => {
    const onWait = vi.fn();
    const time = clock();
    const sleep = vi.fn(time.sleep);
    const slots = createDockerSlots({
      docker: daemonReporting([2, 2, 1]),
      limit: 2,
      pollMs: 3_000,
      now: time.now,
      sleep,
    });

    expect(await slots.acquire({ onWait })).toEqual({ ok: true });
    expect(onWait).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it('gives up after the maximum wait and reports how long it waited', async () => {
    const time = clock();
    const slots = createDockerSlots({
      docker: daemonReporting([2]),
      limit: 2,
      pollMs: 60_000,
      maxWaitMs: 5 * 60_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(await slots.acquire()).toEqual({ ok: false, waitedMs: 5 * 60_000 });
  });

  it('treats the limit as exclusive: a limit of one waits behind one running agent', async () => {
    const onWait = vi.fn();
    const slots = createDockerSlots({ docker: daemonReporting([1, 0]), limit: 1, ...clock() });
    expect(await slots.acquire({ onWait })).toEqual({ ok: true });
    expect(onWait).toHaveBeenCalledOnce();
  });
});

describe('UNLIMITED_SLOTS', () => {
  it('never waits', async () => {
    const onWait = vi.fn();
    expect(await UNLIMITED_SLOTS.acquire({ onWait })).toEqual({ ok: true });
    expect(onWait).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit tests/unit/runner/slots.test.ts`
Expected: FAIL, module `@/lib/runner/slots` not found.

- [ ] **Step 3: Write the module**

Create `src/lib/runner/slots.ts`:

```ts
import type Docker from 'dockerode';

/**
 * Host-wide agent slots, with the Docker daemon as the semaphore.
 *
 * Several installations may share one machine, and with it one daemon. Each
 * has its own lock (one request per site), but nothing stops four sites from
 * starting four agents into 4 GB of RAM at once. Rather than a broker or a
 * shared lock file, the daemon itself is asked how many agent containers are
 * running: every one carries `AGENT_LABEL`, and a container that died is
 * simply no longer listed, so there is no stale state to reason about.
 *
 * Two processes can check at the same instant and both proceed. That bounds
 * the overshoot at one extra container, which the container's own resource
 * caps make harmless; an exact semaphore would need shared state this
 * product deliberately does not have (constitution VII).
 */

export const AGENT_LABEL = 'webagent.agent';

export type SlotOutcome = { ok: true } | { ok: false; waitedMs: number };

export interface AgentSlots {
  /**
   * Resolves once fewer than the limit are running. `onWait` fires once, the
   * first time the caller actually has to wait, so the orchestrator can
   * announce a `queued` stage only to a request that queued.
   */
  acquire(options?: { onWait?: () => void }): Promise<SlotOutcome>;
}

/** For tests and single-site development: every request runs at once. */
export const UNLIMITED_SLOTS: AgentSlots = {
  acquire: async () => ({ ok: true }),
};

export interface CreateDockerSlotsOptions {
  docker: Pick<Docker, 'listContainers'>;
  limit: number;
  pollMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 15 * 60_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Running containers carrying the agent label. A daemon that cannot answer
 * counts as empty: refusing every request because the count failed would
 * turn a monitoring fault into an outage, and the runner's own
 * `createContainer` reports a dead daemon properly a moment later.
 */
export async function countRunningAgents(docker: Pick<Docker, 'listContainers'>): Promise<number> {
  try {
    const containers = await docker.listContainers({
      filters: { label: [`${AGENT_LABEL}=true`] },
    });
    return containers.length;
  } catch (error) {
    console.error('runner/slots: could not count running agents, proceeding as if none', {
      error: describe(error),
    });
    return 0;
  }
}

export function createDockerSlots(options: CreateDockerSlotsOptions): AgentSlots {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? pause;

  async function acquire(acquireOptions: { onWait?: () => void } = {}): Promise<SlotOutcome> {
    const startedAt = now();
    let announced = false;

    for (;;) {
      const running = await countRunningAgents(options.docker);
      if (running < options.limit) return { ok: true };

      const waitedMs = now() - startedAt;
      if (waitedMs >= maxWaitMs) return { ok: false, waitedMs };

      if (!announced) {
        announced = true;
        acquireOptions.onWait?.();
      }
      await sleep(pollMs);
    }
  }

  return { acquire };
}
```

Add to `src/lib/runner/index.ts`:

```ts
export {
  AGENT_LABEL,
  countRunningAgents,
  createDockerSlots,
  UNLIMITED_SLOTS,
  type AgentSlots,
  type CreateDockerSlotsOptions,
  type SlotOutcome,
} from './slots';
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit tests/unit/runner/slots.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runner/slots.ts src/lib/runner/index.ts tests/unit/runner/slots.test.ts
git commit -m "count running agent containers as the host-wide slot semaphore

The daemon every installation on a host shares already knows how many
agents are running; asking it needs no broker and no shared file."
```

---

### Task 5: Label the agent container

**Files:**
- Modify: `src/lib/runner/docker.ts:40-57`
- Test: `tests/unit/runner/labels.test.ts` (new)

**Interfaces:**
- Consumes: `AGENT_LABEL` from Task 4.
- Produces: every container created by `createDockerRunner` has `Labels: { 'webagent.agent': 'true', 'webagent.request': <requestId> }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/runner/labels.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type Docker from 'dockerode';
import { afterEach, describe, expect, it } from 'vitest';

import { createDockerRunner } from '@/lib/runner/docker';
import { AGENT_LABEL } from '@/lib/runner/slots';

/**
 * The slot count (slots.ts) is only as good as the label it counts. A
 * container created without it is invisible to every other installation on
 * the host, so the label is asserted where the container is specified.
 */

function createFakeContainer(id: string): Docker.Container {
  return {
    id,
    modem: { demuxStream: () => {} },
    attach: async () => new PassThrough() as unknown as NodeJS.ReadWriteStream,
    start: async () => {},
    wait: async () => ({ StatusCode: 0 }),
    kill: async () => {},
    remove: async () => {},
  } as unknown as Docker.Container;
}

function createFakeDocker(calls: Docker.ContainerCreateOptions[]): Docker {
  return {
    modem: { demuxStream: () => {} },
    createContainer: async (opts: Docker.ContainerCreateOptions) => {
      calls.push(opts);
      return createFakeContainer('fake-container-id');
    },
  } as unknown as Docker;
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the agent container', () => {
  it('carries the agent label and its request id, so a shared host can count it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'webagent-labels-'));
    dirs.push(root);
    const calls: Docker.ContainerCreateOptions[] = [];
    const runner = createDockerRunner({ image: 'webagent/agent:test', apiKey: 'k', docker: createFakeDocker(calls) });

    await runner.run({
      requestId: 'r_label',
      workDir: join(root, 'work'),
      controlDir: join(root, 'control'),
      prompt: { request: 'x', history: [], guidance: '' },
      model: 'm',
      timeoutMs: 1_000,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.Labels).toEqual({ [AGENT_LABEL]: 'true', 'webagent.request': 'r_label' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit tests/unit/runner/labels.test.ts`
Expected: FAIL, `Labels` is `undefined`.

- [ ] **Step 3: Add the labels**

In `src/lib/runner/docker.ts`, import the label:

```ts
import { AGENT_LABEL } from './slots';
```

In `buildContainerOptions`, after `Tty: false,`:

```ts
    // Counted by slots.ts across every installation on this host. The request
    // id is for a developer reading `docker ps`, nothing reads it back.
    Labels: { [AGENT_LABEL]: 'true', 'webagent.request': request.requestId },
```

- [ ] **Step 4: Run the runner tests**

Run: `npx vitest run --project unit tests/unit/runner && npm run typecheck`
Expected: PASS. `isolation.test.ts` still passes: `Env` is unchanged, labels are not environment.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runner/docker.ts tests/unit/runner/labels.test.ts
git commit -m "label the agent container so a shared host can count it"
```

---

### Task 6: Wait for a slot before running the agent

**Files:**
- Modify: `src/lib/jobs/run.ts` (`RunDeps`, `execute`)
- Modify: `src/lib/installation.ts`
- Modify: `src/lib/http/start-request.ts:74`
- Modify: `tests/integration/harness.ts` (`HarnessOptions`, `deps`)
- Modify: `tests/integration/approve.test.ts:56-66`, `tests/integration/undo.test.ts` (around line 58), `tests/integration/stream-route.test.ts` (around line 49)
- Modify: `docker-compose.yml`, `README.md`
- Test: `tests/integration/slots.test.ts` (new)

**Interfaces:**
- Consumes: `AgentSlots`, `UNLIMITED_SLOTS`, `createDockerSlots` (Task 4); `'queued'` (Task 2); `'too_busy'` (Task 3); `Env.maxConcurrentRuns` (Task 1).
- Produces: `RunDeps.slots?: AgentSlots` (absent means unlimited); `Installation.slots: AgentSlots`.

- [ ] **Step 1: Let the harness take slots**

In `tests/integration/harness.ts`:

Add the import:

```ts
import type { AgentSlots } from '@/lib/runner/slots';
```

Add to `HarnessOptions`:

```ts
  /** Host-wide agent slots. Absent, every request runs at once, as before. */
  slots?: AgentSlots;
```

Add to the `deps` literal, after `runner,`:

```ts
    ...(options.slots ? { slots: options.slots } : {}),
```

- [ ] **Step 2: Write the failing integration tests**

Create `tests/integration/slots.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { claimConversationBranch } from '@/lib/conversations';
import { CLIENT_MESSAGES } from '@/lib/jobs/messages';
import { runRequest } from '@/lib/jobs/run';
import { parseComment } from '@/lib/record/record';
import type { AgentSlots } from '@/lib/runner/slots';
import type { JobEvent } from '@/types';
import { branchExists, createHarness, readPushedFile, type Harness } from './harness';

/**
 * A request on a full host waits its turn, and says so in the client's words;
 * one that waits too long ends in its own sentence with the site untouched.
 */

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
});

async function openConversation(client: Harness['client']) {
  const base = await client.getRef('refs/heads/main');
  const { branch } = await claimConversationBranch(client, base!.sha);
  return client.createPullRequest({
    title: 'Change something',
    head: branch,
    base: 'main',
    body: 'Opened from a change request.',
  });
}

const editsTheHomepage = {
  result: {
    summary: 'I made the headline shorter.',
    filesChanged: ['src/index.html'],
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0.1,
  },
  async edit(workDir: string) {
    const full = join(workDir, 'src/index.html');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, '<h1>Built for speed</h1>\n', 'utf8');
  },
};

/** Slots that make the caller wait once, then let it through. */
function slotsThatQueueOnce(): AgentSlots & { readonly waits: number } {
  let waits = 0;
  return {
    get waits() {
      return waits;
    },
    async acquire(options) {
      waits += 1;
      options?.onWait?.();
      return { ok: true };
    },
  };
}

const slotsThatNeverFree: AgentSlots = {
  async acquire(options) {
    options?.onWait?.();
    return { ok: false, waitedMs: 15 * 60_000 };
  },
};

function stagesSeen(events: JobEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'stage' ? [event.stage] : []));
}

describe('a request on a full host', () => {
  it('queues before running, and the client sees the wait as a stage', async () => {
    const slots = slotsThatQueueOnce();
    harness = await createHarness({ script: editsTheHomepage, slots, previewTimeoutMs: 500 });
    const pullRequest = await openConversation(harness.client);
    const events: JobEvent[] = [];
    harness.bus.subscribe(pullRequest.number, (event) => events.push(event));

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });

    expect(slots.waits).toBe(1);
    const stages = stagesSeen(events);
    expect(stages.indexOf('queued')).toBeGreaterThan(-1);
    expect(stages.indexOf('queued')).toBeLessThan(stages.indexOf('running'));
    expect(harness.runner.calls).toHaveLength(1);
  });

  it('gives up after the wait with its own sentence, having run nothing and published nothing', async () => {
    harness = await createHarness({ script: editsTheHomepage, slots: slotsThatNeverFree });
    const pullRequest = await openConversation(harness.client);

    const outcome = await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });

    expect(outcome.started && outcome.outcome).toBe('failed');
    expect(harness.runner.calls).toHaveLength(0);
    const parsed = parseComment((await harness.client.listComments(pullRequest.number)).at(-1)!);
    expect(parsed.record?.errorCode).toBe('too_busy');
    expect(parsed.record?.errorDetail).toMatch(/15 minutes/);
    expect(parsed.record?.stages.map((event) => event.stage)).toEqual(['queued', 'failed']);
    expect(parsed.prose).toBe(CLIENT_MESSAGES.too_busy);
    expect(await readPushedFile(harness.originDir, 'main', 'src/index.html')).toContain('Hello');
    expect(await branchExists(harness.originDir, pullRequest.headRef)).toBe(false);
  });

  it('runs at once, with no queued stage, when no slots are configured', async () => {
    harness = await createHarness({ script: editsTheHomepage, previewTimeoutMs: 500 });
    const pullRequest = await openConversation(harness.client);
    const events: JobEvent[] = [];
    harness.bus.subscribe(pullRequest.number, (event) => events.push(event));

    await runRequest(harness.deps, {
      conversationNumber: pullRequest.number,
      branch: pullRequest.headRef,
      baseBranch: 'main',
      message: 'Shorten the headline',
      history: [],
    });

    expect(stagesSeen(events)).not.toContain('queued');
  });
});
```

Check `harness.bus.subscribe`'s real signature in `src/lib/jobs/bus.ts` and `tests/integration/stream.test.ts` line 69 onward, and adjust the two `subscribe` calls to match it (the stream test already subscribes and collects events; copy its shape).

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:int -- tests/integration/slots.test.ts`
Expected: the first two FAIL (no `queued` stage; agent runs despite full host). The third passes already.

- [ ] **Step 4: Wait for a slot in the orchestrator**

In `src/lib/jobs/run.ts`:

Add the import:

```ts
import type { AgentSlots, SlotOutcome } from '@/lib/runner/slots';
```

Add to `RunDeps`, after `runner: JobRunner;`:

```ts
  /**
   * Host-wide agent slots (src/lib/runner/slots.ts). Absent, the request
   * runs at once: a single-site development setup needs no queue.
   */
  slots?: AgentSlots;
```

In `execute`, replace the block from `machine.advance('running');` through `const agent = await runAgent(...)` with:

```ts
    // The tree is prepared at `starting`; the request only becomes `running`
    // once the host has room for its agent. Preparing first keeps the wait
    // short once a slot frees, and the lock is already held either way.
    const prepared = await prepare(deps, input, requestId);
    tree = prepared.tree;
    controlDir = prepared.controlDir;

    const slot = await waitForSlot(deps, machine);
    if (!slot.ok) {
      return finish(deps, input, machine, {
        requestId,
        startedAt,
        model,
        outcome: 'failed',
        errorCode: 'too_busy',
        errorDetail: `no agent slot became free within ${Math.round(slot.waitedMs / 60_000)} minutes (MAX_CONCURRENT_RUNS=${deps.env.maxConcurrentRuns})`,
        prose: null,
      });
    }

    machine.advance('running');
    const agent = await runAgent(deps, requestId, prepared, model);
```

Add, in the "The steps" section before `interface Prepared`:

```ts
/**
 * Announces `queued` only to a request that actually waited: `onWait` fires
 * the first time the host is full, never for a request that walked straight
 * in. With no slots configured there is nothing to wait for.
 */
async function waitForSlot(
  deps: RunDeps,
  machine: { advance(stage: 'queued'): void },
): Promise<SlotOutcome> {
  if (!deps.slots) return { ok: true };
  return deps.slots.acquire({ onWait: () => machine.advance('queued') });
}
```

- [ ] **Step 5: Run the integration tests**

Run: `npm run test:int -- tests/integration/slots.test.ts tests/integration/stream.test.ts tests/integration/failures.test.ts`
Expected: PASS. `stream.test.ts` "emits every stage of the happy path, in order" still passes: the order is unchanged, only `running` fires after `prepare` now.

- [ ] **Step 6: Wire the installation**

In `src/lib/installation.ts`:

Add imports:

```ts
import Docker from 'dockerode';
import { createDockerSlots, type AgentSlots } from '@/lib/runner/slots';
```

Add to `Installation`, after `runner: JobRunner;`:

```ts
  slots: AgentSlots;
```

In `getInstallation`, before the `installation` literal:

```ts
  // One daemon connection for both: the slot count must see the same daemon
  // the runner creates containers on, or it counts the wrong host.
  const docker = new Docker();
```

Change the `runner` line and add `slots`:

```ts
    runner: createDockerRunner({ image: AGENT_IMAGE, apiKey: env.openrouterApiKey, docker }),
    slots: createDockerSlots({ docker, limit: env.maxConcurrentRuns }),
```

In `src/lib/http/start-request.ts`, after `runner: installation.runner,` (line 74):

```ts
      slots: installation.slots,
```

In each of `tests/integration/approve.test.ts`, `tests/integration/undo.test.ts`, `tests/integration/stream-route.test.ts`, add to the `Installation` literal after `runner: current.deps.runner,`:

```ts
    slots: UNLIMITED_SLOTS,
```

with the import:

```ts
import { UNLIMITED_SLOTS } from '@/lib/runner/slots';
```

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm run lint && npm test && npm run test:int`
Expected: all PASS.

- [ ] **Step 8: Document the deployment**

`docker-compose.yml`, in the `environment:` block after `NODE_ENV: production`:

```yaml
      # Host-wide cap on agent containers, counted on the daemon above across
      # every installation that shares it. See README, "Several sites on one host".
      MAX_CONCURRENT_RUNS: ${MAX_CONCURRENT_RUNS:-2}
```

`README.md`, add a subsection after "### Run" (after the paragraph ending "rather than a silent start (FR-003b)."):

````markdown
### Several sites on one host

One installation serves one website, and nothing here changes that. Several installations
can share one machine, though: one directory, one `.env`, one Compose project per site, all
pointed at the same Docker daemon and fronted by a reverse proxy with a hostname each.

The daemon is the shared resource, so it is also the shared limit. Every agent container is
labelled, and a request counts the running ones before starting its own; while the count is at
`MAX_CONCURRENT_RUNS` the request waits, and the client sees "Waiting for a free turn". After
fifteen minutes it gives up with its own sentence and nothing is published. Set the same value
in every `.env` on the host; the count is host-wide whichever installation makes it.
````

- [ ] **Step 9: Commit**

```bash
git add src/lib/jobs/run.ts src/lib/installation.ts src/lib/http/start-request.ts tests/integration/harness.ts tests/integration/slots.test.ts tests/integration/approve.test.ts tests/integration/undo.test.ts tests/integration/stream-route.test.ts docker-compose.yml README.md
git commit -m "wait for a free agent slot before running, host-wide

Several installations on one machine share one daemon and, until now, no
limit. A request now queues behind MAX_CONCURRENT_RUNS running agents,
tells the client it is waiting, and gives up after fifteen minutes."
```

---

## Self-review

**Coverage against the agreed design:**
- Label every agent container: Task 5.
- Count via `listContainers` with the label filter: Task 4.
- Wait, poll every 3 seconds, give up after 20 minutes: Task 4 (15 minutes chosen; the conversation said 20, 15 keeps the whole request inside a reasonable `maxRequestMinutes` budget — change `DEFAULT_MAX_WAIT_MS` if 20 is preferred).
- `MAX_CONCURRENT_RUNS` env, default 2: Task 1.
- New `queued` stage, client copy in four languages, never "slot"/"container"/"queue depth": Task 2.
- Own ending for a wait that fails: Task 3 (`too_busy`), used in Task 6.
- Fake runner tests, stage emitted, timeout path, env default: Tasks 1, 4, 6.
- Compose and README: Tasks 1 and 6.

**Type consistency:** `AgentSlots.acquire(options?: { onWait?: () => void }): Promise<SlotOutcome>` is used identically in Tasks 4 and 6. `Env.maxConcurrentRuns` (Task 1) is read in Task 6's error detail and in `installation.ts`. `AGENT_LABEL` (Task 4) is imported by Task 5.

**Known judgement calls, for the reviewer:**
- `running` now fires after `prepare` instead of before. Stage order is unchanged; timing shifts by the mirror sync. A `prepare` failure now fails from `starting`, which is legal.
- `countRunningAgents` treats a daemon error as zero running, with a log line, so a broken count never becomes an outage. The runner reports a dead daemon on its own.
- `queued` is deliberately not on `HAPPY_PATH_STAGES`, so the trail shows no permanent "waiting" step for requests that never waited. The headline and the working indicator show it while it is current.

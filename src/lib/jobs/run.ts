import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RepoClient } from '@/lib/github/types';
import {
  discardAttachments,
  placeAttachments,
  verifyPlaced,
  type PlacedAttachment,
} from '@/lib/jobs/attachments';
import type { JobBus } from '@/lib/jobs/bus';
import { CLIENT_MESSAGES, INTERRUPTED_MESSAGE } from '@/lib/jobs/messages';
import { resolveModel } from '@/lib/models';
import { toClientProse } from '@/lib/jobs/client-prose';
import { assemblePrompt } from '@/lib/jobs/prompt';
import { waitForPreview } from '@/lib/jobs/preview';
import { pushBranch } from '@/lib/jobs/push';
import { createStageMachine } from '@/lib/jobs/state';
import type { AcquireResult, LockHandle } from '@/lib/lock/lock';
import { commitPermittedPaths, deriveChangeSet } from '@/lib/mirror/changeset';
import type { Mirror, WorkingTree } from '@/lib/mirror/types';
import type { NetlifyClient } from '@/lib/netlify';
import type { Mailer } from '@/lib/notify/email';
import { gate } from '@/lib/policy/gate';
import { renderRecord } from '@/lib/record/record';
import { writeControlDir } from '@/lib/runner/control';
import type { JobRunner } from '@/lib/runner/types';
import type {
  AgentPrompt,
  Attachment,
  ChangedFile,
  Env,
  ErrorCode,
  Message,
  ModelTier,
  Outcome,
  RepoConfig,
  RequestRecord,
  StageEvent,
} from '@/types';

/**
 * One request, from a sentence a client typed to a preview they can look at.
 *
 * The order of the steps here is the security design, not an implementation
 * detail. The agent edits a working tree that has no remote and holds no
 * credential; the host derives what changed, gates it, and only then stages,
 * commits and pushes. Nothing between the container and the client's site is
 * enforced by asking the model nicely (constitution Principle III).
 *
 * Every exit releases the lock and writes a durable record. That is not
 * politeness about cleanup: the lock is the only thing preventing two agents on
 * one branch, and the record is the only history this product has.
 */

export interface RunDeps {
  client: RepoClient;
  lock: { acquire(requestId: string, maxRequestMinutes: number): Promise<AcquireResult> };
  mirror: Mirror;
  runner: JobRunner;
  netlify: NetlifyClient;
  bus: JobBus;
  env: Env;
  config: RepoConfig;
  /**
   * Reaches the developer, not the client: the cost ceiling alert is the one
   * thing this orchestrator sends on its own behalf (FR-014). Absent, a run
   * still stops at the ceiling — it just goes unannounced.
   */
  mailer?: Mailer;
  /** Called once the request is finished, with the comment that recorded it. */
  onFinished?: (record: RequestRecord, commentId: number) => Promise<void>;
  now?: () => Date;
  workRoot?: string;
  /** Overrides how long a preview is waited for. Tests need seconds, not minutes. */
  previewTimeoutMs?: number;
}

export interface RunInput {
  conversationNumber: number;
  branch: string;
  baseBranch: string;
  message: string;
  history: Message[];
  targetHint?: string;
  buildFailureDetail?: string;
  /** Paths the gate already refused in this conversation, derived from its records. */
  refusedPaths?: string[];
  /** How much the client chose to spend. Absent, the repository's own `model` runs. */
  modelTier?: ModelTier;
  /**
   * Files the client attached. Copied into the working tree before the agent
   * runs, so they pass the same gate and land in the same commit as the change
   * itself; the temporary copies are removed whatever the ending.
   */
  attachments?: Attachment[];
  requestId?: string;
}

export type RunOutcome =
  | { started: false; errorCode: 'request_in_flight'; heldSince: string }
  | { started: true; requestId: string; outcome: Outcome; record: RequestRecord };

/**
 * What a caller learns the moment the lock has answered, before the work runs.
 *
 * The HTTP contract owes a client `202` or `409` immediately, and the only
 * thing that can decide between them is the lock. Holding the connection open
 * for the whole request would instead tie its fate to a browser tab, so
 * acquisition is awaited and everything after it is not.
 */
export type BeginOutcome =
  | { started: false; errorCode: 'request_in_flight'; heldSince: string }
  | { started: true; requestId: string; completed: Promise<RunOutcome> };

/** Bounds the wait for a preview independently of the agent's own timeout. */
const PREVIEW_TIMEOUT_MS = 10 * 60_000;

export async function beginRequest(deps: RunDeps, input: RunInput): Promise<BeginOutcome> {
  const requestId = input.requestId ?? `r_${randomUUID()}`;
  const acquired = await deps.lock.acquire(requestId, deps.config.settings.maxRequestMinutes);

  if (!acquired.ok && acquired.reason === 'held') {
    // Nothing will run, so nothing will clean up after the attachments either.
    await discardAttachments(input.attachments);
    return { started: false, errorCode: 'request_in_flight', heldSince: acquired.heldSince };
  }

  // A stale lock is broken rather than waited on, and the request it belonged to
  // is given the ending its own process never wrote.
  if (!acquired.ok) await recordAbandoned(deps, input, acquired);

  // Announced before the first stage, so a browser already watching this
  // conversation follows the request from its very first event.
  deps.bus.announce({ conversationNumber: input.conversationNumber, requestId, kind: 'change' });

  return { started: true, requestId, completed: execute(deps, input, requestId, acquired.handle) };
}

/** Runs a request to completion. Convenient for tests and for anything not answering HTTP. */
export async function runRequest(deps: RunDeps, input: RunInput): Promise<RunOutcome> {
  const begun = await beginRequest(deps, input);
  return begun.started ? begun.completed : begun;
}

// ---------------------------------------------------------------------------

async function execute(
  deps: RunDeps,
  input: RunInput,
  requestId: string,
  handle: LockHandle,
): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  // The machine will not let a request reach a terminal stage without this
  // firing, which is how "every ending releases the lock and writes a record"
  // becomes a structural guarantee rather than a convention this file follows.
  let reachedTerminal = false;
  const machine = createStageMachine(requestId, {
    bus: deps.bus,
    now,
    onTerminal: () => {
      reachedTerminal = true;
    },
  });

  let tree: WorkingTree | null = null;
  let controlDir: string | null = null;
  // Chosen once, here, so the container and the record cannot disagree about
  // which model a request ran on.
  const model = resolveModel(deps.config.settings, input.modelTier);

  try {
    machine.advance('running');
    const prepared = await prepare(deps, input, requestId);
    tree = prepared.tree;
    controlDir = prepared.controlDir;

    const agent = await runAgent(deps, requestId, prepared, model);
    if (agent.failure) {
      // The spend is carried into every ending, not just the successful one:
      // a request that failed cost exactly what it cost, and a record omitting
      // that under-reports the installation precisely where a developer is
      // most likely to be looking (constitution V).
      return finish(deps, input, machine, {
        requestId,
        startedAt,
        model,
        ...agent.cost,
        ...agent.failure,
      });
    }

    machine.advance('gating');
    const verdict = await judge(deps, tree, agent.cost, prepared.placed);
    if (verdict.failure) {
      if (verdict.failure.errorCode === 'cost_ceiling') {
        await alertCostCeiling(deps, input, agent.cost.costUsd);
      }
      machine.advance(verdict.failure.outcome === 'blocked' ? 'blocked' : 'failed');
      return finish(
        deps,
        input,
        machine,
        { requestId, startedAt, model, ...agent.cost, ...verdict.failure },
        true,
      );
    }

    machine.advance('pushing');
    const commit = await publishBranch(deps, input, tree, verdict.files, agent.summary);

    machine.advance('building');
    const preview = await waitForPreview(
      { netlify: deps.netlify, bus: deps.bus, requestId },
      {
        conversationNumber: input.conversationNumber,
        commitSha: commit.sha,
        timeoutMs: deps.previewTimeoutMs ?? PREVIEW_TIMEOUT_MS,
      },
    );

    return finish(
      deps,
      input,
      machine,
      settle(preview, { requestId, startedAt, agent, verdict, commit, model }),
    );
  } catch (cause) {
    if (!machine.isTerminal()) machine.advance('failed');
    return finish(deps, input, machine, {
      requestId,
      startedAt,
      outcome: 'failed',
      errorCode: 'internal_error',
      errorDetail: describe(cause),
      prose: null,
    });
  } finally {
    await discard(tree, controlDir);
    await discardAttachments(input.attachments);
    await handle.release();

    if (!reachedTerminal) {
      // Unreachable by design: every return path above passes through `finish`,
      // which advances to a terminal stage. Saying so out loud costs nothing and
      // turns a silent lock leak into a line in the log if it ever stops being
      // true.
      console.error(`[webagent] request ${requestId} ended without a terminal stage`);
    }
  }
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

interface Prepared {
  tree: WorkingTree;
  controlDir: string;
  prompt: AgentPrompt;
  /** Attachments as placed, so the gate can tell them apart from the agent's work. */
  placed: PlacedAttachment[];
}

async function prepare(deps: RunDeps, input: RunInput, requestId: string): Promise<Prepared> {
  await deps.mirror.sync();
  const tree = await deps.mirror.checkout(input.branch, input.baseBranch);

  // The control directory sits outside the working tree by construction, so a
  // control file can never become part of a change to the client's site,
  // whatever the agent does with the tree it was given (FR-015).
  const root = deps.workRoot ?? tmpdir();
  const controlDir = await mkdtemp(join(root, `webagent-control-${requestId}-`));

  // Attachments go into the tree before the agent sees it, as ordinary files
  // at ordinary paths. From here on nothing distinguishes them from a file the
  // agent created: the gate judges them, the commit carries them, and the
  // prompt names where they landed so the agent can use them.
  const placed = await placeAttachments(
    tree.dir,
    deps.config.settings.uploadDir,
    input.attachments,
  );
  const attachedPaths = placed.map((entry) => entry.path);

  const prompt = assemblePrompt({
    request: input.message,
    history: input.history,
    guidance: deps.config.guidance,
    allowedPaths: deps.config.policy.allow,
    ...(input.targetHint ? { targetHint: input.targetHint } : {}),
    ...(input.buildFailureDetail ? { buildFailureDetail: input.buildFailureDetail } : {}),
    ...(input.refusedPaths?.length ? { refusedPaths: input.refusedPaths } : {}),
    ...(attachedPaths.length ? { attachedPaths } : {}),
  });
  // Passing the working tree here is not redundant: it is what lets the control
  // writer refuse a control directory nested inside the tree, rather than
  // trusting this caller to have chosen one outside it (FR-015).
  await writeControlDir(controlDir, tree.dir, prompt);

  return { tree, controlDir, prompt, placed };
}

interface Failure {
  outcome: Outcome;
  errorCode?: ErrorCode;
  errorDetail?: string;
  violation?: RequestRecord['violation'];
  blockedPath?: string;
  prose: string | null;
}

interface AgentPass {
  failure?: Failure;
  summary: string;
  cost: { tokensIn: number; tokensOut: number; costUsd: number };
}

async function runAgent(
  deps: RunDeps,
  requestId: string,
  prepared: Prepared,
  model: string,
): Promise<AgentPass> {
  const timeoutMs = deps.config.settings.maxRequestMinutes * 60_000;
  const run = await deps.runner.run({
    requestId,
    workDir: prepared.tree.dir,
    controlDir: prepared.controlDir,
    prompt: prepared.prompt,
    model,
    timeoutMs,
    onOutput: (text) => deps.bus.publish({ type: 'output', requestId, text }),
  });

  // The runner already read `/control/result.json` and hands it back; reading
  // the file again here would be a second, divergent source of the same fact.
  const result = run.result;
  const cost = {
    tokensIn: result?.tokensIn ?? 0,
    tokensOut: result?.tokensOut ?? 0,
    costUsd: result?.costUsd ?? 0,
  };
  const summary = result?.summary?.trim() || 'I made the change you asked for.';

  if (run.outcome === 'timeout') {
    return {
      failure: { outcome: 'failed', errorCode: 'agent_timeout', prose: null },
      summary,
      cost,
    };
  }
  if (run.outcome === 'error') {
    return {
      failure: {
        outcome: 'failed',
        errorCode: 'internal_error',
        errorDetail: run.errorDetail,
        prose: null,
      },
      summary,
      cost,
    };
  }

  // The container's exit status is the agent's own verdict on its run
  // (contracts/repo-files.md: "exits 0 ... Exits non-zero on failure"). A
  // non-zero exit has to end the request here, before the working tree is
  // examined: an agent that died mid-edit leaves changes behind, and reading
  // those as the client's requested change would push work nobody stands
  // behind. Reading their absence as "nothing needed changing" is worse still
  // — it reports a crash as a considered decision.
  if (run.exitCode !== null && run.exitCode !== 0) {
    return {
      failure: {
        outcome: 'failed',
        errorCode: 'internal_error',
        errorDetail: `the agent container exited with status ${run.exitCode}`,
        prose: null,
      },
      summary,
      cost,
    };
  }

  return { summary, cost };
}

interface Verdict {
  failure?: Failure;
  files: ChangedFile[];
  diffLines: number;
}

/**
 * The gate, plus the two conditions that are not policy violations but still end
 * the request here: a change that cost more than the site permits, and no change
 * at all.
 */
async function judge(
  deps: RunDeps,
  tree: WorkingTree,
  cost: { costUsd: number },
  placed: PlacedAttachment[] = [],
): Promise<Verdict> {
  const changeSet = await deriveChangeSet(tree);

  if (cost.costUsd > deps.config.settings.costCeilingUsd) {
    return {
      failure: { outcome: 'failed', errorCode: 'cost_ceiling', prose: null },
      files: changeSet.files,
      diffLines: changeSet.totalDiffLines,
    };
  }

  if (changeSet.files.length === 0) {
    return {
      failure: { outcome: 'failed', errorCode: 'nothing_to_change', prose: null },
      files: [],
      diffLines: 0,
    };
  }

  // Attachments the client sent, still untouched, need not match the allow
  // list: the list bounds the agent, and these are the client's own files.
  const attachedPaths = await verifyPlaced(tree.dir, placed);
  const result = gate(changeSet.files, deps.config.policy, { attachedPaths });
  if (!result.ok) {
    return {
      failure: {
        outcome: 'blocked',
        errorCode: 'blocked_by_policy',
        violation: result.violation,
        blockedPath: result.path,
        prose: null,
      },
      files: changeSet.files,
      diffLines: changeSet.totalDiffLines,
    };
  }

  return { files: changeSet.files, diffLines: changeSet.totalDiffLines };
}

async function publishBranch(
  deps: RunDeps,
  input: RunInput,
  tree: WorkingTree,
  files: ChangedFile[],
  summary: string,
): Promise<{ sha: string }> {
  // The author and the message belong to the host. The container never commits,
  // so nothing it wrote can masquerade as authorship in the site's history.
  const commit = await commitPermittedPaths(tree, files, commitMessage(summary), {
    name: 'Site Editor',
    email: deps.env.smtpFrom,
  });

  await pushBranch(tree, input.branch, await deps.client.authenticatedRemoteUrl());
  return commit;
}

function commitMessage(summary: string): string {
  const firstLine = summary.split('\n')[0]?.trim() ?? 'apply requested change';
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

// ---------------------------------------------------------------------------
// Ending the request
// ---------------------------------------------------------------------------

interface SettleInput {
  requestId: string;
  startedAt: string;
  agent: AgentPass;
  verdict: Verdict;
  commit: { sha: string };
  model: string;
}

function settle(
  preview: Awaited<ReturnType<typeof waitForPreview>>,
  input: SettleInput,
): FinishInput {
  const shared = {
    requestId: input.requestId,
    startedAt: input.startedAt,
    commitSha: input.commit.sha,
    filesChanged: input.verdict.files.length,
    diffLines: input.verdict.diffLines,
    model: input.model,
    ...input.agent.cost,
  };

  if (preview.kind === 'ready') {
    return {
      ...shared,
      outcome: 'succeeded',
      previewUrl: preview.previewUrl,
      // The summary is unbounded model output, and this is a client surface.
      // Principle III is explicit that the prohibition in Principle I is
      // machine-enforced, so it is redacted here rather than asked for in a
      // prompt (see toClientProse).
      prose: `${toClientProse(input.agent.summary)}\n\nYour preview is ready.`,
    };
  }

  if (preview.kind === 'build_failed') {
    return {
      ...shared,
      outcome: 'failed',
      errorCode: 'build_failed',
      errorDetail: preview.detail,
      prose: null,
    };
  }

  return { ...shared, outcome: 'failed', errorCode: 'site_unreachable', prose: null };
}

type FinishInput = Failure & {
  requestId: string;
  startedAt: string;
  commitSha?: string;
  filesChanged?: number;
  diffLines?: number;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  previewUrl?: string;
};

async function finish(
  deps: RunDeps,
  input: RunInput,
  machine: {
    advance(stage: 'succeeded' | 'failed' | 'blocked'): void;
    isTerminal(): boolean;
    stages: StageEvent[];
  },
  result: FinishInput,
  alreadyTerminal = false,
): Promise<RunOutcome> {
  if (!alreadyTerminal && !machine.isTerminal()) {
    machine.advance(
      result.outcome === 'succeeded'
        ? 'succeeded'
        : result.outcome === 'blocked'
          ? 'blocked'
          : 'failed',
    );
  }

  const now = deps.now ?? (() => new Date());
  const record = buildRecord(result, machine.stages, now().toISOString());
  const prose = result.prose ?? proseFor(result);
  const comment = await deps.client.createComment(
    input.conversationNumber,
    renderRecord(prose, record),
  );

  deps.bus.publish({
    type: 'done',
    requestId: result.requestId,
    outcome: record.outcome,
    ...(record.previewUrl ? { previewUrl: record.previewUrl } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
  });

  await deps.onFinished?.(record, comment.id);
  return { started: true, requestId: result.requestId, outcome: record.outcome, record };
}

/**
 * What a `failed` record says when the failure had nothing more specific to
 * add.
 *
 * The record schema requires a detail on every failure, and it is right to:
 * a failure with no explanation is the one a developer most needs explained.
 * Several endings are fully described by their code alone, though, so rather
 * than let them write a record this product cannot read back, each gets a
 * sentence here. These are diagnostic, never shown to a client — the prose
 * beside the block is what a client reads (Principle I).
 */
export const DEFAULT_ERROR_DETAIL: Record<ErrorCode, string> = {
  agent_timeout: 'the agent was still running when maxRequestMinutes elapsed and was killed',
  cost_ceiling: 'the run would have exceeded costCeilingUsd and was stopped before pushing',
  nothing_to_change: 'the agent exited successfully having modified no file in the working tree',
  nothing_to_publish: 'approval was asked for a conversation with no successful preview to publish',
  nothing_to_undo: 'undo was asked for a conversation that has nothing live to reverse',
  site_moved_on:
    'the default branch has advanced past the published commit, so a revert would take later work with it',
  site_conflict:
    'the default branch and the change touch the same lines, so bringing the change up to date needs a person',
  site_unreachable: 'the hosting provider reported no deploy for this branch within the wait',
  request_in_flight: 'another request held the installation lock',
  too_busy: 'no agent slot became free on this host within the queue wait (MAX_CONCURRENT_RUNS)',
  blocked_by_policy: 'the change touched a path the policy does not permit',
  out_of_date: 'the branch moved under the request between reading and pushing',
  build_failed: 'the hosting provider reported a failed build',
  internal_error: 'an unexpected fault; see the server log for this request id',
};

function buildRecord(result: FinishInput, stages: StageEvent[], finishedAt: string): RequestRecord {
  // A failure must arrive with a detail or the record it writes is one this
  // product cannot parse back, which turns the agent's turn into an
  // unattributed comment and exposes the block a client should never see.
  const errorDetail =
    result.outcome === 'failed' && result.errorCode
      ? (result.errorDetail ?? DEFAULT_ERROR_DETAIL[result.errorCode])
      : result.errorDetail;

  const record: RequestRecord = {
    requestId: result.requestId,
    startedAt: result.startedAt,
    finishedAt,
    outcome: result.outcome,
    stages,
  };

  const optional: Array<[keyof RequestRecord, unknown]> = [
    ['commitSha', result.commitSha],
    ['filesChanged', result.filesChanged],
    ['diffLines', result.diffLines],
    ['model', result.model],
    ['tokensIn', result.tokensIn],
    ['tokensOut', result.tokensOut],
    ['costUsd', result.costUsd],
    ['previewUrl', result.previewUrl],
    ['violation', result.violation],
    ['blockedPath', result.blockedPath],
    ['errorCode', result.errorCode],
    ['errorDetail', errorDetail],
  ];

  for (const [key, value] of optional) {
    if (value !== undefined) Object.assign(record, { [key]: value });
  }

  return record;
}

/**
 * The prose is what the client reads, and it is written from the closed
 * vocabulary rather than from whatever the failure happened to carry — a
 * detail string is diagnostic material and belongs in the block, never in the
 * sentence (Principle I).
 */
function proseFor(result: FinishInput): string {
  const code: ErrorCode = result.errorCode ?? 'internal_error';
  return CLIENT_MESSAGES[code];
}

// ---------------------------------------------------------------------------

async function discard(tree: WorkingTree | null, controlDir: string | null): Promise<void> {
  // A blocked change is discarded by deleting the tree; nothing was committed,
  // so there is no state to unwind.
  await Promise.allSettled([
    tree?.dispose(),
    controlDir ? rm(controlDir, { recursive: true, force: true }) : Promise.resolve(),
  ]);
}

/**
 * Tells the developer their site spent more on one request than they allowed
 * (FR-014).
 *
 * Addressed to `alertContact`, which is a developer rather than a client, so
 * this is the one message in the job path that may carry the figures — the
 * client's own sentence stays inside the closed vocabulary (Principle I).
 *
 * It cannot fail the request. The ceiling has already done the work that
 * matters by stopping the push, and a mail server being down is no reason to
 * report a different ending than the one that happened.
 */
async function alertCostCeiling(deps: RunDeps, input: RunInput, costUsd: number): Promise<void> {
  const { alertContact, costCeilingUsd } = deps.config.settings;
  if (!deps.mailer || !alertContact) return;

  try {
    await deps.mailer.send({
      to: alertContact,
      subject: 'Cost ceiling reached on a change request',
      text: [
        `A change request on ${deps.env.githubRepoOwner}/${deps.env.githubRepoName} was stopped ` +
          `before it published anything: it cost $${costUsd}, and this site's ceiling ` +
          `is $${costCeilingUsd}.`,
        `Nothing was pushed. The conversation: ${deps.env.publicBaseUrl}/c/${input.conversationNumber}`,
      ].join('\n\n'),
    });
  } catch (cause) {
    console.error(
      `[webagent] could not alert ${alertContact} that the cost ceiling was reached`,
      cause,
    );
  }
}

/**
 * A request the previous process abandoned leaves a lock and no ending. The
 * process that breaks the lock writes the ending, because it is the only one
 * left that knows the request existed (FR-007c).
 */
async function recordAbandoned(
  deps: RunDeps,
  input: RunInput,
  broken: { brokenRequestId?: string; brokenStartedAt?: string },
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const record: RequestRecord = {
    requestId: broken.brokenRequestId ?? 'r_unknown',
    // The lock commit names when its request began, and that is the only
    // trace of the fact the dead process left anywhere. Falling back to now
    // would report a request that ran for no time at all, which is a worse
    // answer than an approximate one.
    startedAt: broken.brokenStartedAt ?? now,
    finishedAt: now,
    outcome: 'abandoned',
    stages: [],
  };

  try {
    await deps.client.createComment(
      input.conversationNumber,
      renderRecord(INTERRUPTED_MESSAGE, record),
    );
  } catch {
    // Recording the abandonment is a courtesy to the conversation's history;
    // failing to record it must not stop the request that is starting now.
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

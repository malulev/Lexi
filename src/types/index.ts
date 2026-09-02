/**
 * The shared vocabulary of the installation.
 *
 * Every module below `src/lib` speaks these types at its boundary. They are
 * declared once, here, because the modules are developed independently and a
 * disagreement about a shape is the one bug the tests cannot catch in isolation.
 *
 * Nothing here is persisted. Per constitution VII, GitHub and Netlify are the
 * system of record; these types describe what is read from them, held while a
 * request runs, or written back to them.
 */

// ---------------------------------------------------------------------------
// Installation and configuration
// ---------------------------------------------------------------------------

/** Deployment configuration: secrets and the one site this install serves. */
export interface Env {
  githubAppId: string;
  githubAppPrivateKey: string;
  githubInstallationId: number;
  /** `owner/name` split at load time so no caller re-parses it. */
  githubRepoOwner: string;
  githubRepoName: string;
  netlifyToken: string;
  netlifySiteId: string;
  netlifyWebhookSecret: string;
  openrouterApiKey: string;
  sessionSecret: string;
  /** Lower-cased and de-duplicated. Never sourced from the repository. */
  allowedEmails: string[];
  configPasswordHash: string;
  configTotpSecret: string;
  smtpUrl: string;
  smtpFrom: string;
  publicBaseUrl: string;
}

/** Non-secret operational settings from `.webagent/config.yml`. */
export interface Settings {
  alertContact: string;
  costCeilingUsd: number;
  model: string;
  /** 1–30. Doubles as the lock staleness threshold. */
  maxRequestMinutes: number;
}

/** Site-declared limits from `.webagent/policy.yml`. All fields defaulted. */
export interface Policy {
  allow: string[];
  deny: string[];
  maxFilesChanged: number;
  maxDiffLines: number;
  forbidNewDependencies: boolean;
}

/** What the repository declares, read together because they change together. */
export interface RepoConfig {
  settings: Settings;
  policy: Policy;
  /** `AGENTS.md` at the repository root. Advisory only; empty when absent. */
  guidance: string;
}

// ---------------------------------------------------------------------------
// The policy gate
// ---------------------------------------------------------------------------

export type ChangeKind = 'added' | 'modified' | 'deleted';

/** One path the agent touched, as derived from the working tree's status. */
export interface ChangedFile {
  path: string;
  kind: ChangeKind;
  /** Added plus removed lines for this file. */
  diffLines: number;
}

export type PolicyViolation =
  | 'protected_path'
  | 'denied_path'
  | 'not_allowed_path'
  | 'too_many_files'
  | 'too_many_lines'
  | 'new_dependency';

export type GateResult =
  | { ok: true }
  | {
      ok: false;
      violation: PolicyViolation;
      /** The offending path, so the client-facing message can name the area. */
      path?: string;
      actual?: number;
      limit?: number;
    };

// ---------------------------------------------------------------------------
// Requests and their stages
// ---------------------------------------------------------------------------

export type Stage =
  | 'starting'
  | 'running'
  | 'gating'
  | 'pushing'
  | 'building'
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'abandoned';

export type Outcome = 'succeeded' | 'blocked' | 'failed' | 'abandoned';

/** The client-facing error vocabulary from contracts/http-api.md. */
export type ErrorCode =
  | 'blocked_by_policy'
  | 'request_in_flight'
  | 'agent_timeout'
  | 'build_failed'
  | 'site_unreachable'
  | 'cost_ceiling'
  | 'out_of_date'
  | 'nothing_to_change'
  | 'internal_error';

export interface StageEvent {
  stage: Stage;
  /** ISO 8601, always UTC. */
  at: string;
}

/** An event on the progress stream. Live output is best effort; stages are not. */
export type JobEvent =
  | { type: 'stage'; requestId: string; stage: Stage; at: string }
  | { type: 'output'; requestId: string; text: string }
  | {
      type: 'done';
      requestId: string;
      outcome: Outcome;
      previewUrl?: string;
      errorCode?: ErrorCode;
    };

/** Notification kinds, listed in the record so sending stays idempotent. */
export type NotificationEvent =
  | 'preview_ready'
  | 'request_blocked'
  | 'request_failed'
  | 'published'
  | 'undone';

// ---------------------------------------------------------------------------
// The durable record — contracts/durable-record.md
// ---------------------------------------------------------------------------

/** The machine-readable block inside a pull request comment. */
export interface RequestRecord {
  requestId: string;
  startedAt: string;
  finishedAt: string;
  outcome: Outcome;
  stages: StageEvent[];
  commitSha?: string;
  filesChanged?: number;
  diffLines?: number;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  previewUrl?: string;
  notified?: NotificationEvent[];
  /** Present when `outcome` is `blocked`. */
  violation?: PolicyViolation;
  blockedPath?: string;
  /** Present when `outcome` is `failed`. */
  errorCode?: ErrorCode;
  errorDetail?: string;
}

/** A comment rendered for the conversation: prose, plus a block when present. */
export interface RecordedComment {
  /** The pull request comment id, so a record can be updated in place. */
  commentId: number;
  author: string;
  createdAt: string;
  /** Client-facing prose. Stands alone without the block (Principle I). */
  prose: string;
  /** Absent for a human comment, or one whose block would not parse. */
  record?: RequestRecord;
}

// ---------------------------------------------------------------------------
// Conversations — a conversation *is* a pull request
// ---------------------------------------------------------------------------

export type ConversationStatus = 'open' | 'published' | 'closed';

export interface Conversation {
  number: number;
  title: string;
  status: ConversationStatus;
  branch: string;
  headSha: string;
  updatedAt: string;
  previewUrl?: string;
}

export type MessageAuthor = 'client' | 'agent';

/** One turn in the conversation, reconstructed from a pull request comment. */
export interface Message {
  id: number;
  author: MessageAuthor;
  at: string;
  text: string;
  outcome?: Outcome;
  errorCode?: ErrorCode;
  previewUrl?: string;
}

// ---------------------------------------------------------------------------
// The agent container — contracts/repo-files.md
// ---------------------------------------------------------------------------

/** Written to `/control/prompt.json`. The container's only instruction channel. */
export interface AgentPrompt {
  request: string;
  history: Array<{ author: MessageAuthor; text: string }>;
  guidance: string;
  targetHint?: string;
}

/** Read from `/control/result.json` after the container exits. */
export interface AgentResult {
  summary: string;
  filesChanged: string[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** A signed cookie. There is no server-side session record. */
export interface Session {
  email: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

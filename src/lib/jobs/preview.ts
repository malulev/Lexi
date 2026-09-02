import type { JobBus } from '@/lib/jobs/bus';
import type { NetlifyClient } from '@/lib/netlify';
import type { Deploy } from '@/lib/netlify/types';
import { deployEffect } from '@/lib/netlify/webhook';

/**
 * Waiting for the hosting provider to finish building the preview.
 *
 * Two things can tell us a preview is ready: the webhook, which is fast and may
 * never arrive, and the deploy list, which always answers but only when asked.
 * Relying on the webhook alone makes the whole loop hostage to a delivery this
 * installation does not control; polling alone spends the latency budget it is
 * supposed to protect. So both run, and whichever answers first wins.
 */

export type PreviewOutcome =
  | { kind: 'ready'; previewUrl: string }
  | { kind: 'build_failed'; detail: string }
  | { kind: 'timed_out' };

export interface WaitForPreviewInput {
  conversationNumber: number;
  commitSha: string;
  timeoutMs: number;
  pollIntervalMs?: number;
}

export interface WaitForPreviewDeps {
  netlify: NetlifyClient;
  bus: JobBus;
  requestId: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;

export async function waitForPreview(
  deps: WaitForPreviewDeps,
  input: WaitForPreviewInput,
): Promise<PreviewOutcome> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;
  const interval = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = now() + input.timeoutMs;

  while (now() < deadline) {
    const deploy = await findDeploy(deps.netlify, input);
    const outcome = deploy ? interpret(deploy) : null;
    if (outcome) return outcome;

    await sleep(Math.min(interval, Math.max(0, deadline - now())));
  }

  return { kind: 'timed_out' };
}

/**
 * The pull request number is the reliable correlation; the commit reference is
 * the fallback for a deploy whose review identifier the provider did not carry
 * (R4 records this exact uncertainty).
 */
async function findDeploy(
  netlify: NetlifyClient,
  input: WaitForPreviewInput,
): Promise<Deploy | null> {
  const byPullRequest = await netlify.findDeployByPullRequest(input.conversationNumber);
  if (byPullRequest) return byPullRequest;
  return netlify.findDeployByCommit(input.commitSha);
}

/** `null` means the deploy is still in flight and the caller should keep waiting. */
function interpret(deploy: Deploy): PreviewOutcome | null {
  const effect = deployEffect(deploy);
  if (effect.kind === 'preview_ready') return { kind: 'ready', previewUrl: effect.previewUrl };
  if (effect.kind === 'build_failed') return { kind: 'build_failed', detail: effect.detail };
  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

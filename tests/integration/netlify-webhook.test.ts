// T050 — Netlify webhook handling (R4, contracts/http-api.md's Webhook
// section). This constructs its own dependencies rather than importing
// `POST /api/webhooks/netlify`, which does not exist yet: the route handler
// is a later slice that will call exactly these two library functions.
//
// Covers: correlating a deploy to a conversation by pull request number,
// falling back to commit reference, ignoring a deploy that matches neither,
// and idempotency under a repeated delivery of the same event.
import { createHmac, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyAndParseWebhook, correlateDeploy, deployEffect } from '@/lib/netlify/webhook';

const WEBHOOK_SECRET = process.env.NETLIFY_WEBHOOK_SECRET!;

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, '..', 'fixtures', 'netlify', name), 'utf8');
}

/**
 * Builds a valid `X-Webhook-Signature` header the way Netlify's own docs
 * describe: a compact JWS, HS256, whose payload carries `iss: "netlify"`
 * and `sha256` of the raw body. This is the only way to exercise a real
 * delivery from a test — Netlify's servers are the only real signer, and
 * this installation cannot ask them for one (see the reconciliation note
 * for exactly what about this scheme remains unverified).
 */
function signWebhookBody(rawBody: string, secret: string): string {
  const base64url = (input: string): string => Buffer.from(input).toString('base64url');
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const sha256 = createHash('sha256').update(rawBody).digest('hex');
  const payload = base64url(JSON.stringify({ iss: 'netlify', sha256 }));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// The conversations a real deployment would assemble from open pull
// requests (data-model.md's Conversation). Only `number` and `headSha`
// matter to correlation.
const OPEN_CONVERSATIONS = [
  { number: 42, headSha: 'bbbbbbb2222222222222222222222222222222' },
  { number: 17, headSha: 'eeeeeee5555555555555555555555555555555' },
];

describe('verifyAndParseWebhook + correlateDeploy', () => {
  it('correlates a deploy to its conversation by pull request number', () => {
    const rawBody = loadFixture('webhook-deploy-preview-ready.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);

    const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');

    const correlation = correlateDeploy(parsed.deploy, OPEN_CONVERSATIONS);

    expect(correlation).toEqual({ conversationNumber: 42 });
  });

  it('falls back to commit reference when the deploy carries no matching pull request number', () => {
    const rawBody = loadFixture('webhook-deploy-branch-fallback.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);

    const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');

    // This fixture carries no review_id at all — the fallback path is what
    // must find conversation 17, via its head commit.
    expect(parsed.deploy.reviewId).toBeUndefined();

    const correlation = correlateDeploy(parsed.deploy, OPEN_CONVERSATIONS);

    expect(correlation).toEqual({ conversationNumber: 17 });
  });

  it('ignores a deploy that matches no open conversation, rather than erroring', () => {
    const rawBody = loadFixture('webhook-deploy-unrelated.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);

    const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');

    const correlation = correlateDeploy(parsed.deploy, OPEN_CONVERSATIONS);

    // Netlify sends deploys for pushes that have nothing to do with this
    // product (R4). Returning null here — not throwing — is the caller's
    // signal to ignore the event silently.
    expect(correlation).toBeNull();
  });

  it('tolerates a deploy payload carrying fields this installation has never seen', () => {
    const rawBody = loadFixture('webhook-deploy-unknown-fields.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);

    const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.deploy.id).toBe('deploy-future');
  });

  it('rejects a payload whose signature does not match the body', () => {
    const rawBody = loadFixture('webhook-deploy-preview-ready.json');
    const signature = signWebhookBody(rawBody, 'a-completely-different-secret');

    const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);

    expect(parsed).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a body that was tampered with after signing', () => {
    const rawBody = loadFixture('webhook-deploy-preview-ready.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);
    const tamperedBody = rawBody.replace('"state": "ready"', '"state": "error"');

    const parsed = verifyAndParseWebhook(tamperedBody, signature, WEBHOOK_SECRET);

    expect(parsed).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('reports an unparseable body separately from a bad signature', () => {
    const rawBody = '{ this is not valid json';
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);

    const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);

    expect(parsed).toEqual({ ok: false, reason: 'unparseable' });
  });

  it('rejects a missing signature header outright', () => {
    const rawBody = loadFixture('webhook-deploy-preview-ready.json');

    const parsed = verifyAndParseWebhook(rawBody, null, WEBHOOK_SECRET);

    expect(parsed).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('deployEffect', () => {
  it('reports a successful preview as preview_ready with its url', () => {
    const rawBody = loadFixture('webhook-deploy-preview-ready.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);
    const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);
    if (!parsed.ok) throw new Error('unreachable');

    expect(deployEffect(parsed.deploy)).toEqual({
      kind: 'preview_ready',
      previewUrl: 'https://deploy-preview-42--client-site.netlify.app',
    });
  });

  it('reports a failed build as build_failed with the error detail', () => {
    const rawBody = loadFixture('webhook-deploy-build-failed.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);
    const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);
    if (!parsed.ok) throw new Error('unreachable');

    expect(deployEffect(parsed.deploy)).toEqual({
      kind: 'build_failed',
      detail: 'Build script returned non-zero exit code: 2',
    });
  });
});

describe('idempotency: the same event delivered twice', () => {
  // There is no datastore to record "this delivery id was already
  // processed" (constitution VII). Instead, the action itself is made
  // idempotent: deployEffect is a pure function of the deploy's content, so
  // deriving it twice from two identical deliveries yields the identical
  // effect. A caller that writes that effect into the durable record
  // (data-model.md's Request Record) simply overwrites the same fields with
  // the same values on a repeat delivery — nothing accumulates, nothing
  // double-fires.
  it('produces the same correlation and the same effect on a repeated delivery', () => {
    const rawBody = loadFixture('webhook-deploy-preview-ready.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);

    const firstDelivery = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);
    const secondDelivery = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);
    if (!firstDelivery.ok || !secondDelivery.ok) throw new Error('unreachable');

    const firstCorrelation = correlateDeploy(firstDelivery.deploy, OPEN_CONVERSATIONS);
    const secondCorrelation = correlateDeploy(secondDelivery.deploy, OPEN_CONVERSATIONS);
    expect(secondCorrelation).toEqual(firstCorrelation);

    const firstEffect = deployEffect(firstDelivery.deploy);
    const secondEffect = deployEffect(secondDelivery.deploy);
    expect(secondEffect).toEqual(firstEffect);
  });

  it('produces the same ignore outcome when an unrelated deploy is redelivered', () => {
    const rawBody = loadFixture('webhook-deploy-unrelated.json');
    const signature = signWebhookBody(rawBody, WEBHOOK_SECRET);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parsed = verifyAndParseWebhook(rawBody, signature, WEBHOOK_SECRET);
      if (!parsed.ok) throw new Error('unreachable');
      expect(correlateDeploy(parsed.deploy, OPEN_CONVERSATIONS)).toBeNull();
    }
  });
});

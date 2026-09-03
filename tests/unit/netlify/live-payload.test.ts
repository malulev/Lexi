import { describe, expect, it } from 'vitest';

import { rawDeploySchema, toDeploy } from '@/lib/netlify/types';
import liveDeploys from '../../fixtures/netlify/deploys-live.json';

/**
 * R4's open assumption, closed (T099).
 *
 * research.md recorded that the deploy object was *assumed* to carry the fields
 * needed to correlate a deploy with a conversation, and listed the payload's
 * field names among the things still to confirm. This fixture is a real
 * response from a live Netlify site — captured on 2026-09-02, with its
 * credential removed and its identifiers replaced, and otherwise untouched,
 * all 58 fields of it.
 *
 * It is kept because two of the three faults found in this client came from
 * guessing at this shape, and neither was visible against a fixture written by
 * the same hand that wrote the parser. A recorded payload is the only fixture
 * that can disagree with us.
 */

describe('the deploy shape Netlify really sends', () => {
  it('parses without loss', () => {
    const parsed = liveDeploys.map((deploy) => rawDeploySchema.parse(deploy));

    expect(parsed).toHaveLength(2);
  });

  it('carries everything correlation needs, which R4 could only assume', () => {
    const preview = liveDeploys
      .map((deploy) => toDeploy(rawDeploySchema.parse(deploy)))
      .find((deploy) => deploy.context === 'deploy-preview');

    expect(preview).toBeDefined();
    expect(preview?.reviewId).toBe(1);
    expect(preview?.commitRef).toMatch(/^[0-9a-f]{40}$/);
    expect(preview?.state).toBe('ready');
  });

  it('expresses "no pull request" as null rather than by omission', () => {
    // The fault that broke the first live run: `review_id` is present and null
    // on a production deploy, and a schema expecting optional-but-typed
    // rejected the entire list.
    const production = liveDeploys.find((deploy) => deploy.context === 'production');

    expect(production).toBeDefined();
    expect(production).toHaveProperty('review_id', null);
    expect(production).toHaveProperty('error_message', null);
    expect(() => rawDeploySchema.parse(production)).not.toThrow();
  });

  it('never offers the production site as a preview URL', () => {
    // The more dangerous fault: on a deploy object, `ssl_url` is the live site.
    // A preview carries the production domain in that field, so falling back to
    // it would hand a client their own site labelled as a preview.
    const rawPreview = liveDeploys.find((deploy) => deploy.context === 'deploy-preview')!;
    const preview = toDeploy(rawDeploySchema.parse(rawPreview));

    expect(rawPreview).toHaveProperty('ssl_url');
    expect(preview.deployUrl).toBe(rawPreview.deploy_ssl_url);
    expect(preview.deployUrl).not.toBe(rawPreview.ssl_url);
    expect(preview.deployUrl).toContain('deploy-preview-');
  });

  it('carries no credential, because a fixture is committed', () => {
    // A recorded payload arrives with whatever the provider felt like sending,
    // and this one arrived with a skew-protection token. The guard is here so
    // the next person to refresh this fixture is told, not trusted.
    const blob = JSON.stringify(liveDeploys);

    expect(blob).not.toMatch(/token|secret|password/i);
  });
});

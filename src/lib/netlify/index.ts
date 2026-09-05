/**
 * Public surface of the Netlify module: the REST client that fetches and
 * locates deploys (`createNetlifyClient`), and the pure webhook pipeline
 * that verifies, parses, correlates, and interprets a deploy event.
 */

export type { Deploy, DeployState, DeployContext } from './types';
export type { NetlifyClient } from './client';
export { createNetlifyClient } from './client';
// The fake is deliberately not re-exported here. This barrel is imported by
// startup validation, so anything named in it is reachable from the deployed
// bundle — and a test double is not something to ship. Tests import
// `@/lib/netlify/fake` directly, which is where a test double belongs.
export type { WebhookResult, Correlation, DeployEffect } from './webhook';
export { verifyAndParseWebhook, correlateDeploy, deployEffect } from './webhook';

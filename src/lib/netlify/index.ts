/**
 * Public surface of the Netlify module: the REST client that fetches and
 * locates deploys (`createNetlifyClient`), and the pure webhook pipeline
 * that verifies, parses, correlates, and interprets a deploy event.
 */

export type { Deploy, DeployState, DeployContext } from './types';
export type { NetlifyClient } from './client';
export { createNetlifyClient } from './client';
export type { FakeNetlifyClient } from './fake';
export { createFakeNetlifyClient } from './fake';
export type { WebhookResult, Correlation, DeployEffect } from './webhook';
export { verifyAndParseWebhook, correlateDeploy, deployEffect } from './webhook';

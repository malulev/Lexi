import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describe as describeError, initLogRedaction, log, resetLogRedaction } from '@/lib/log';
import type { Env } from '@/types';

/**
 * The properties that make a log line safe to ship to somewhere that is not
 * this box. Everything here is about what must *not* come out.
 */

const PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
const NETLIFY_TOKEN = 'nfp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OPENROUTER_KEY = 'sk-or-v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SESSION_SECRET = 'session-secret-that-is-long-enough-to-register';
const SMTP_URL = 'smtps://postmaster:hunter2@smtp.example.com:465';

const env = {
  githubAppPrivateKey: PRIVATE_KEY,
  netlifyToken: NETLIFY_TOKEN,
  netlifyWebhookSecret: 'webhook-secret-long-enough',
  openrouterApiKey: OPENROUTER_KEY,
  sessionSecret: SESSION_SECRET,
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  smtpUrl: SMTP_URL,
} as unknown as Env;

let written: string[] = [];
let originalLevel: string | undefined;

beforeEach(() => {
  written = [];
  originalLevel = process.env.LOG_LEVEL;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLogRedaction();
  if (originalLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLevel;
});

/** The single line the call produced, parsed. */
function lastLine(): Record<string, unknown> {
  expect(written).toHaveLength(1);
  expect(written[0]?.endsWith('\n')).toBe(true);
  return JSON.parse(written[0] as string) as Record<string, unknown>;
}

describe('log', () => {
  it('writes exactly one parseable JSON line carrying ts, level and event', () => {
    log.info('request.started', { requestId: 'req-1', conversationNumber: 7 });

    const line = lastLine();
    expect(line.level).toBe('info');
    expect(line.event).toBe('request.started');
    expect(line.requestId).toBe('req-1');
    expect(line.conversationNumber).toBe(7);
    expect(typeof line.ts).toBe('string');
    expect(new Date(line.ts as string).toISOString()).toBe(line.ts);
  });

  it('drops undefined fields rather than emitting nulls a query has to exclude', () => {
    log.info('request.ended', { requestId: 'req-1', errorCode: undefined, costUsd: 0 });

    const line = lastLine();
    expect('errorCode' in line).toBe(false);
    // Zero is a measurement, not an absence, and must survive.
    expect(line.costUsd).toBe(0);
  });

  it('honours LOG_LEVEL, so debug lines cost nothing in production', () => {
    process.env.LOG_LEVEL = 'warn';

    log.info('request.started', { requestId: 'req-1' });
    log.debug('request.started', { requestId: 'req-2' });
    expect(written).toHaveLength(0);

    log.error('http.unexpected', { context: 'route' });
    expect(written).toHaveLength(1);
  });
});

describe('redaction', () => {
  it('blanks a field whose name reads as a credential, whatever it holds', () => {
    log.error('http.unexpected', { sessionSecret: 'anything at all', apiKey: 'x', ok: 'kept' });

    const line = lastLine();
    expect(line.sessionSecret).toBe('[redacted]');
    expect(line.apiKey).toBe('[redacted]');
    expect(line.ok).toBe('kept');
  });

  it("blanks this installation's own secret values wherever they appear", () => {
    initLogRedaction(env);

    log.error('http.unexpected', {
      context: `mail failed for ${SMTP_URL}`,
      detail: `token ${NETLIFY_TOKEN} rejected`,
    });

    const line = lastLine();
    const serialised = JSON.stringify(line);
    expect(serialised).not.toContain(NETLIFY_TOKEN);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).toContain('[redacted]');
  });

  it('blanks credential-shaped values before any environment is loaded', () => {
    // Nothing registered: this is boot, or a test that never built an Env.
    log.error('http.unexpected', {
      a: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      b: PRIVATE_KEY,
      c: 'connecting to smtps://user:secretpass@mail.example.com',
    });

    const serialised = JSON.stringify(lastLine());
    expect(serialised).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(serialised).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(serialised).not.toContain('secretpass');
    // The scheme survives, so the line still says which service failed.
    expect(serialised).toContain('smtps://');
  });

  it('scrubs string arrays, which is how fault lists arrive', () => {
    initLogRedaction(env);

    log.warn('startup.refused', { faultSettings: ['NETLIFY_SITE_ID', `saw ${NETLIFY_TOKEN}`] });

    const serialised = JSON.stringify(lastLine());
    expect(serialised).toContain('NETLIFY_SITE_ID');
    expect(serialised).not.toContain(NETLIFY_TOKEN);
  });
});

describe('describe', () => {
  it('returns an error message, never the error object', () => {
    const cause = new Error('repository not found');
    // An Octokit-shaped error hangs the request on the error; none of it may
    // reach a line.
    Object.assign(cause, { request: { headers: { authorization: 'token ghs_leak' } } });

    const described = describeError(cause);

    expect(described).toBe('repository not found');
    expect(described).not.toContain('ghs_leak');
  });

  it('survives something that is not an Error at all', () => {
    expect(describeError('plain string')).toBe('plain string');
    expect(describeError(undefined)).toBe('undefined');
  });
});

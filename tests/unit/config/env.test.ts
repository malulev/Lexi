import { describe, expect, it } from 'vitest';
import { loadEnv, parseEnv } from '@/lib/config/env';

// A minimal set of values that satisfies every required variable. Individual
// tests mutate a copy of this so a failure can never be blamed on an
// unrelated field.
function validRawEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN KEY-----\\nabc\\n-----END KEY-----',
    GITHUB_INSTALLATION_ID: '7890',
    GITHUB_REPO: 'client-org/client-site',
    NETLIFY_TOKEN: 'netlify-token',
    NETLIFY_SITE_ID: 'netlify-site-id',
    NETLIFY_WEBHOOK_SECRET: 'netlify-webhook-secret',
    OPENROUTER_API_KEY: 'openrouter-key',
    SESSION_SECRET: 'a'.repeat(32),
    ALLOWED_EMAILS: 'Jane@Client.example, marketing@client.example',
    CONFIG_PASSWORD_HASH: 'argon2id$hash',
    CONFIG_TOTP_SECRET: 'BASE32SECRET',
    SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
    SMTP_FROM: 'webagent@client.example',
    PUBLIC_BASE_URL: 'https://client.example',
  };
}

describe('parseEnv', () => {
  it('accepts a fully populated environment and returns the typed Env', () => {
    const env = parseEnv(validRawEnv());

    expect(env.githubAppId).toBe('123456');
    expect(env.githubInstallationId).toBe(7890);
    expect(env.githubRepoOwner).toBe('client-org');
    expect(env.githubRepoName).toBe('client-site');
    expect(env.publicBaseUrl).toBe('https://client.example');
  });

  it('turns literal \\n sequences in the private key into real newlines', () => {
    const env = parseEnv(validRawEnv());

    expect(env.githubAppPrivateKey).toBe('-----BEGIN KEY-----\nabc\n-----END KEY-----');
    expect(env.githubAppPrivateKey).not.toContain('\\n');
  });

  it.each([
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_INSTALLATION_ID',
    'GITHUB_REPO',
    'NETLIFY_TOKEN',
    'NETLIFY_SITE_ID',
    'NETLIFY_WEBHOOK_SECRET',
    'OPENROUTER_API_KEY',
    'SESSION_SECRET',
    'ALLOWED_EMAILS',
    'CONFIG_PASSWORD_HASH',
    'CONFIG_TOTP_SECRET',
    'SMTP_URL',
    'SMTP_FROM',
    'PUBLIC_BASE_URL',
  ])('rejects a missing %s', (key) => {
    const raw = validRawEnv();
    delete raw[key];

    expect(() => parseEnv(raw)).toThrow();
  });

  it('rejects a GITHUB_REPO with no slash', () => {
    const raw = validRawEnv();
    raw.GITHUB_REPO = 'client-site';

    expect(() => parseEnv(raw)).toThrow(/GITHUB_REPO/);
  });

  it('rejects a GITHUB_REPO with more than one slash', () => {
    const raw = validRawEnv();
    raw.GITHUB_REPO = 'client-org/nested/client-site';

    expect(() => parseEnv(raw)).toThrow(/GITHUB_REPO/);
  });

  it('splits a well-formed GITHUB_REPO into owner and name', () => {
    const raw = validRawEnv();
    raw.GITHUB_REPO = 'acme/marketing-site';

    const env = parseEnv(raw);

    expect(env.githubRepoOwner).toBe('acme');
    expect(env.githubRepoName).toBe('marketing-site');
  });

  it('rejects a SESSION_SECRET shorter than 32 characters', () => {
    const raw = validRawEnv();
    raw.SESSION_SECRET = 'too-short';

    expect(() => parseEnv(raw)).toThrow(/SESSION_SECRET/);
  });

  it('rejects a PUBLIC_BASE_URL that is not an absolute URL', () => {
    const raw = validRawEnv();
    raw.PUBLIC_BASE_URL = '/relative/path';

    expect(() => parseEnv(raw)).toThrow(/PUBLIC_BASE_URL/);
  });

  it('rejects an empty ALLOWED_EMAILS', () => {
    const raw = validRawEnv();
    raw.ALLOWED_EMAILS = '';

    expect(() => parseEnv(raw)).toThrow(/ALLOWED_EMAILS/);
  });

  it('rejects an ALLOWED_EMAILS made only of blanks and commas', () => {
    const raw = validRawEnv();
    raw.ALLOWED_EMAILS = ' , , ';

    expect(() => parseEnv(raw)).toThrow(/ALLOWED_EMAILS/);
  });

  it('rejects an ALLOWED_EMAILS entry that is not a plausible email address', () => {
    const raw = validRawEnv();
    raw.ALLOWED_EMAILS = 'jane@client.example, not-an-email';

    expect(() => parseEnv(raw)).toThrow(/ALLOWED_EMAILS/);
  });

  it('normalises ALLOWED_EMAILS to trimmed, lower-cased, de-duplicated addresses', () => {
    const raw = validRawEnv();
    raw.ALLOWED_EMAILS = ' Jane@Client.example ,marketing@Client.example, jane@client.example ';

    const env = parseEnv(raw);

    expect(env.allowedEmails).toEqual(['jane@client.example', 'marketing@client.example']);
  });

  it('names every fault in one aggregated error rather than stopping at the first', () => {
    const raw = validRawEnv();
    raw.SESSION_SECRET = 'too-short';
    raw.GITHUB_REPO = 'no-slash-here';
    delete raw.NETLIFY_TOKEN;

    let thrown: Error | undefined;
    try {
      parseEnv(raw);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown?.message).toMatch(/SESSION_SECRET/);
    expect(thrown?.message).toMatch(/GITHUB_REPO/);
    expect(thrown?.message).toMatch(/NETLIFY_TOKEN/);
    // Three distinct faults means at least three separate lines, not one
    // message that only ever names the first problem it met.
    const lineCount = thrown!.message.split('\n').filter((line) => line.trim().length > 0).length;
    expect(lineCount).toBeGreaterThanOrEqual(3);
  });

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
});

describe('loadEnv', () => {
  it('reads process.env lazily and memoises the result rather than re-reading on every call', () => {
    const originalEnv = process.env;
    process.env = { ...validRawEnv() } as NodeJS.ProcessEnv;

    try {
      const first = loadEnv();
      // Mutating process.env after the first call must have no effect: a
      // second read would otherwise let configuration drift mid-process.
      process.env.SESSION_SECRET = 'b'.repeat(40);
      const second = loadEnv();

      expect(second).toBe(first);
      expect(second.sessionSecret).toBe('a'.repeat(32));
    } finally {
      process.env = originalEnv;
    }
  });
});

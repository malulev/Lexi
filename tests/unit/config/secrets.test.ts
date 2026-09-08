// T097a — FR-003d: secrets are deployment configuration, never repository
// configuration. `.webagent/config.yml` lives in a repository the client's
// developers can push to, and it is read by a process holding credentials for
// their site; a schema that accepted a secret-shaped field would turn a commit
// into a way of supplying one.
//
// The schema is strict, so an unknown key is already rejected. What these
// tests add is that the rejection *names the mistake*: a developer who commits
// `netlifyToken` has misunderstood where secrets live, and a message about an
// unrecognised key does not tell them so.
import { describe, expect, it } from 'vitest';

import { parseSettings } from '@/lib/config/settings';

const VALID_SETTINGS = `
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
`;

/** Every secret this installation actually holds, spelled as a settings key. */
const SECRET_SHAPED_KEYS = [
  'githubAppPrivateKey',
  'githubToken',
  'netlifyToken',
  'netlifyWebhookSecret',
  'openrouterApiKey',
  'sessionSecret',
  'configPasswordHash',
  'totpSecret',
  'smtpPassword',
  'apiKey',
  'password',
  'credentials',
];

describe('the settings schema accepts no secret-shaped field', () => {
  it.each(SECRET_SHAPED_KEYS)('rejects `%s` rather than honouring it', (key) => {
    const withSecret = `${VALID_SETTINGS}${key}: a-value-that-should-never-live-here\n`;

    expect(() => parseSettings(withSecret)).toThrow(new RegExp(key));
  });

  it.each(SECRET_SHAPED_KEYS)('tells the developer where `%s` belongs instead', (key) => {
    const withSecret = `${VALID_SETTINGS}${key}: a-value-that-should-never-live-here\n`;

    expect(() => parseSettings(withSecret)).toThrow(/deployment configuration/);
    expect(() => parseSettings(withSecret)).toThrow(/secret/i);
  });

  it('never echoes the committed value back in the message', () => {
    const withSecret = `${VALID_SETTINGS}netlifyToken: nfp_a_real_looking_token\n`;

    expect(() => parseSettings(withSecret)).toThrow();
    try {
      parseSettings(withSecret);
    } catch (error) {
      expect((error as Error).message).not.toContain('nfp_a_real_looking_token');
    }
  });

  it('rejects the whole file, so no other setting in it takes effect either', () => {
    const withSecret = `${VALID_SETTINGS}netlifyToken: nfp_token\n`;

    // Parsing is all-or-nothing on purpose: honouring the valid half would
    // leave the repository quietly influencing a running installation.
    expect(() => parseSettings(withSecret)).toThrow();
  });

  it('declares no secret-shaped field of its own', () => {
    const settings = parseSettings(VALID_SETTINGS);

    const secretShaped = /secret|token|password|passphrase|api[-_]?key|private[-_]?key|credential/i;
    expect(Object.keys(settings).filter((key) => secretShaped.test(key))).toEqual([]);
  });

  it('still accepts the four operational settings the contract declares', () => {
    expect(parseSettings(VALID_SETTINGS)).toEqual({
      alertContact: 'dev@agency.example',
      costCeilingUsd: 2,
      model: 'openrouter/anthropic/claude-sonnet-latest',
      maxRequestMinutes: 10,
    });
  });
});

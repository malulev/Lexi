// `.webagent/config.yml` is developer-facing: a typo or a misplaced key must fail
// loudly rather than be silently ignored or, worse, silently accepted with a
// permissive default. These tests pin down the exact faults contracts/repo-files.md
// promises, not merely that *a* throw happens.
import { describe, expect, it } from 'vitest';
import { parseSettings } from '@/lib/config/settings';

const VALID_YAML = `
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
`;

describe('parseSettings', () => {
  it('accepts a config with every required field present and valid', () => {
    const settings = parseSettings(VALID_YAML);

    expect(settings).toEqual({
      alertContact: 'dev@agency.example',
      costCeilingUsd: 2.0,
      model: 'openrouter/anthropic/claude-sonnet-latest',
      maxRequestMinutes: 10,
    });
  });

  it('rejects a YAML syntax error as a settings fault, not an unhandled throw', () => {
    const malformed = 'alertContact: [unterminated';

    expect(() => parseSettings(malformed)).toThrow();
  });

  it('rejects an unknown field instead of silently ignoring it', () => {
    const withTypo = `
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
alrtContact: dev@agency.example
`;

    expect(() => parseSettings(withTypo)).toThrow();
  });

  it('names allowedEmails and points at deployment configuration when the key is present', () => {
    const withAllowedEmails = `
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
allowedEmails:
  - dev@agency.example
`;

    expect(() => parseSettings(withAllowedEmails)).toThrow(/ALLOWED_EMAILS/);
    expect(() => parseSettings(withAllowedEmails)).toThrow(/deployment configuration/);
    expect(() => parseSettings(withAllowedEmails)).toThrow(/allowedEmails/);
  });

  it('rejects a missing required field', () => {
    const missingAlertContact = `
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
`;

    expect(() => parseSettings(missingAlertContact)).toThrow();
  });

  it('rejects an alertContact that is not a valid email', () => {
    const badEmail = `
alertContact: not-an-email
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
`;

    expect(() => parseSettings(badEmail)).toThrow();
  });

  it('rejects a costCeilingUsd of zero or below', () => {
    const zeroCeiling = `
alertContact: dev@agency.example
costCeilingUsd: 0
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: 10
`;

    expect(() => parseSettings(zeroCeiling)).toThrow();
  });

  it('rejects a model that is not in provider/model shape', () => {
    const badModel = `
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: claude-sonnet-latest
maxRequestMinutes: 10
`;

    expect(() => parseSettings(badModel)).toThrow();
  });

  it.each([0, -1, 31, 1.5])(
    'rejects a maxRequestMinutes of %s as out of the 1-30 bound',
    (value) => {
      const outOfBounds = `
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: ${value}
`;

      expect(() => parseSettings(outOfBounds)).toThrow();
    },
  );

  it.each([1, 30])('accepts a maxRequestMinutes at the %s-minute boundary', (value) => {
    const atBoundary = `
alertContact: dev@agency.example
costCeilingUsd: 2.00
model: openrouter/anthropic/claude-sonnet-latest
maxRequestMinutes: ${value}
`;

    expect(() => parseSettings(atBoundary)).not.toThrow();
  });
});

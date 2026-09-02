import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, parsePolicy } from '@/lib/policy/parse';

describe('parsePolicy', () => {
  it('returns the documented defaults when the policy file is absent', () => {
    // FR-019: a site that declares no policy still gets the protective
    // default, rather than an unrestricted one.
    expect(parsePolicy(null)).toEqual(DEFAULT_POLICY);
  });

  it('returns the documented defaults when the policy file is present but empty', () => {
    expect(parsePolicy('')).toEqual(DEFAULT_POLICY);
  });

  it('fills in defaults for every field a site omits', () => {
    const source = `
allow:
  - "src/content/**"
`;

    expect(parsePolicy(source)).toEqual({
      ...DEFAULT_POLICY,
      allow: ['src/content/**'],
    });
  });

  it('parses every field from a fully specified policy', () => {
    const source = `
allow:
  - "src/components/**"
  - "src/content/**"
  - "public/images/**"
deny:
  - "src/lib/payments/**"
maxFilesChanged: 5
maxDiffLines: 200
forbidNewDependencies: false
`;

    expect(parsePolicy(source)).toEqual({
      allow: ['src/components/**', 'src/content/**', 'public/images/**'],
      deny: ['src/lib/payments/**'],
      maxFilesChanged: 5,
      maxDiffLines: 200,
      forbidNewDependencies: false,
    });
  });

  it('throws a descriptive error for content that is not valid YAML', () => {
    const source = 'allow: ["src/components/**"';

    expect(() => parsePolicy(source)).toThrow(/yaml/i);
  });

  it('throws a descriptive error when a field has the wrong type', () => {
    const source = 'maxFilesChanged: "fifteen"';

    expect(() => parsePolicy(source)).toThrow();
  });

  it('throws a descriptive error when allow is not a list of strings', () => {
    const source = 'allow: "src/components/**"';

    expect(() => parsePolicy(source)).toThrow();
  });

  it('throws a descriptive error rather than silently ignoring an unknown field', () => {
    const source = 'allowedEmails: ["dev@agency.example"]';

    expect(() => parsePolicy(source)).toThrow();
  });

  it('names the offending policy field in the parse error, not just "invalid"', () => {
    const source = 'maxDiffLines: "eight hundred"';

    expect(() => parsePolicy(source)).toThrow(/maxDiffLines/);
  });
});

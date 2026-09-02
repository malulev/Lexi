import { describe, expect, it } from 'vitest';
import type { ChangedFile, Policy } from '@/types';
import { gate } from '@/lib/policy/gate';

// A permissive baseline so each test only has to override the one field it
// is exercising, rather than restating the whole shape every time.
const permissivePolicy: Policy = {
  allow: ['**'],
  deny: [],
  maxFilesChanged: 15,
  maxDiffLines: 800,
  forbidNewDependencies: true,
};

function changedFile(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { path, kind: 'modified', diffLines: 10, ...overrides };
}

describe('gate', () => {
  it('permits a change that matches allow and stays within every limit', () => {
    const files = [changedFile('src/components/Hero.tsx')];

    expect(gate(files, permissivePolicy)).toEqual({ ok: true });
  });

  it('reports the offending path when an unconditional deny applies, even though the site allow list is wide open', () => {
    const files = [changedFile('src/components/Hero.tsx'), changedFile('package.json')];

    // Rule 1 must fire ahead of rule 3, so the wide-open allow list here
    // (which would otherwise pass every file) never gets a say.
    expect(gate(files, permissivePolicy)).toEqual({
      ok: false,
      violation: 'protected_path',
      path: 'package.json',
    });
  });

  it('denies a path that matches no entry in the site allow list', () => {
    const policy: Policy = { ...permissivePolicy, allow: ['src/content/**'] };
    const files = [changedFile('src/content/home.md'), changedFile('src/lib/payments/charge.ts')];

    expect(gate(files, policy)).toEqual({
      ok: false,
      violation: 'not_allowed_path',
      path: 'src/lib/payments/charge.ts',
    });
  });

  it('denies a path that matches the site deny list even though it satisfies allow', () => {
    const policy: Policy = { ...permissivePolicy, deny: ['src/lib/payments/**'] };
    const files = [changedFile('src/lib/payments/charge.ts')];

    expect(gate(files, policy)).toEqual({
      ok: false,
      violation: 'denied_path',
      path: 'src/lib/payments/charge.ts',
    });
  });

  it('reports too_many_files when the change touches more files than the limit permits', () => {
    const policy: Policy = { ...permissivePolicy, maxFilesChanged: 2 };
    const files = [
      changedFile('src/components/A.tsx'),
      changedFile('src/components/B.tsx'),
      changedFile('src/components/C.tsx'),
    ];

    expect(gate(files, policy)).toEqual({
      ok: false,
      violation: 'too_many_files',
      actual: 3,
      limit: 2,
    });
  });

  it('reports too_many_lines when the total diff across all files exceeds the limit', () => {
    const policy: Policy = { ...permissivePolicy, maxDiffLines: 100 };
    const files = [
      changedFile('src/components/A.tsx', { diffLines: 60 }),
      changedFile('src/components/B.tsx', { diffLines: 60 }),
    ];

    expect(gate(files, policy)).toEqual({
      ok: false,
      violation: 'too_many_lines',
      actual: 120,
      limit: 100,
    });
  });

  it('checks size limits only once every file is confirmed allowed', () => {
    const policy: Policy = { ...permissivePolicy, allow: ['src/content/**'], maxFilesChanged: 1 };
    const files = [changedFile('src/content/a.md'), changedFile('src/lib/payments/charge.ts')];

    // The size limit alone would not have tripped here (two files, both
    // under maxDiffLines); the real failure is the second path's allow-list
    // miss, and that is the violation that must surface.
    expect(gate(files, policy)).toEqual({
      ok: false,
      violation: 'not_allowed_path',
      path: 'src/lib/payments/charge.ts',
    });
  });

  it('reports new_dependency when a vendored dependency directory is touched', () => {
    const files = [changedFile('vendor/some-lib/index.js', { kind: 'added' })];

    expect(gate(files, permissivePolicy)).toEqual({
      ok: false,
      violation: 'new_dependency',
      path: 'vendor/some-lib/index.js',
    });
  });

  it('permits a vendored path when forbidNewDependencies is turned off', () => {
    const policy: Policy = { ...permissivePolicy, forbidNewDependencies: false };
    const files = [changedFile('vendor/some-lib/index.js', { kind: 'added' })];

    expect(gate(files, policy)).toEqual({ ok: true });
  });

  it('names the offending path rather than just the rule that failed', () => {
    const files = [changedFile('.github/workflows/ci.yml')];

    const result = gate(files, permissivePolicy);

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('path', '.github/workflows/ci.yml');
  });

  it('denies .webagent/** even when the site policy explicitly allows it', () => {
    const policy: Policy = { ...permissivePolicy, allow: ['.webagent/**'] };
    const files = [changedFile('.webagent/policy.yml')];

    expect(gate(files, policy)).toEqual({
      ok: false,
      violation: 'protected_path',
      path: '.webagent/policy.yml',
    });
  });

  it('denies AGENTS.md even when the site policy explicitly allows it', () => {
    const policy: Policy = { ...permissivePolicy, allow: ['AGENTS.md'] };
    const files = [changedFile('AGENTS.md')];

    expect(gate(files, policy)).toEqual({
      ok: false,
      violation: 'protected_path',
      path: 'AGENTS.md',
    });
  });

  it('denies a dotfile path even though minimatch globstars skip dotfiles by default', () => {
    // .env sits under an unconditional deny expressed as a dotfile glob
    // (**/.env*); this only denies it if matching is done with { dot: true }.
    const files = [changedFile('.env')];

    expect(gate(files, permissivePolicy)).toEqual({
      ok: false,
      violation: 'protected_path',
      path: '.env',
    });
  });
});

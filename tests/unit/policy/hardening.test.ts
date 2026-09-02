import { describe, expect, it } from 'vitest';
import { gate } from '@/lib/policy/gate';
import { DEFAULT_POLICY } from '@/lib/policy/parse';
import type { ChangedFile, Policy } from '@/types';

/**
 * Two ways an agent could reach past the gate that a straightforward reading of
 * the declared rule list leaves open. Both are closed ahead of those rules,
 * because both defeat the rules rather than failing them.
 */

function file(path: string): ChangedFile {
  return { path, kind: 'modified', diffLines: 1 };
}

/** The most permissive policy a site could possibly declare. */
const PERMISSIVE: Policy = {
  ...DEFAULT_POLICY,
  allow: ['**'],
  deny: [],
  forbidNewDependencies: false,
};

describe('paths that are not plainly repository-relative', () => {
  const malformed = [
    './.webagent/config.yml',
    'src/../.webagent/policy.yml',
    '/etc/passwd',
    'C:\\Windows\\system32',
    'src\\components\\Hero.tsx',
    '',
    ' src/components/Hero.tsx',
    'src//components/Hero.tsx',
    '../outside-the-repository.txt',
  ];

  for (const path of malformed) {
    it(`refuses ${JSON.stringify(path)} rather than glob-matching it`, () => {
      const result = gate([file(path)], PERMISSIVE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.violation).toBe('protected_path');
    });
  }

  it('still accepts an ordinary nested path', () => {
    expect(gate([file('src/components/Hero.tsx')], PERMISSIVE)).toEqual({ ok: true });
  });

  it('reports the malformed path so the fault is diagnosable', () => {
    const result = gate(
      [file('src/components/Hero.tsx'), file('./.webagent/config.yml')],
      PERMISSIVE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('./.webagent/config.yml');
  });
});

describe('the agent writing its own future instructions', () => {
  const guidanceFiles = [
    'AGENTS.md',
    'src/content/AGENTS.md',
    'CLAUDE.md',
    'docs/CLAUDE.md',
    '.opencode/config.json',
    'src/.opencode/agent.md',
  ];

  for (const path of guidanceFiles) {
    it(`denies ${path} even under the most permissive site policy`, () => {
      const result = gate([file(path)], PERMISSIVE);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violation).toBe('protected_path');
        expect(result.path).toBe(path);
      }
    });
  }

  it('denies guidance a site explicitly tried to allow, because guidance shapes the next run', () => {
    const permissive: Policy = { ...PERMISSIVE, allow: ['**', 'CLAUDE.md', 'AGENTS.md'] };
    expect(gate([file('CLAUDE.md')], permissive).ok).toBe(false);
  });

  it('leaves ordinary prose files alone', () => {
    expect(gate([file('src/content/agents-we-work-with.md')], PERMISSIVE)).toEqual({ ok: true });
    expect(gate([file('README.md')], PERMISSIVE)).toEqual({ ok: true });
  });
});

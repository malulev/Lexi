import { describe, expect, it } from 'vitest';

import { assemblePrompt } from '@/lib/jobs/prompt';
import { DEFAULT_POLICY } from '@/lib/policy/parse';
import type { Policy } from '@/types';

/**
 * The agent is told every rule the gate will judge it by, not just where it
 * may write. A rule the agent cannot see is a rule it cannot stop at: three
 * of one client's conversations died on `forbidExternalCode` after spending
 * more than a million tokens, because nothing in the prompt said that
 * re-adding an `<iframe>` line was refused.
 */
describe('the policy section of the prompt', () => {
  const base = { request: 'Update the favicon.', history: [], guidance: '' };

  function policy(overrides: Partial<Policy> = {}): Policy {
    return { ...DEFAULT_POLICY, ...overrides };
  }

  it('says nothing at all when no policy is given', () => {
    expect(assemblePrompt(base).request).toBe('Update the favicon.');
  });

  it('lists the allowed globs and says a change outside them is refused', () => {
    const prompt = assemblePrompt({
      ...base,
      policy: policy({ allow: ['index.html', 'styles.css', 'app.js'] }),
    });
    expect(prompt.request).toContain('Only files matching these patterns');
    expect(prompt.request).toContain('- index.html');
    expect(prompt.request).toContain('- app.js');
    expect(prompt.request).toMatch(/refused/);
  });

  it('omits the allow list when everything is allowed, keeping the other rules', () => {
    const prompt = assemblePrompt({ ...base, policy: policy({ allow: ['**'] }) });
    expect(prompt.request).not.toContain('Only files matching these patterns');
    expect(prompt.request).toContain('Do not add');
  });

  it('lists the denied globs when the site declares any', () => {
    const prompt = assemblePrompt({
      ...base,
      policy: policy({ deny: ['gtag-init.js', 'serve.py'] }),
    });
    expect(prompt.request).toContain('- gtag-init.js');
    expect(prompt.request).toContain('- serve.py');
  });

  it('says nothing about denied globs when the site denies nothing', () => {
    const prompt = assemblePrompt({ ...base, policy: policy({ deny: [] }) });
    expect(prompt.request).not.toMatch(/may not be touched at all/);
  });

  it('names the markup the external-code rule refuses, by shape', () => {
    const prompt = assemblePrompt({ ...base, policy: policy({ forbidExternalCode: true }) });
    for (const shape of ['<iframe', '<object', '<embed', '<base', 'javascript:', 'refresh']) {
      expect(prompt.request).toContain(shape);
    }
    expect(prompt.request).toMatch(/off-site|another origin/i);
  });

  it('warns that editing an existing embed counts as adding one', () => {
    const prompt = assemblePrompt({ ...base, policy: policy({ forbidExternalCode: true }) });
    expect(prompt.request).toMatch(/already on the page/i);
  });

  it('says nothing about external code when the site permits it', () => {
    const prompt = assemblePrompt({ ...base, policy: policy({ forbidExternalCode: false }) });
    expect(prompt.request).not.toContain('<iframe');
  });

  it('forbids vendored dependencies when the policy does', () => {
    const prompt = assemblePrompt({ ...base, policy: policy({ forbidNewDependencies: true }) });
    expect(prompt.request).toContain('node_modules');
  });

  it('says nothing about vendored dependencies when the policy permits them', () => {
    const prompt = assemblePrompt({ ...base, policy: policy({ forbidNewDependencies: false }) });
    expect(prompt.request).not.toContain('node_modules');
  });

  it('gives both size limits as numbers', () => {
    const prompt = assemblePrompt({
      ...base,
      policy: policy({ maxFilesChanged: 15, maxDiffLines: 900 }),
    });
    expect(prompt.request).toContain('15 files');
    expect(prompt.request).toContain('900 lines');
  });

  it('names the machinery no policy can reach', () => {
    const prompt = assemblePrompt({ ...base, policy: policy() });
    for (const category of ['lockfile', '.env', '.webagent/', 'AGENTS.md']) {
      expect(prompt.request).toContain(category);
    }
  });

  it('tells the agent to stop before editing rather than spend a run that is discarded whole', () => {
    const prompt = assemblePrompt({ ...base, policy: policy() });
    expect(prompt.request).toMatch(/nothing (at all )?is kept/i);
    expect(prompt.request).toMatch(/stop\b/i);
    expect(prompt.request).toMatch(/before (you )?(start|edit)/i);
  });

  it('sits between the request and the attachments, so the boundary is read before the files', () => {
    const prompt = assemblePrompt({
      ...base,
      policy: policy({ allow: ['index.html'] }),
      attachedPaths: ['public/uploads/logo.svg'],
    });
    const boundary = prompt.request.indexOf('Only files matching');
    const files = prompt.request.indexOf('The client attached');
    expect(boundary).toBeGreaterThan(0);
    expect(files).toBeGreaterThan(boundary);
  });
});

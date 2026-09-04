import { describe, expect, it } from 'vitest';

import { assemblePrompt } from '@/lib/jobs/prompt';

/**
 * The agent is told where the boundary is. The gate still decides; this is
 * what stops eight minutes of work on a file that was never going to land.
 */
describe('the allowed-paths section of the prompt', () => {
  const base = { request: 'Update the favicon.', history: [], guidance: '' };

  it('lists the policy’s globs and says a change outside them is refused', () => {
    const prompt = assemblePrompt({
      ...base,
      allowedPaths: ['index.html', 'styles.css', 'app.js'],
    });
    expect(prompt.request).toContain('Only files matching these patterns');
    expect(prompt.request).toContain('- index.html');
    expect(prompt.request).toContain('- app.js');
    expect(prompt.request).toMatch(/refused/);
  });

  it('says nothing when everything is allowed, or when nothing was given', () => {
    expect(assemblePrompt({ ...base, allowedPaths: ['**'] }).request).toBe('Update the favicon.');
    expect(assemblePrompt(base).request).toBe('Update the favicon.');
  });

  it('sits between the request and the attachments, so the agent reads the boundary before the files', () => {
    const prompt = assemblePrompt({
      ...base,
      allowedPaths: ['index.html'],
      attachedPaths: ['public/uploads/logo.svg'],
    });
    const boundary = prompt.request.indexOf('Only files matching');
    const files = prompt.request.indexOf('The client attached');
    expect(boundary).toBeGreaterThan(0);
    expect(files).toBeGreaterThan(boundary);
  });
});

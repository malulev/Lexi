import { describe, expect, it } from 'vitest';
import { assemblePrompt } from '@/lib/jobs/prompt';
import type { Message } from '@/types';

function message(author: Message['author'], text: string, id = 1): Message {
  return { id, author, at: '2026-09-02T10:00:00Z', text };
}

describe('assembling the prompt for one job', () => {
  it('carries the request, the history, and the repository guidance', () => {
    const prompt = assemblePrompt({
      request: '  Make the headline shorter.  ',
      history: [message('client', 'Change the hero', 1), message('agent', 'Done', 2)],
      guidance: '  Use sentence case in headings.  ',
    });

    expect(prompt.request).toBe('Make the headline shorter.');
    expect(prompt.guidance).toBe('Use sentence case in headings.');
    expect(prompt.history).toEqual([
      { author: 'client', text: 'Change the hero' },
      { author: 'agent', text: 'Done' },
    ]);
  });

  it('carries no history field beyond author and text, so nothing internal leaks into the container', () => {
    const prompt = assemblePrompt({
      request: 'x',
      history: [{ ...message('agent', 'built'), previewUrl: 'https://preview.example', outcome: 'succeeded' }],
      guidance: '',
    });

    expect(Object.keys(prompt.history[0]!).sort()).toEqual(['author', 'text']);
  });

  it('keeps only the most recent turns, since a prompt that grows without bound outgrows the change', () => {
    const history = Array.from({ length: 50 }, (_, i) => message('client', `turn ${i}`, i));
    const prompt = assemblePrompt({ request: 'x', history, guidance: '' });

    expect(prompt.history).toHaveLength(20);
    expect(prompt.history.at(-1)?.text).toBe('turn 49');
    expect(prompt.history[0]?.text).toBe('turn 30');
  });

  it('omits the page hint entirely when there is none', () => {
    const prompt = assemblePrompt({ request: 'x', history: [], guidance: '' });
    expect('targetHint' in prompt).toBe(false);
  });

  it('passes the page hint through when the client named a page', () => {
    const prompt = assemblePrompt({ request: 'x', history: [], guidance: '', targetHint: '/pricing' });
    expect(prompt.targetHint).toBe('/pricing');
  });

  it('gives the agent the previous build failure so it can fix what it broke (FR-023)', () => {
    const prompt = assemblePrompt({
      request: 'Fix it',
      history: [],
      guidance: '',
      buildFailureDetail: "Module not found: Can't resolve './Hero'",
    });

    expect(prompt.request).toContain('Fix it');
    expect(prompt.request).toContain("Can't resolve './Hero'");
  });

  it('keeps the tail of a long build log, because a build reports its error last', () => {
    const detail = `${'banner\n'.repeat(2000)}THE ACTUAL ERROR`;
    const prompt = assemblePrompt({ request: 'Fix it', history: [], guidance: '', buildFailureDetail: detail });

    expect(prompt.request).toContain('THE ACTUAL ERROR');
    expect(prompt.request.length).toBeLessThan(2_500);
  });

  it('mentions no build failure when the previous request did not fail', () => {
    const prompt = assemblePrompt({ request: 'Make it blue', history: [], guidance: '' });
    expect(prompt.request).toBe('Make it blue');
  });

  it('does not mutate the history it was given', () => {
    const history = [message('client', 'one')];
    const snapshot = structuredClone(history);
    assemblePrompt({ request: 'x', history, guidance: '' });
    expect(history).toEqual(snapshot);
  });
});

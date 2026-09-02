import { describe, expect, it } from 'vitest';

import { toClientProse } from '@/lib/jobs/client-prose';

/**
 * Principle I, enforced rather than requested.
 *
 * The agent's summary is unbounded model output on its way to a client's
 * screen. These tests are written as an adversary would: not "does it handle
 * the summary we saw", but "what is the worst thing a model could put here,
 * and does any of it survive".
 */

const NEUTRAL = 'I made the change you asked for.';

describe('what a client is allowed to read', () => {
  it('keeps a summary that names no file', () => {
    expect(toClientProse('I made the headline shorter and bolder.')).toBe(
      'I made the headline shorter and bolder.',
    );
  });

  it('redacts the container path a live run actually produced', () => {
    const real = 'Changed "AI, embedded" to "Built for speed" in `/work/index.html:54`.';

    const prose = toClientProse(real);

    expect(prose).not.toContain('/work/');
    expect(prose).not.toContain('index.html');
    expect(prose).toContain('Built for speed');
  });

  it('redacts a repository-relative path', () => {
    const prose = toClientProse('I updated src/components/Hero.tsx for you.');

    expect(prose).not.toContain('src/components');
    expect(prose).not.toContain('Hero.tsx');
  });

  it('redacts a bare filename', () => {
    expect(toClientProse('Edited styles.css to widen the header.')).not.toContain('styles.css');
  });

  it('redacts a branch name, which is as much a code detail as a path', () => {
    expect(toClientProse('Pushed this to webagent/c-12 for review.')).not.toContain('webagent/c-12');
  });
});

describe('what must never survive', () => {
  it('drops a summary carrying a diff', () => {
    const diff = ['I changed the headline:', '```diff', '- <h1>Old</h1>', '+ <h1>New</h1>', '```'].join(
      '\n',
    );

    const prose = toClientProse(diff);

    expect(prose).not.toContain('<h1>');
    expect(prose).not.toContain('```');
  });

  it('drops a commit SHA', () => {
    const prose = toClientProse('Committed e53ede9365dc3ea78b097b25fcaa6ae51d6e6d19 to the branch.');

    expect(prose).not.toMatch(/[0-9a-f]{7,}/i);
  });

  it('drops a URL, which could point anywhere including a deploy log', () => {
    const prose = toClientProse('See https://app.netlify.com/projects/x/deploys/abc for details.');

    expect(prose).not.toContain('netlify.com');
    expect(prose).not.toContain('http');
  });

  it('drops raw build output rather than trying to tidy it', () => {
    const build = [
      'The build failed. Here is the output:',
      '    at Module._compile (node:internal/modules/cjs/loader:1234:14)',
      '    at Object.Module._extensions..js (node:internal/modules/cjs/loader:1432:10)',
    ].join('\n');

    const prose = toClientProse(build);

    expect(prose).not.toContain('node:internal');
    expect(prose).not.toContain('loader');
  });

  it('drops HTML the model pasted from the page it edited', () => {
    const prose = toClientProse('I replaced <h1 class="hero">AI</h1> with a shorter one.');

    expect(prose).not.toContain('<h1');
    expect(prose).not.toContain('class=');
  });

  it('falls back rather than emitting a half-redacted sentence', () => {
    // A path shape the redactor is not expected to catch cleanly still must
    // not reach a client: the check after the filter is what makes that true.
    const prose = toClientProse('Look in C:\\Users\\dev\\site\\index.html for the change.');

    expect(prose).toBe(NEUTRAL);
  });
});

describe('staying readable whatever arrives', () => {
  it('answers with a sentence for an empty summary', () => {
    expect(toClientProse('')).toBe(NEUTRAL);
    expect(toClientProse('   \n  ')).toBe(NEUTRAL);
  });

  it('answers with a sentence when redaction leaves nothing behind', () => {
    expect(toClientProse('```\nsome code\n```')).toBe(NEUTRAL);
  });

  it('caps a model that will not stop talking', () => {
    const rambling = 'I changed the headline and it looks much better now. '.repeat(50);

    expect(toClientProse(rambling).length).toBeLessThanOrEqual(400);
  });

  it('does not mistake an ordinary sentence ending for a filename', () => {
    const prose = toClientProse('I shortened the headline. It reads better now.');

    expect(prose).toBe('I shortened the headline. It reads better now.');
  });

  it('is stable when called repeatedly, despite the global patterns it uses', () => {
    // A regular expression with the global flag carries `lastIndex` between
    // calls; a safety check that passes every other time is worse than none.
    const dangerous = 'Committed e53ede9365dc to src/index.html.';

    const first = toClientProse(dangerous);
    const second = toClientProse(dangerous);
    const third = toClientProse(dangerous);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first).not.toMatch(/[0-9a-f]{7,}/i);
  });
});

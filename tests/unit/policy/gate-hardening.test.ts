import { describe, expect, it } from 'vitest';

import { containsExternalCode, gate } from '@/lib/policy/gate';
import { DEFAULT_POLICY, parsePolicy, UNCONDITIONAL_DENIES } from '@/lib/policy/parse';
import type { ChangedFile, Policy } from '@/types';

/**
 * The gate against an agent that has been talked into something, or a client
 * whose attachment is the only thing the request needed.
 */

const strict: Policy = { ...DEFAULT_POLICY, allow: ['index.html', 'styles.css', 'app.js'] };

function changed(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { path, kind: 'added', diffLines: 3, ...overrides };
}

describe('attachments against an allow list', () => {
  it('lets a host-placed attachment through an allow list that does not name it', () => {
    const files = [changed('index.html'), changed('public/uploads/logo.svg')];
    expect(gate(files, strict, { attachedPaths: ['public/uploads/logo.svg'] })).toEqual({
      ok: true,
    });
  });

  it('still refuses the same path when it was not attached — the agent made it', () => {
    const files = [changed('public/uploads/logo.svg')];
    expect(gate(files, strict)).toMatchObject({ ok: false, violation: 'not_allowed_path' });
  });

  it('never lets an attachment past a deny, unconditional or the site’s own', () => {
    expect(
      gate([changed('.webagent/policy.yml')], strict, { attachedPaths: ['.webagent/policy.yml'] }),
    ).toMatchObject({ ok: false, violation: 'protected_path' });
    const denying = { ...strict, deny: ['public/uploads/**'] };
    expect(
      gate([changed('public/uploads/a.png')], denying, { attachedPaths: ['public/uploads/a.png'] }),
    ).toMatchObject({ ok: false, violation: 'denied_path' });
  });

  it('counts attachments toward the size limits like any other file', () => {
    const files = [changed('public/uploads/a.png'), changed('public/uploads/b.png')];
    const tight = { ...strict, maxFilesChanged: 1 };
    expect(gate(files, tight, { attachedPaths: files.map((file) => file.path) })).toMatchObject({
      ok: false,
      violation: 'too_many_files',
    });
  });
});

describe('symbolic links', () => {
  it('refuses a link even at an allowed path, before any glob is consulted', () => {
    expect(gate([changed('styles.css', { symlink: true })], strict)).toEqual({
      ok: false,
      violation: 'symlink',
      path: 'styles.css',
    });
  });
});

describe('the agent’s own instructions and the hosting’s own code', () => {
  const protectedPaths = [
    '.webagent/policy.yml',
    'netlify/functions/steal.js',
    'netlify/edge-functions/redirect.ts',
    'public/_redirects',
    '_headers',
    'vercel.json',
    'api/leak.ts',
    'functions/index.js',
    'next.config.js',
    'vite.config.mts',
    'tailwind.config.ts',
    'tsconfig.json',
    '.npmrc',
    '.husky/pre-commit',
    'Dockerfile',
    'scripts/deploy.sh',
    '.gitmodules',
    '.gitattributes',
  ];

  it.each(protectedPaths)('cannot be widened to %s', (path) => {
    const wideOpen = { ...DEFAULT_POLICY, allow: ['**', path] };
    expect(gate([changed(path)], wideOpen)).toMatchObject({
      ok: false,
      violation: 'protected_path',
    });
  });

  it('leaves ordinary content alone: pages, styles, images, a docs folder named like an API', () => {
    for (const path of [
      'index.html',
      'styles.css',
      'public/images/team.png',
      'docs/api/index.html',
      'src/content/about.md',
    ]) {
      expect(gate([changed(path)], DEFAULT_POLICY), path).toEqual({ ok: true });
    }
  });

  it('keeps every deny a repository-relative glob', () => {
    for (const glob of UNCONDITIONAL_DENIES) expect(glob, glob).not.toMatch(/^\/|\.\./);
  });
});

describe('code from another origin', () => {
  it('recognises the shapes a skimmer or a redirect takes', () => {
    expect(containsExternalCode('<script src="https://cdn.evil.example/s.js"></script>')).toBe(
      true,
    );
    expect(containsExternalCode("<script src='//evil.example/s.js'>")).toBe(true);
    expect(containsExternalCode('<iframe src="/embed"></iframe>')).toBe(true);
    expect(containsExternalCode('<meta http-equiv="refresh" content="0; url=https://x">')).toBe(
      true,
    );
    expect(containsExternalCode('<base href="https://evil.example/">')).toBe(true);
    expect(containsExternalCode('<a href="javascript:void(0)">')).toBe(true);
    expect(containsExternalCode('<object data="x.swf">')).toBe(true);
  });

  it('leaves a site’s own scripts, styles, images and links alone', () => {
    expect(containsExternalCode('<script src="/app.js"></script>')).toBe(false);
    expect(containsExternalCode('<script>document.title = "x"</script>')).toBe(false);
    expect(
      containsExternalCode('<link rel="stylesheet" href="https://fonts.googleapis.com/css2">'),
    ).toBe(false);
    expect(containsExternalCode('<img src="https://images.example/a.png">')).toBe(false);
    expect(containsExternalCode('<a href="https://linkedin.com/in/x">LinkedIn</a>')).toBe(false);
  });

  it('refuses a page that gained one, names the page, and runs after the path rules', () => {
    const files = [
      changed('index.html', {
        kind: 'modified',
        addedText: '<script src="https://cdn.evil.example/s.js"></script>',
      }),
    ];
    expect(gate(files, DEFAULT_POLICY)).toEqual({
      ok: false,
      violation: 'external_code',
      path: 'index.html',
    });
    expect(gate(files, { ...DEFAULT_POLICY, allow: ['styles.css'] })).toMatchObject({
      violation: 'not_allowed_path',
    });
  });

  it('does not read a stylesheet or a binary for markup, and honours the policy switch', () => {
    const css = changed('styles.css', { addedText: '<iframe>' });
    expect(gate([css], DEFAULT_POLICY)).toEqual({ ok: true });
    const html = changed('index.html', {
      addedText: '<iframe src="https://maps.google.com/embed"></iframe>',
    });
    expect(gate([html], { ...DEFAULT_POLICY, forbidExternalCode: false })).toEqual({ ok: true });
    expect(gate([changed('index.html')], DEFAULT_POLICY)).toEqual({ ok: true });
  });
});

describe('the policy file', () => {
  it('defaults forbidExternalCode on, and lets a site turn it off', () => {
    expect(parsePolicy(null).forbidExternalCode).toBe(true);
    expect(parsePolicy('forbidExternalCode: false\n').forbidExternalCode).toBe(false);
    expect(parsePolicy('allow: ["**"]\n').forbidExternalCode).toBe(true);
  });
});

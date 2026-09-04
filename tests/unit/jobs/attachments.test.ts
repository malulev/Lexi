import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  discardAttachments,
  placeAttachments,
  sniffAttachmentType,
  stashUploads,
} from '@/lib/jobs/attachments';

/**
 * The host side of an attachment: taken off the request and checked against
 * its bytes, copied into the working tree under a safe name, and removed
 * when the request is over.
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n');
const SVG = new TextEncoder().encode(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
);
const HTML = new TextEncoder().encode('<!doctype html><html><script>alert(1)</script></html>');

function upload(name: string, bytes: Uint8Array, type: string): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type });
}

const roots: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'webagent-attach-test-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('sniffAttachmentType', () => {
  it('recognises the accepted kinds from their bytes', () => {
    expect(sniffAttachmentType(PNG)).toBe('image/png');
    expect(sniffAttachmentType(JPEG)).toBe('image/jpeg');
    expect(sniffAttachmentType(PDF)).toBe('application/pdf');
    expect(sniffAttachmentType(SVG)).toBe('image/svg+xml');
  });

  it('recognises nothing else, whatever it was declared as', () => {
    expect(sniffAttachmentType(HTML)).toBeNull();
    expect(sniffAttachmentType(new Uint8Array(0))).toBeNull();
  });
});

describe('stashUploads', () => {
  it('keeps each file in a temporary directory, typed by its bytes and not by its label', async () => {
    const root = await scratch();

    const outcome = await stashUploads([upload('Hero Shot.jpg', PNG, 'image/jpeg')], root);

    if (!outcome.ok) throw new Error(outcome.refusal);
    expect(outcome.attachments).toHaveLength(1);
    const [attachment] = outcome.attachments;
    expect(attachment!.type).toBe('image/png');
    expect(attachment!.name).toBe('Hero Shot.jpg');
    expect(attachment!.tempPath.startsWith(root)).toBe(true);
    expect(new Uint8Array(await readFile(attachment!.tempPath))).toEqual(PNG);
  });

  it('refuses a file whose bytes are not an accepted kind, however it was labelled, and leaves nothing behind', async () => {
    const root = await scratch();

    const outcome = await stashUploads([upload('innocent.png', HTML, 'image/png')], root);

    expect(outcome).toEqual({ ok: false, refusal: 'unsupported' });
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(root)).toEqual([]);
  });

  it('applies the size limits before reading a byte', async () => {
    const root = await scratch();
    const big = new File([new Uint8Array(1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });

    expect(await stashUploads([big], root)).toEqual({ ok: false, refusal: 'too_large' });
  });

  it('is a no-op for no files', async () => {
    expect(await stashUploads([])).toEqual({ ok: true, attachments: [] });
  });
});

describe('placeAttachments', () => {
  it('copies each file into the upload directory under a safe name and returns the paths', async () => {
    const root = await scratch();
    const tree = join(root, 'tree');
    await mkdir(tree);
    const stashed = await stashUploads([upload('Team Photo.jpg', JPEG, 'image/jpeg')], root);
    if (!stashed.ok) throw new Error(stashed.refusal);

    const placed = await placeAttachments(tree, undefined, stashed.attachments);

    expect(placed.map((entry) => entry.path)).toEqual(['public/uploads/team-photo.jpg']);
    expect(new Uint8Array(await readFile(join(tree, 'public/uploads/team-photo.jpg')))).toEqual(
      JPEG,
    );
  });

  it('honours the repository’s own upload directory', async () => {
    const root = await scratch();
    const tree = join(root, 'tree');
    await mkdir(tree);
    const stashed = await stashUploads([upload('a.png', PNG, 'image/png')], root);
    if (!stashed.ok) throw new Error(stashed.refusal);

    expect(
      (await placeAttachments(tree, 'assets/img', stashed.attachments)).map((entry) => entry.path),
    ).toEqual(['assets/img/a.png']);
  });

  it('never overwrites a file the site already has, or another attachment in the same request', async () => {
    const root = await scratch();
    const tree = join(root, 'tree');
    await mkdir(join(tree, 'public/uploads'), { recursive: true });
    await writeFile(join(tree, 'public/uploads/logo.png'), 'existing');
    const stashed = await stashUploads(
      [upload('logo.png', PNG, 'image/png'), upload('LOGO.PNG', PNG, 'image/png')],
      root,
    );
    if (!stashed.ok) throw new Error(stashed.refusal);

    const placed = await placeAttachments(tree, undefined, stashed.attachments);

    expect(placed.map((entry) => entry.path)).toEqual([
      'public/uploads/logo-2.png',
      'public/uploads/logo-3.png',
    ]);
    expect(await readFile(join(tree, 'public/uploads/logo.png'), 'utf8')).toBe('existing');
  });

  it('places nothing and returns nothing when there is nothing to place', async () => {
    expect(await placeAttachments('/nowhere', undefined, undefined)).toEqual([]);
    expect(await placeAttachments('/nowhere', undefined, [])).toEqual([]);
  });
});

describe('discardAttachments', () => {
  it('removes the temporary copies, and is safe to call twice', async () => {
    const root = await scratch();
    const stashed = await stashUploads([upload('a.png', PNG, 'image/png')], root);
    if (!stashed.ok) throw new Error(stashed.refusal);
    const dir = dirname(stashed.attachments[0]!.tempPath);

    await discardAttachments(stashed.attachments);
    await discardAttachments(stashed.attachments);

    await expect(stat(dir)).rejects.toThrow();
  });
});

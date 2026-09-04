import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChangeRequest } from '@/lib/http/parse-request';
import { ATTACHMENT_REFUSALS } from '@/lib/jobs/messages';

/**
 * A change request arrives as JSON, or as a form when files ride along; both
 * are read to one shape. The tier is validated against the closed vocabulary,
 * and the files against their bytes, before any route acts on either.
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const stashed: string[] = [];
afterEach(async () => {
  await Promise.all(stashed.splice(0).map((path) => rm(dirname(path), { recursive: true, force: true })));
});

function json(body: unknown): Request {
  return new Request('http://localhost/api/conversations/1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function form(fields: Record<string, string>, files: File[] = []): Request {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  for (const file of files) data.append('files', file);
  return new Request('http://localhost/api/conversations/1/messages', { method: 'POST', body: data });
}

function png(name: string, bytes: Uint8Array = PNG): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type: 'image/png' });
}

describe('parseChangeRequest', () => {
  it('reads a JSON body the way it always did', async () => {
    const parsed = await parseChangeRequest(json({ message: '  Make it blue  ', targetHint: 'header' }));

    expect(parsed).toEqual({
      ok: true,
      body: { message: 'Make it blue', targetHint: 'header', attachments: [] },
    });
  });

  it('carries a model tier from the closed vocabulary', async () => {
    const parsed = await parseChangeRequest(json({ message: 'x', modelTier: 'high' }));
    expect(parsed).toMatchObject({ ok: true, body: { modelTier: 'high' } });
  });

  it('refuses a tier the interface does not offer rather than quietly running the default', async () => {
    expect(await parseChangeRequest(json({ message: 'x', modelTier: 'ultra' }))).toEqual({
      ok: false,
      status: 400,
      error: 'bad_request',
    });
  });

  it('refuses a missing or oversized message', async () => {
    expect(await parseChangeRequest(json({}))).toMatchObject({ ok: false, status: 400 });
    expect(await parseChangeRequest(json({ message: 'x'.repeat(4_001) }))).toMatchObject({ ok: false, status: 400 });
    expect(await parseChangeRequest(json(null))).toMatchObject({ ok: false, status: 400 });
  });

  it('reads a form with files into the same shape, stashing each file by its bytes', async () => {
    const parsed = await parseChangeRequest(form({ message: 'Use this photo', modelTier: 'low' }, [png('Hero.png')]));

    if (!parsed.ok) throw new Error(String(parsed.error));
    stashed.push(...parsed.body.attachments.map((attachment) => attachment.tempPath));
    expect(parsed.body.message).toBe('Use this photo');
    expect(parsed.body.modelTier).toBe('low');
    expect(parsed.body.attachments).toHaveLength(1);
    expect(parsed.body.attachments[0]).toMatchObject({ name: 'Hero.png', type: 'image/png', size: PNG.byteLength });
  });

  it('refuses too many files with 413 and the client sentence, before reading any', async () => {
    const files = Array.from({ length: 6 }, (_, i) => png(`p${i}.png`));

    expect(await parseChangeRequest(form({ message: 'x' }, files))).toEqual({
      ok: false,
      status: 413,
      error: 'too_many',
      message: ATTACHMENT_REFUSALS.too_many,
    });
  });

  it('refuses a file whose bytes are not an accepted kind with 415', async () => {
    const notAnImage = png('page.png', new TextEncoder().encode('<html></html>'));

    expect(await parseChangeRequest(form({ message: 'x' }, [notAnImage]))).toEqual({
      ok: false,
      status: 415,
      error: 'unsupported',
      message: ATTACHMENT_REFUSALS.unsupported,
    });
  });

  it('still validates the message on a form', async () => {
    expect(await parseChangeRequest(form({}, [png('a.png')]))).toMatchObject({ ok: false, status: 400 });
  });
});

import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LIMITS,
  describeSize,
  safeAttachmentName,
  validateAttachments,
} from '@/lib/attachments';
import { ATTACHMENT_REFUSALS } from '@/lib/jobs/messages';

/**
 * An attachment is a file committed to the client's site, so it is bounded
 * before it is accepted. These are the bounds, and they are the same in the
 * browser and on the server because they are one function.
 */

const MB = 1024 * 1024;

function png(size: number, name = 'photo.png') {
  return { name, size, type: 'image/png' };
}

describe('validateAttachments', () => {
  it('accepts a few images and a PDF within the limits', () => {
    expect(
      validateAttachments([png(2 * MB), { name: 'brochure.pdf', size: 3 * MB, type: 'application/pdf' }]),
    ).toBeNull();
  });

  it('accepts nothing at all', () => {
    expect(validateAttachments([])).toBeNull();
  });

  it('refuses one file over ten megabytes', () => {
    expect(validateAttachments([png(ATTACHMENT_LIMITS.maxFileBytes + 1)])).toBe('too_large');
    expect(validateAttachments([png(ATTACHMENT_LIMITS.maxFileBytes)])).toBeNull();
  });

  it('refuses more than five files', () => {
    expect(validateAttachments(Array.from({ length: 6 }, (_, i) => png(1, `p${i}.png`)))).toBe('too_many');
  });

  it('refuses a set that adds up to more than twenty-five megabytes', () => {
    expect(validateAttachments([png(9 * MB), png(9 * MB), png(9 * MB)])).toBe('total_too_large');
  });

  it('refuses a kind of file the site should not be handed', () => {
    expect(validateAttachments([{ name: 'run.exe', size: 10, type: 'application/x-msdownload' }])).toBe('unsupported');
    expect(validateAttachments([{ name: 'index.html', size: 10, type: 'text/html' }])).toBe('unsupported');
  });

  it('refuses an empty file', () => {
    expect(validateAttachments([png(0)])).toBe('empty');
  });

  it('every refusal has a sentence in the client vocabulary', () => {
    for (const refusal of ['too_large', 'too_many', 'total_too_large', 'unsupported', 'empty'] as const) {
      expect(ATTACHMENT_REFUSALS[refusal]).toBeTruthy();
    }
  });

  it('tells the file picker to offer exactly the accepted kinds', () => {
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual(
      expect.arrayContaining(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf']),
    );
  });
});

describe('safeAttachmentName', () => {
  it('keeps a recognisable name and lower-cases it', () => {
    expect(safeAttachmentName('Team Photo 2026.jpg', 'image/jpeg')).toBe('team-photo-2026.jpg');
  });

  it('gives the file the extension its real type calls for', () => {
    expect(safeAttachmentName('logo.jpeg', 'image/png')).toBe('logo.png');
    expect(safeAttachmentName('brochure', 'application/pdf')).toBe('brochure.pdf');
  });

  it('strips any directory, whichever way the slashes lean', () => {
    expect(safeAttachmentName('../../etc/passwd.png', 'image/png')).toBe('passwd.png');
    expect(safeAttachmentName('C:\\Users\\me\\hero.png', 'image/png')).toBe('hero.png');
  });

  it('never produces a hidden file or an empty name', () => {
    expect(safeAttachmentName('.htaccess', 'image/png')).toBe('file.png');
    expect(safeAttachmentName('!!!.png', 'image/png')).toBe('file.png');
  });

  it('bounds the length', () => {
    expect(safeAttachmentName(`${'a'.repeat(200)}.png`, 'image/png').length).toBeLessThanOrEqual(84);
  });
});

describe('describeSize', () => {
  it('reads in the units a person uses', () => {
    expect(describeSize(512)).toBe('512 B');
    expect(describeSize(200 * 1024)).toBe('200 KB');
    expect(describeSize(2.5 * MB)).toBe('2.5 MB');
  });
});

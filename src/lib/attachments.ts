import type { AttachmentRefusal } from '@/lib/jobs/messages';

/**
 * What a client may attach to a request, and what it is called once it lands
 * in the site.
 *
 * The limits are the whole reason this module exists: an attachment is a file
 * committed to the client's repository, served by their hosting, and paid for
 * by both, so it is bounded before it is accepted. The same checks run in the
 * browser (so the limit is learned before Send) and on the server (so the
 * browser is not trusted to have run them). This module therefore imports
 * nothing from Node and reads nothing from disk.
 */

export const ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
} as const;

/** Media type to the extension a file of that type is written with. */
export const ATTACHMENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

/** What the browser's file picker is told to offer. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES).join(',');

export const DEFAULT_UPLOAD_DIR = 'public/uploads';

export interface AttachmentCandidate {
  name: string;
  size: number;
  type: string;
}

/**
 * The first reason a set of files cannot be attached, or `null` when they all
 * can. One reason at a time: the client fixes it and tries again, which reads
 * better than a list.
 */
export function validateAttachments(files: AttachmentCandidate[]): AttachmentRefusal | null {
  if (files.length > ATTACHMENT_LIMITS.maxFiles) return 'too_many';

  for (const file of files) {
    if (!(file.type in ATTACHMENT_TYPES)) return 'unsupported';
    if (file.size <= 0) return 'empty';
    if (file.size > ATTACHMENT_LIMITS.maxFileBytes) return 'too_large';
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > ATTACHMENT_LIMITS.maxTotalBytes) return 'total_too_large';

  return null;
}

/**
 * A file name safe to commit: the client's name, lower-cased, reduced to
 * letters, digits, dots and dashes, stripped of any directory, and given the
 * extension its actual type calls for rather than whatever it arrived with.
 * The name is what a page will reference, so it stays recognisable.
 */
export function safeAttachmentName(originalName: string, type: string): string {
  const extension = ATTACHMENT_TYPES[type] ?? 'bin';
  const base = originalName.split(/[\\/]/).pop() ?? '';
  const withoutExtension = base.replace(/\.[^.]*$/, '');
  const slug = withoutExtension
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
  return `${slug || 'file'}.${extension}`;
}

/** Human-readable size for the composer, in the units a client thinks in. */
export function describeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

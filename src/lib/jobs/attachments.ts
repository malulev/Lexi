import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

import {
  ATTACHMENT_TYPES,
  DEFAULT_UPLOAD_DIR,
  safeAttachmentName,
  validateAttachments,
} from '@/lib/attachments';
import type { AttachmentRefusal } from '@/lib/jobs/messages';
import type { Attachment } from '@/types';

/**
 * The host-side life of an attachment: taken off the request, held in a
 * temporary directory while the request waits for the lock, copied into the
 * working tree before the agent runs, and removed however the request ends.
 *
 * Nothing here trusts the browser. The declared media type is checked against
 * the bytes, the name is rewritten, and the limits are applied again even
 * though the composer applied them first — the composer is a courtesy, this
 * is the control.
 */

/** What a file actually is, from its first bytes. `null` for anything not on the list. */
export function sniffAttachmentType(bytes: Uint8Array): string | null {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';

  // SVG is text: an XML prologue or the root element within the first bytes.
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 1024))
    .trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head))
    return 'image/svg+xml';

  return null;
}

/**
 * Markup inside an SVG that a browser would run when the file is opened on
 * its own. An `<img>` never runs it, but a direct visit to the uploaded file
 * does, on the site's own origin — which makes an attached SVG the one
 * attachment that can carry a script onto the client's website.
 */
const SVG_SCRIPT_PATTERNS: RegExp[] = [
  /<script\b/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /<foreignObject\b/i,
  /<(?:iframe|embed|object)\b/i,
  /\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<!ENTITY/i,
];

/** Whether an SVG is a picture and nothing else. */
export function isSafeSvg(bytes: Uint8Array): boolean {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return !SVG_SCRIPT_PATTERNS.some((pattern) => pattern.test(text));
}

export type StashOutcome =
  { ok: true; attachments: Attachment[] } | { ok: false; refusal: AttachmentRefusal };

/**
 * Takes uploaded files off a request and into a temporary directory of their
 * own, validating as it goes. Refuses the whole set on the first fault and
 * leaves nothing behind when it does.
 */
export async function stashUploads(files: File[], root: string = tmpdir()): Promise<StashOutcome> {
  if (files.length === 0) return { ok: true, attachments: [] };

  const declared = validateAttachments(
    files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
  );
  if (declared) return { ok: false, refusal: declared };

  const dir = await mkdtemp(join(root, `webagent-upload-${randomUUID()}-`));
  const attachments: Attachment[] = [];

  for (const [index, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffAttachmentType(bytes);
    if (!type || !(type in ATTACHMENT_TYPES)) {
      await rm(dir, { recursive: true, force: true });
      return { ok: false, refusal: 'unsupported' };
    }
    if (type === 'image/svg+xml' && !isSafeSvg(bytes)) {
      await rm(dir, { recursive: true, force: true });
      return { ok: false, refusal: 'unsafe_svg' };
    }
    const tempPath = join(dir, `${index}-${safeAttachmentName(file.name, type)}`);
    await writeFile(tempPath, bytes);
    attachments.push({ name: file.name, tempPath, size: bytes.byteLength, type });
  }

  return { ok: true, attachments };
}

/** An attachment in the working tree: where it landed, and what it contained when it did. */
export interface PlacedAttachment {
  path: string;
  sha256: string;
}

/**
 * Copies attachments into the working tree under the upload directory and
 * returns their repository-relative paths, for the prompt, with a digest of
 * each so the gate can later tell a file the client sent from one the agent
 * rewrote at the same path.
 *
 * A name already taken — by a file the site has, or by another attachment in
 * the same request — gets a numeric suffix rather than overwriting: an
 * attachment replacing an existing site file silently would be a change the
 * client did not ask for.
 */
export async function placeAttachments(
  treeDir: string,
  uploadDir: string | undefined,
  attachments: Attachment[] | undefined,
): Promise<PlacedAttachment[]> {
  if (!attachments?.length) return [];

  const directory = uploadDir ?? DEFAULT_UPLOAD_DIR;
  const placed: PlacedAttachment[] = [];

  for (const attachment of attachments) {
    const taken = placed.map((entry) => entry.path);
    const repoPath = await freePath(
      treeDir,
      directory,
      safeAttachmentName(attachment.name, attachment.type),
      taken,
    );
    const target = join(treeDir, repoPath);
    await mkdir(dirname(target), { recursive: true });
    const bytes = await readFile(attachment.tempPath);
    await writeFile(target, bytes);
    placed.push({ path: repoPath, sha256: digestOf(bytes) });
  }

  return placed;
}

/**
 * The attachments still exactly as the client sent them, after the agent has
 * had the tree. Only these earn the allow-list exemption: an attachment the
 * agent edited, replaced or turned into a link is the agent's change now and
 * is judged like any other.
 */
export async function verifyPlaced(treeDir: string, placed: PlacedAttachment[]): Promise<string[]> {
  const untouched: string[] = [];
  for (const entry of placed) {
    const target = join(treeDir, entry.path);
    try {
      const stats = await lstat(target);
      if (!stats.isFile()) continue;
      if (digestOf(await readFile(target)) === entry.sha256) untouched.push(entry.path);
    } catch {
      // Removed by the agent: nothing to exempt.
    }
  }
  return untouched;
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Removes the temporary copies. Idempotent, and never the reason a request fails. */
export async function discardAttachments(attachments: Attachment[] | undefined): Promise<void> {
  if (!attachments?.length) return;
  await Promise.allSettled(
    attachments.map((attachment) =>
      rm(dirname(attachment.tempPath), { recursive: true, force: true }),
    ),
  );
}

async function freePath(
  treeDir: string,
  directory: string,
  name: string,
  taken: string[],
): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = name.slice(0, dot);
  const extension = name.slice(dot);

  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = posix.join(
      directory,
      attempt === 1 ? name : `${stem}-${attempt}${extension}`,
    );
    if (!taken.includes(candidate) && !(await exists(join(treeDir, candidate)))) return candidate;
  }
  throw new Error(`could not find a free name for ${name} under ${directory}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Reads a stashed attachment back. Exists for tests and for nothing on the request path. */
export async function readStashed(attachment: Attachment): Promise<Buffer> {
  return readFile(attachment.tempPath);
}

import { validateAttachments, type AttachmentCandidate } from '@/lib/attachments';
import type { AttachmentRefusal } from '@/lib/jobs/messages';

/**
 * What the composer holds while a client picks files, and what happens when
 * they pick more. Pure, so the limits are testable without a browser: the
 * same `validateAttachments` the server runs decides here, one reason at a
 * time, and a refused pick leaves the previous selection exactly as it was.
 */

export interface AttachmentSelection<T extends AttachmentCandidate = File> {
  files: T[];
  /** Why the last pick was refused, as a key into the client's vocabulary. `null` when it was taken. */
  refusal: AttachmentRefusal | null;
}

export function emptySelection<T extends AttachmentCandidate = File>(): AttachmentSelection<T> {
  return { files: [], refusal: null };
}

/** Adds a pick to the selection, or refuses the whole pick and says why. */
export function addFiles<T extends AttachmentCandidate>(
  selection: AttachmentSelection<T>,
  picked: T[],
): AttachmentSelection<T> {
  if (picked.length === 0) return { ...selection, refusal: null };

  const combined = [
    ...selection.files,
    ...picked.filter((file) => !isSameFile(selection.files, file)),
  ];
  const refusal = validateAttachments(combined);
  if (refusal) return { files: selection.files, refusal };
  return { files: combined, refusal: null };
}

export function removeFile<T extends AttachmentCandidate>(
  selection: AttachmentSelection<T>,
  index: number,
): AttachmentSelection<T> {
  return { files: selection.files.filter((_, at) => at !== index), refusal: null };
}

/** The same file picked twice is one file, not a refusal for having too many. */
function isSameFile(files: AttachmentCandidate[], candidate: AttachmentCandidate): boolean {
  return files.some(
    (file) =>
      file.name === candidate.name && file.size === candidate.size && file.type === candidate.type,
  );
}

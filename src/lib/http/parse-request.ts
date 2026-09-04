import { z } from 'zod';

import { isModelTier } from '@/lib/models';
import { ATTACHMENT_LIMITS } from '@/lib/attachments';
import { stashUploads } from '@/lib/jobs/attachments';
import { ATTACHMENT_REFUSALS, type AttachmentRefusal } from '@/lib/jobs/messages';
import type { Attachment, ModelTier } from '@/types';

/**
 * The body of a change request, whichever way it arrived.
 *
 * A request with nothing attached is JSON, as it always was. One with files
 * is `multipart/form-data`, because that is the one encoding a browser can
 * send a file in without first turning it into text three times its size.
 * Both spell the same fields the same way, and both are validated here to
 * the same shape, so a route never knows which it was handed.
 */

const MESSAGE_LIMIT = 4_000;
const TARGET_HINT_LIMIT = 200;

const fieldsSchema = z.object({
  message: z.string().trim().min(1).max(MESSAGE_LIMIT),
  targetHint: z.string().trim().max(TARGET_HINT_LIMIT).optional(),
  modelTier: z.string().optional(),
});

export interface ChangeRequestBody {
  message: string;
  targetHint?: string;
  modelTier?: ModelTier;
  attachments: Attachment[];
}

export type ParsedChangeRequest =
  | { ok: true; body: ChangeRequestBody }
  | { ok: false; status: 400; error: 'bad_request' }
  | { ok: false; status: 413 | 415; error: AttachmentRefusal; message: string };

export async function parseChangeRequest(request: Request): Promise<ParsedChangeRequest> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.startsWith('multipart/form-data')) return parseMultipart(request);
  return parseJson(request);
}

async function parseJson(request: Request): Promise<ParsedChangeRequest> {
  const parsed = fieldsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return { ok: false, status: 400, error: 'bad_request' };
  return shape(parsed.data, []);
}

async function parseMultipart(request: Request): Promise<ParsedChangeRequest> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, status: 400, error: 'bad_request' };
  }

  const parsed = fieldsSchema.safeParse({
    message: stringField(form, 'message'),
    targetHint: stringField(form, 'targetHint'),
    modelTier: stringField(form, 'modelTier'),
  });
  if (!parsed.success) return { ok: false, status: 400, error: 'bad_request' };

  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
  // The count is refused before a byte is read; the rest of the limits need
  // the bytes and are applied while stashing.
  if (files.length > ATTACHMENT_LIMITS.maxFiles) return refused('too_many');

  const stashed = await stashUploads(files);
  if (!stashed.ok) return refused(stashed.refusal);

  return shape(parsed.data, stashed.attachments);
}

function shape(
  fields: z.infer<typeof fieldsSchema>,
  attachments: Attachment[],
): ParsedChangeRequest {
  // A tier the interface does not offer is a bad request, not a silent
  // fallback to the default: a script naming `ultra` should learn it is wrong.
  if (fields.modelTier !== undefined && !isModelTier(fields.modelTier)) {
    return { ok: false, status: 400, error: 'bad_request' };
  }
  return {
    ok: true,
    body: {
      message: fields.message,
      ...(fields.targetHint ? { targetHint: fields.targetHint } : {}),
      ...(fields.modelTier ? { modelTier: fields.modelTier } : {}),
      attachments,
    },
  };
}

function stringField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
}

/** Too big is `413`; the wrong kind is `415`; both carry the client's sentence. */
function refused(refusal: AttachmentRefusal): ParsedChangeRequest {
  const status = refusal === 'unsupported' || refusal === 'empty' ? 415 : 413;
  return { ok: false, status, error: refusal, message: ATTACHMENT_REFUSALS[refusal] };
}

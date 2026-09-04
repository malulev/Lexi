import { isModelTier } from '@/lib/models';
import type { ModelTier } from '@/types';

/**
 * How the browser sends a change request, whichever composer it came from.
 *
 * Two encodings, one shape: JSON when nothing is attached, exactly as before,
 * and a form when files ride along, because a form is the one thing a
 * browser can put a file in without inflating it. The server reads both to
 * the same fields (src/lib/http/parse-request.ts).
 */

export interface ChangePayload {
  message: string;
  modelTier?: ModelTier;
  targetHint?: string;
  files?: File[];
}

export function buildChangeRequest(payload: ChangePayload): RequestInit {
  const files = payload.files ?? [];
  if (files.length === 0) {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: payload.message,
        ...(payload.modelTier ? { modelTier: payload.modelTier } : {}),
        ...(payload.targetHint ? { targetHint: payload.targetHint } : {}),
      }),
    };
  }

  const form = new FormData();
  form.append('message', payload.message);
  if (payload.modelTier) form.append('modelTier', payload.modelTier);
  if (payload.targetHint) form.append('targetHint', payload.targetHint);
  for (const file of files) form.append('files', file, file.name);
  // No content-type header: the browser sets it, boundary included.
  return { method: 'POST', body: form };
}

export function postChange(url: string, payload: ChangePayload): Promise<Response> {
  return fetch(url, buildChangeRequest(payload));
}

/**
 * The tier a client last chose, kept in their browser only. A convenience,
 * not state: absent or unreadable, the picker opens on the installation's
 * default and nothing is worse for it.
 */
export const TIER_STORAGE_KEY = 'webagent.modelTier';

export function readRememberedTier(
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): ModelTier | null {
  try {
    const value = storage?.getItem(TIER_STORAGE_KEY);
    return isModelTier(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberTier(
  tier: ModelTier,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(TIER_STORAGE_KEY, tier);
  } catch {
    // A browser that refuses storage still gets a working picker.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

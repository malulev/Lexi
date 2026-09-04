import { describe, expect, it } from 'vitest';

import { addFiles, emptySelection, removeFile } from '@/components/attachment-state';
import { selectComposerTier, selectInitialTier } from '@/components/Composer';
import { selectConversationTier } from '@/components/ConversationView';
import { DEFAULT_TIER_MODELS } from '@/lib/models';
import type { Message } from '@/types';
import {
  buildChangeRequest,
  readRememberedTier,
  rememberTier,
  TIER_STORAGE_KEY,
} from '@/components/send-change';
import { ATTACHMENT_REFUSALS } from '@/lib/jobs/messages';

/**
 * The composer's two new controls, as pure state: the paperclip applies the
 * same limits the server does and refuses a pick without losing the previous
 * one; the effort picker opens where the client last left it.
 */

const MB = 1024 * 1024;
const png = (name: string, size = 1 * MB) => ({ name, size, type: 'image/png' });

describe('attachment selection', () => {
  it('adds a pick within the limits', () => {
    const next = addFiles(emptySelection<ReturnType<typeof png>>(), [png('a.png'), png('b.png')]);
    expect(next.files.map((file) => file.name)).toEqual(['a.png', 'b.png']);
    expect(next.refusal).toBeNull();
  });

  it('refuses a pick that would break a limit, keeping what was already chosen', () => {
    const before = addFiles(emptySelection<ReturnType<typeof png>>(), [png('a.png')]);
    const next = addFiles(before, [png('huge.png', 11 * MB)]);
    expect(next.files.map((file) => file.name)).toEqual(['a.png']);
    expect(next.refusal).toBe('too_large');
    expect(ATTACHMENT_REFUSALS[next.refusal!]).toMatch(/too large/);
  });

  it('refuses a sixth file with the count sentence', () => {
    const five = addFiles(
      emptySelection<ReturnType<typeof png>>(),
      Array.from({ length: 5 }, (_, i) => png(`${i}.png`)),
    );
    const next = addFiles(five, [png('six.png')]);
    expect(next.files).toHaveLength(5);
    expect(next.refusal).toBe('too_many');
  });

  it('treats the same file picked twice as one file', () => {
    const once = addFiles(emptySelection<ReturnType<typeof png>>(), [png('a.png')]);
    const twice = addFiles(once, [png('a.png')]);
    expect(twice.files).toHaveLength(1);
  });

  it('removes a file and clears the last refusal', () => {
    const chosen = addFiles(emptySelection<ReturnType<typeof png>>(), [png('a.png'), png('b.png')]);
    const refused = addFiles(chosen, [png('bad.png', 20 * MB)]);
    const next = removeFile(refused, 0);
    expect(next.files.map((file) => file.name)).toEqual(['b.png']);
    expect(next.refusal).toBeNull();
  });
});

describe('the request the browser sends', () => {
  it('is JSON, as before, when nothing is attached', () => {
    const request = buildChangeRequest({ message: 'Make it blue', modelTier: 'high' });
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(request.body))).toEqual({
      message: 'Make it blue',
      modelTier: 'high',
    });
  });

  it('is a form carrying the same fields when files are attached, with no content-type of its own', () => {
    const file = new File([new Uint8Array([1, 2, 3]).buffer as ArrayBuffer], 'a.png', {
      type: 'image/png',
    });
    const request = buildChangeRequest({ message: 'Use this', modelTier: 'low', files: [file] });
    expect(request.headers).toBeUndefined();
    const form = request.body as FormData;
    expect(form.get('message')).toBe('Use this');
    expect(form.get('modelTier')).toBe('low');
    expect(form.getAll('files')).toHaveLength(1);
  });
});

describe('remembering the tier', () => {
  function memory(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    };
  }

  it('reads back what was remembered, under one key', () => {
    const storage = memory();
    rememberTier('extra', storage);
    expect(storage.getItem(TIER_STORAGE_KEY)).toBe('extra');
    expect(readRememberedTier(storage)).toBe('extra');
  });

  it('ignores a value that is not a tier, and a browser with no storage', () => {
    const storage = memory();
    storage.setItem(TIER_STORAGE_KEY, 'ultra');
    expect(readRememberedTier(storage)).toBeNull();
    expect(readRememberedTier(null)).toBeNull();
    expect(() => rememberTier('low', null)).not.toThrow();
  });

  it('opens on the remembered tier, else on the installation default', () => {
    expect(selectInitialTier('medium', 'free')).toBe('free');
    expect(selectInitialTier('high', null)).toBe('high');
  });

  it('ignores what was remembered when the picker is hidden, so a conversation keeps its own tier', () => {
    expect(
      selectComposerTier({ showPicker: true, defaultTier: 'medium', remembered: 'free' }),
    ).toBe('free');
    expect(
      selectComposerTier({ showPicker: false, defaultTier: 'medium', remembered: 'free' }),
    ).toBe('medium');
    expect(selectComposerTier({ showPicker: false, defaultTier: 'high', remembered: null })).toBe(
      'high',
    );
  });
});

describe('the tier a conversation runs at', () => {
  const at = '2026-09-03T10:00:00Z';
  const client: Message = { id: 1, author: 'client', at, text: 'Make it blue' };
  const agent = (id: number, model?: string): Message => ({
    id,
    author: 'agent',
    at,
    text: 'Done.',
    outcome: 'succeeded',
    ...(model ? { model } : {}),
  });

  it('is the tier behind the latest finished change’s model', () => {
    const messages = [
      client,
      agent(2, DEFAULT_TIER_MODELS.free),
      client,
      agent(4, DEFAULT_TIER_MODELS.high),
    ];
    expect(selectConversationTier(messages, DEFAULT_TIER_MODELS, 'medium')).toBe('high');
  });

  it('honours the installation’s own tier table', () => {
    const models = { ...DEFAULT_TIER_MODELS, low: 'openrouter/acme/house-model' };
    expect(
      selectConversationTier([agent(2, 'openrouter/acme/house-model')], models, 'medium'),
    ).toBe('low');
  });

  it('falls back when nothing has run, the model maps to no tier, or the table is unknown', () => {
    expect(selectConversationTier([client], DEFAULT_TIER_MODELS, 'medium')).toBe('medium');
    expect(selectConversationTier([agent(2)], DEFAULT_TIER_MODELS, 'medium')).toBe('medium');
    expect(
      selectConversationTier([agent(2, 'openrouter/acme/other')], DEFAULT_TIER_MODELS, 'extra'),
    ).toBe('extra');
    expect(selectConversationTier([agent(2, DEFAULT_TIER_MODELS.free)], undefined, 'medium')).toBe(
      'medium',
    );
  });
});

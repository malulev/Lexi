'use client';

import { useSyncExternalStore } from 'react';

/**
 * The advanced-mode switch, remembered per browser.
 *
 * Off, a client chooses between "Free" and "Expert" and never reads a model
 * name. On, the picker names the model behind each tier with a cost estimate,
 * and each finished change says which model it ran and what it cost. The
 * switch lives in `localStorage` beside the remembered tier, and a browser
 * with no storage simply has it off.
 *
 * A tiny external store rather than context, so the picker and the message
 * list agree without a provider wrapping both, and `useSyncExternalStore`
 * renders "off" on the server so hydration never disagrees with the markup.
 */
export const ADVANCED_MODE_KEY = 'webagent.advancedMode';

const listeners = new Set<() => void>();

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readAdvancedMode(storage: Storage | null = safeStorage()): boolean {
  try {
    return storage?.getItem(ADVANCED_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeAdvancedMode(on: boolean, storage: Storage | null = safeStorage()): void {
  try {
    if (on) storage?.setItem(ADVANCED_MODE_KEY, '1');
    else storage?.removeItem(ADVANCED_MODE_KEY);
  } catch {
    // A browser that refuses storage still gets the switch for this page load.
  }
  for (const listener of listeners) listener();
}

export function subscribeAdvancedMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readCurrent(): boolean {
  return readAdvancedMode();
}

function readOnServer(): boolean {
  return false;
}

export function useAdvancedMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeAdvancedMode, readCurrent, readOnServer);
  return [on, writeAdvancedMode];
}

import { describe, expect, it } from 'vitest';

import {
  ADVANCED_MODE_KEY,
  readAdvancedMode,
  subscribeAdvancedMode,
  writeAdvancedMode,
} from '@/components/advanced-mode';

/**
 * Advanced mode is a per-browser switch: on, the interface names the model
 * behind each tier and the model each change ran. It is remembered like the
 * tier is, and a browser with no storage simply has it off.
 */

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

function broken(): Storage {
  const fail = () => {
    throw new Error('storage unavailable');
  };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, length: 0 };
}

describe('advanced mode', () => {
  it('is off until switched on, and reads back what was written', () => {
    const storage = memory();
    expect(readAdvancedMode(storage)).toBe(false);
    writeAdvancedMode(true, storage);
    expect(storage.getItem(ADVANCED_MODE_KEY)).toBe('1');
    expect(readAdvancedMode(storage)).toBe(true);
    writeAdvancedMode(false, storage);
    expect(storage.getItem(ADVANCED_MODE_KEY)).toBeNull();
    expect(readAdvancedMode(storage)).toBe(false);
  });

  it('tells a subscriber when the switch moves, and stops once unsubscribed', () => {
    const storage = memory();
    let heard = 0;
    const stop = subscribeAdvancedMode(() => {
      heard += 1;
    });
    writeAdvancedMode(true, storage);
    expect(heard).toBe(1);
    stop();
    writeAdvancedMode(false, storage);
    expect(heard).toBe(1);
  });

  it('treats a browser with no storage as off, without throwing', () => {
    expect(readAdvancedMode(null)).toBe(false);
    expect(() => writeAdvancedMode(true, null)).not.toThrow();
  });

  it('treats storage that throws the same way', () => {
    expect(readAdvancedMode(broken())).toBe(false);
    expect(() => writeAdvancedMode(true, broken())).not.toThrow();
  });
});

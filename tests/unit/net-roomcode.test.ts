import { describe, expect, it } from 'vitest';
import {
  generateRoomCode,
  isValidRoomCode,
  makePeerId,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
} from '../../src/net/roomCode';

describe('room codes', () => {
  it('alphabet has no look-alike characters', () => {
    for (const c of 'IL01O') expect(ROOM_CODE_ALPHABET).not.toContain(c);
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
  });

  it('generates 4-char codes from the alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
      expect(isValidRoomCode(code)).toBe(true);
      seen.add(code);
    }
    // 31^4 ≈ 923k codes: 2000 draws should be (almost) all distinct.
    expect(seen.size).toBeGreaterThan(1990);
    // Every character position uses the whole alphabet eventually.
    const firstChars = new Set([...seen].map((c) => c[0]));
    expect(firstChars.size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('normalizes user input', () => {
    expect(normalizeRoomCode('abcd')).toBe('ABCD');
    expect(normalizeRoomCode('  x7k2 ')).toBe('X7K2');
    expect(normalizeRoomCode('ab-cd')).toBe('ABCD');
    expect(normalizeRoomCode('a b c d')).toBe('ABCD');
  });

  it('rejects invalid codes', () => {
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode('abc')).toBeNull();
    expect(normalizeRoomCode('abcde')).toBeNull();
    expect(normalizeRoomCode('ab0d')).toBeNull(); // zero is a look-alike
    expect(normalizeRoomCode('ABIO')).toBeNull();
    expect(normalizeRoomCode('ab!d')).toBeNull();
    expect(normalizeRoomCode(undefined as unknown as string)).toBeNull();
    expect(isValidRoomCode('abcd')).toBe(false); // must already be normalized
  });

  it('makes distinct peer ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => makePeerId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{12}$/);
  });
});

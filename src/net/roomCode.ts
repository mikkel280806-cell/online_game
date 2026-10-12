// Room codes: 4 characters, no look-alikes (no I, L, O, 0, 1).

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

const VALID = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** Random integers in [0, max). Uses crypto when available. */
function randomInts(count: number, max: number): number[] {
  const out: number[] = [];
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(count);
    c.getRandomValues(buf);
    for (const v of buf) out.push(v % max);
  } else {
    for (let i = 0; i < count; i++) out.push(Math.floor(Math.random() * max));
  }
  return out;
}

export function generateRoomCode(): string {
  return randomInts(ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET.length)
    .map((i) => ROOM_CODE_ALPHABET[i])
    .join('');
}

export function isValidRoomCode(code: string): boolean {
  return VALID.test(code);
}

/**
 * Normalises user input into a room code: trims, removes inner spaces and dashes,
 * uppercases. Returns null if the result is not a valid code.
 */
export function normalizeRoomCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().replace(/[\s-]+/g, '').toUpperCase();
  return isValidRoomCode(code) ? code : null;
}

/** Random id for one browser tab / session. */
export function makePeerId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return randomInts(12, alphabet.length)
    .map((i) => alphabet[i])
    .join('');
}

// Public entry point of the net layer. See docs/ARCHITECTURE.md, "Net layer contract".
import type { NetOptions, Session } from './types';
import { createSignaling, type SignalingInit } from './signaling';
import { createRoomWith, joinRoomWith } from './session';

export type * from './types';
export { normalizeRoomCode, isValidRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './roomCode';
export { NetError, type NetErrorCode } from './session';

const factoryFor = (opts: NetOptions) => (init: SignalingInit) => createSignaling(opts.signaling, init);

/** Creates a room as host. Resolves once the room exists (phase 'waiting'). */
export function createRoom(opts: NetOptions): Promise<Session> {
  return createRoomWith(factoryFor(opts), opts);
}

/**
 * Joins a room as guest. Codes are case-insensitive. Rejects with a NetError whose message can be
 * shown to the player: "Room not found" (no host within ~10s), "Room is full", invalid code, ...
 */
export function joinRoom(code: string, opts: NetOptions): Promise<Session> {
  return joinRoomWith(factoryFor(opts), code, opts);
}

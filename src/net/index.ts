// Stub: replaced by the net layer implementation.
import type { NetOptions, Session } from './types';
export type * from './types';

export function createRoom(_opts: NetOptions): Promise<Session> {
  return Promise.reject(new Error('net layer not implemented'));
}

export function joinRoom(_code: string, _opts: NetOptions): Promise<Session> {
  return Promise.reject(new Error('net layer not implemented'));
}

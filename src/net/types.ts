// Public contract of the net layer. The game only imports from `src/net/index.ts`,
// which re-exports these types plus `createRoom` / `joinRoom`.

/** How game messages currently travel between the two players. */
export type TransportKind =
  | 'p2p' // WebRTC data channels, direct between browsers
  | 'relay' // Supabase Realtime broadcast (fallback when P2P can't connect)
  | 'local'; // BroadcastChannel relay (same-browser tests/dev only)

export type PeerRole = 'host' | 'guest';

/**
 * 'state' is lossy and unordered: high-rate snapshots where only the newest matters.
 * 'event' is reliable and ordered: things that must arrive (ability used, door opened, chat).
 */
export type Channel = 'state' | 'event';

/** Any JSON-serialisable object with a type tag. */
export interface NetMessage {
  t: string;
  [key: string]: unknown;
}

export type SessionPhase =
  | 'waiting' // host: room created, nobody else here yet
  | 'connecting' // both present, establishing transport
  | 'connected' // messages flow
  | 'disconnected' // the other player left or timed out; may return to 'connecting'
  | 'failed'; // unrecoverable (room not found, room full, ...)

export interface SessionStatus {
  phase: SessionPhase;
  transport?: TransportKind;
  /** Human-readable reason, shown in the lobby UI. */
  detail?: string;
}

export interface Session {
  readonly roomCode: string;
  readonly role: PeerRole;
  /** Random id for this browser tab, stable for the session. */
  readonly selfId: string;
  readonly status: SessionStatus;
  send(channel: Channel, msg: NetMessage): void;
  /** Returns an unsubscribe function. */
  onMessage(cb: (msg: NetMessage, channel: Channel) => void): () => void;
  /** Called on every status change. Returns an unsubscribe function. */
  onStatus(cb: (status: SessionStatus) => void): () => void;
  /** Smoothed round-trip time in ms, or null before the first measurement. */
  rttMs(): number | null;
  close(): void;
}

export interface NetOptions {
  /**
   * 'supabase' for real play over the internet.
   * 'broadcast' uses the browser's BroadcastChannel: two tabs of the same browser
   * profile can play together with no server. Used by e2e tests and offline dev.
   */
  signaling: 'supabase' | 'broadcast';
  /** Skip WebRTC and go straight to the relay transport. */
  forceRelay?: boolean;
  /** How long to try P2P before falling back to relay. Default 8000. */
  p2pTimeoutMs?: number;
  /** Override ICE servers. Default: public Google STUN. */
  iceServers?: RTCIceServer[];
}

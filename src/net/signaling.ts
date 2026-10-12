// Signaling: a per-room channel that carries presence plus small JSON messages
// (offer/answer/ICE, session control and, as a fallback, relayed game messages).
//
// Two implementations share one base class so the session logic is identical:
//  - SupabaseSignaling: Supabase Realtime broadcast + presence (real play).
//  - BroadcastSignaling: BroadcastChannel with heartbeat presence (same-browser tests / offline dev).

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { PeerRole } from './types';

/** A message as sent by the session. `to` addresses one peer; omit it to reach everyone. */
export interface OutgoingSignal {
  kind: string;
  to?: string;
  [key: string]: unknown;
}

/** A message as received: the signaling layer stamps the sender's id. */
export interface SignalMessage extends OutgoingSignal {
  from: string;
}

export interface PeerInfo {
  id: string;
  role: PeerRole;
  /** Sender's wall clock (ms) when it joined. Only used for ordering. */
  joinedAt: number;
}

export interface SignalingInit {
  code: string;
  selfId: string;
  role: PeerRole;
  joinedAt: number;
}

export interface Signaling {
  readonly selfId: string;
  /** Transport reported when game messages are relayed over this signaling channel. */
  readonly relayKind: 'relay' | 'local';
  /** Resolves once the channel is joined and our own presence is announced. */
  readonly ready: Promise<void>;
  /** Sends a message to the room (stamped with `from`). Dropped silently when closed. */
  send(msg: OutgoingSignal): void;
  /** Only messages from other peers that are addressed to us (or to everyone) arrive here. */
  onMessage(cb: (msg: SignalMessage) => void): () => void;
  /** Other peers currently present (never self), sorted by joinedAt then id. */
  peers(): PeerInfo[];
  /** Called whenever the set of present peers changes. */
  onPresence(cb: (peers: PeerInfo[]) => void): () => void;
  close(): void;
}

export type SignalingFactory = (init: SignalingInit) => Signaling;

export function roomChannelName(code: string): string {
  return `hs-room-${code}`;
}

export function isSignalMessage(raw: unknown): raw is SignalMessage {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Record<string, unknown>;
  return (
    typeof m.kind === 'string' &&
    typeof m.from === 'string' &&
    (m.to === undefined || typeof m.to === 'string')
  );
}

function comparePeers(a: PeerInfo, b: PeerInfo): number {
  return a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function samePeers(a: PeerInfo[], b: PeerInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.id === b[i].id && p.role === b[i].role && p.joinedAt === b[i].joinedAt);
}

function parseRole(v: unknown): PeerRole | null {
  return v === 'host' || v === 'guest' ? v : null;
}

/** Shared plumbing: listener sets, to/from filtering and presence diffing. */
export abstract class BaseSignaling implements Signaling {
  abstract readonly relayKind: 'relay' | 'local';
  readonly selfId: string;
  readonly ready: Promise<void>;
  protected closed = false;
  private settleReady!: (err?: Error) => void;
  private msgCbs = new Set<(msg: SignalMessage) => void>();
  private presenceCbs = new Set<(peers: PeerInfo[]) => void>();
  private peerList: PeerInfo[] = [];

  constructor(protected readonly init: SignalingInit) {
    this.selfId = init.selfId;
    let settled = false;
    this.ready = new Promise<void>((resolve, reject) => {
      this.settleReady = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };
    });
    // Nobody may be awaiting `ready` when it rejects (e.g. closed early).
    this.ready.catch(() => {});
  }

  protected markReady(err?: Error): void {
    this.settleReady(err);
  }

  send(msg: OutgoingSignal): void {
    if (this.closed) return;
    this.transmit({ ...msg, from: this.selfId });
  }

  onMessage(cb: (msg: SignalMessage) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  peers(): PeerInfo[] {
    return this.peerList.slice();
  }

  onPresence(cb: (peers: PeerInfo[]) => void): () => void {
    this.presenceCbs.add(cb);
    return () => this.presenceCbs.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.markReady(new Error('Signaling closed'));
    this.shutdown();
    this.msgCbs.clear();
    this.presenceCbs.clear();
    this.peerList = [];
  }

  /** Hand an incoming wire payload to listeners if it is meant for us. */
  protected deliver(raw: unknown): void {
    if (this.closed || !isSignalMessage(raw)) return;
    if (raw.from === this.selfId) return;
    if (raw.to !== undefined && raw.to !== this.selfId) return;
    for (const cb of [...this.msgCbs]) {
      try {
        cb(raw);
      } catch (err) {
        console.error('[net] signal handler failed', err);
      }
    }
  }

  /** Replace the presence list; listeners are only called when it actually changed. */
  protected setPeers(list: PeerInfo[]): void {
    if (this.closed) return;
    const next = list.filter((p) => p.id !== this.selfId).sort(comparePeers);
    if (samePeers(next, this.peerList)) return;
    this.peerList = next;
    for (const cb of [...this.presenceCbs]) {
      try {
        cb(next.slice());
      } catch (err) {
        console.error('[net] presence handler failed', err);
      }
    }
  }

  protected abstract transmit(msg: SignalMessage): void;
  protected abstract shutdown(): void;
}

// ---------------------------------------------------------------------------
// Supabase Realtime

export class SupabaseSignaling extends BaseSignaling {
  readonly relayKind = 'relay' as const;
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;

  constructor(init: SignalingInit) {
    super(init);
    void this.connect();
  }

  private async connect(): Promise<void> {
    try {
      // Loaded lazily so the broadcast path (tests, offline dev) never pulls in supabase-js.
      const { getSupabase } = await import('../services/supabase');
      if (this.closed) return;
      const client = getSupabase();
      const channel = client.channel(roomChannelName(this.init.code), {
        config: { broadcast: { self: false }, presence: { key: this.selfId } },
      });
      this.client = client;
      this.channel = channel;
      channel
        .on('broadcast', { event: 'sig' }, (msg) => this.deliver(msg.payload))
        .on('presence', { event: 'sync' }, () => this.syncPresence())
        .subscribe((status, err) => {
          if (this.closed) return;
          if (status === 'SUBSCRIBED') {
            // Runs again after automatic rejoins, so presence is re-announced too.
            channel
              .track({ role: this.init.role, joinedAt: this.init.joinedAt })
              .then((res) => {
                if (res === 'ok') this.markReady();
                else this.markReady(new Error(`Presence track failed: ${res}`));
              })
              .catch((e: unknown) => this.markReady(e instanceof Error ? e : new Error(String(e))));
          } else {
            // CHANNEL_ERROR / TIMED_OUT / CLOSED. realtime-js retries on its own after a
            // successful join; before that, fail fast so the lobby can show an error.
            this.markReady(err ?? new Error(`Realtime channel ${status}`));
            if (status !== 'CLOSED') console.warn('[net] realtime channel', status, err);
          }
        });
    } catch (err) {
      this.markReady(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private syncPresence(): void {
    const channel = this.channel;
    if (!channel) return;
    const state = channel.presenceState<{ role?: unknown; joinedAt?: unknown }>();
    const list: PeerInfo[] = [];
    for (const [id, metas] of Object.entries(state)) {
      const meta = metas.find((m) => parseRole(m.role));
      if (!meta) continue;
      list.push({
        id,
        role: parseRole(meta.role)!,
        joinedAt: typeof meta.joinedAt === 'number' ? meta.joinedAt : 0,
      });
    }
    this.setPeers(list);
  }

  protected transmit(msg: SignalMessage): void {
    const channel = this.channel;
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'sig', payload: msg }).catch((err: unknown) => {
      console.warn('[net] realtime send failed', err);
    });
  }

  protected shutdown(): void {
    const channel = this.channel;
    this.channel = null;
    if (channel && this.client) {
      this.client.removeChannel(channel).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// BroadcastChannel (same browser profile only)

type BroadcastWire =
  | { hs: 1; type: 'hb'; id: string; role: PeerRole; joinedAt: number; ask?: boolean }
  | { hs: 1; type: 'leave'; id: string }
  | { hs: 1; type: 'sig'; msg: SignalMessage };

export interface BroadcastTiming {
  /** How often each peer announces itself. */
  heartbeatMs: number;
  /** A peer not heard from for this long is considered gone. */
  timeoutMs: number;
}

export const DEFAULT_BROADCAST_TIMING: BroadcastTiming = { heartbeatMs: 500, timeoutMs: 2000 };

export class BroadcastSignaling extends BaseSignaling {
  readonly relayKind = 'local' as const;
  private bc: BroadcastChannel;
  private seen = new Map<string, { info: PeerInfo; lastSeen: number }>();
  private timer: ReturnType<typeof setInterval>;
  private readonly onPageHide = (): void => this.post({ hs: 1, type: 'leave', id: this.selfId });
  private readonly onPageShow = (e: PageTransitionEvent): void => {
    if (e.persisted) this.heartbeat(true);
  };

  constructor(
    init: SignalingInit,
    private readonly timing: BroadcastTiming = DEFAULT_BROADCAST_TIMING,
  ) {
    super(init);
    if (typeof BroadcastChannel === 'undefined') {
      throw new Error('BroadcastChannel is not supported in this browser');
    }
    this.bc = new BroadcastChannel(roomChannelName(init.code));
    this.bc.onmessage = (e: MessageEvent) => this.onWire(e.data);
    // Ask everyone present to answer right away so presence is known in ~1 tick, not ~heartbeatMs.
    this.heartbeat(true);
    this.timer = setInterval(() => {
      this.heartbeat(false);
      this.prune();
    }, timing.heartbeatMs);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      window.addEventListener('pageshow', this.onPageShow);
    }
    this.markReady();
  }

  private post(wire: BroadcastWire): void {
    try {
      this.bc.postMessage(wire);
    } catch (err) {
      console.warn('[net] BroadcastChannel post failed', err);
    }
  }

  private heartbeat(ask: boolean): void {
    if (this.closed) return;
    const { role, joinedAt } = this.init;
    this.post({ hs: 1, type: 'hb', id: this.selfId, role, joinedAt, ask });
  }

  private onWire(data: unknown): void {
    if (this.closed || !data || typeof data !== 'object') return;
    const w = data as BroadcastWire;
    if (w.hs !== 1) return;
    if (w.type === 'sig') {
      this.deliver(w.msg);
      return;
    }
    if (typeof w.id !== 'string' || w.id === this.selfId) return;
    if (w.type === 'hb') {
      const role = parseRole(w.role);
      if (!role) return;
      this.seen.set(w.id, {
        info: { id: w.id, role, joinedAt: Number(w.joinedAt) || 0 },
        lastSeen: Date.now(),
      });
      if (w.ask) this.heartbeat(false);
      this.publish();
    } else if (w.type === 'leave') {
      if (this.seen.delete(w.id)) this.publish();
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.timing.timeoutMs;
    let changed = false;
    for (const [id, entry] of this.seen) {
      if (entry.lastSeen < cutoff) {
        this.seen.delete(id);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  private publish(): void {
    this.setPeers([...this.seen.values()].map((e) => e.info));
  }

  protected transmit(msg: SignalMessage): void {
    // JSON round trip (not structured clone) so semantics match the Supabase path.
    this.post({ hs: 1, type: 'sig', msg: JSON.parse(JSON.stringify(msg)) as SignalMessage });
  }

  protected shutdown(): void {
    clearInterval(this.timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      window.removeEventListener('pageshow', this.onPageShow);
    }
    this.post({ hs: 1, type: 'leave', id: this.selfId });
    this.bc.onmessage = null;
    this.bc.close();
    this.seen.clear();
  }
}

export function createSignaling(kind: 'supabase' | 'broadcast', init: SignalingInit): Signaling {
  return kind === 'broadcast' ? new BroadcastSignaling(init) : new SupabaseSignaling(init);
}

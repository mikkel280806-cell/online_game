// Session: room admission, WebRTC setup, relay fallback, RTT and reconnects.
//
// Signal protocol (all addressed with `to`, stamped with `from` by the signaling layer):
//   guest → host  join    {epoch}       "let me in" (epoch = last link epoch I had with you, 0 if none)
//   host  → guest welcome {epoch,relay} admitted; starts link `epoch` (relay: skip WebRTC)
//   host  → guest full                  someone else has the slot
//   host  → guest offer   {epoch,sdp}
//   guest → host  answer  {epoch,sdp}
//   both          ice     {epoch,candidate}
//   both          relay   {epoch}       "I gave up on P2P for this link; use signaling"
//   both          msg     {ch,d}        a relayed game/control message (JSON string)
//   both          bye                   leaving on purpose
//
// A "link" is one attempt at a transport between host and the admitted guest. The host numbers
// them (epoch). Receiving is transport-agnostic (P2P and relayed messages are both accepted), only
// sending picks the current transport, so both sides never need to switch at the same instant.

import type {
  Channel,
  NetMessage,
  NetOptions,
  PeerRole,
  Session,
  SessionStatus,
  TransportKind,
} from './types';
import type {
  PeerInfo,
  Signaling,
  SignalingFactory,
  SignalingInit,
  SignalMessage,
} from './signaling';
import { generateRoomCode, makePeerId, normalizeRoomCode } from './roomCode';

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export const DEFAULT_P2P_TIMEOUT_MS = 8000;

/** Internal timings. Defaults match the contract; tests shrink them. */
export interface Tuning {
  /** Host listens this long for an existing occupant before claiming a fresh code. */
  hostProbeMs: number;
  /** Guest gives up if not admitted by a host within this time. */
  joinTimeoutMs: number;
  /** Guest re-sends `join` this often until admitted. */
  joinRetryMs: number;
  /** Max time to wait for the signaling channel itself. */
  readyTimeoutMs: number;
  pingIntervalMs: number;
  /** Host waits this long after a broken P2P link before re-offering. */
  restartDelayMs: number;
  /** How many fresh codes the host tries before giving up. */
  maxCodeAttempts: number;
  /** EMA weight of each new RTT sample. */
  rttAlpha: number;
}

export const DEFAULT_TUNING: Tuning = {
  hostProbeMs: 700,
  joinTimeoutMs: 10_000,
  joinRetryMs: 1000,
  readyTimeoutMs: 20_000,
  pingIntervalMs: 2000,
  restartDelayMs: 1000,
  maxCodeAttempts: 8,
  rttAlpha: 0.25,
};

export type NetErrorCode =
  | 'invalid-code'
  | 'room-not-found'
  | 'room-full'
  | 'no-answer'
  | 'unreachable';

/** Rejection reason of createRoom / joinRoom. `message` is friendly enough for the lobby UI. */
export class NetError extends Error {
  readonly code: NetErrorCode;
  constructor(message: string, code: NetErrorCode) {
    super(message);
    this.name = 'NetError';
    this.code = code;
  }
}

const MAX_EVENT_QUEUE = 1000;
/** Drop `state` messages instead of buffering when the data channel is this far behind. */
const STATE_BUFFER_LIMIT = 64 * 1024;

const CHANNEL_INIT: Record<Channel, RTCDataChannelInit> = {
  state: { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 },
  event: { negotiated: true, id: 1, ordered: true },
};

interface ResolvedOptions {
  forceRelay: boolean;
  p2pTimeoutMs: number;
  iceServers: RTCIceServer[];
}

interface Link {
  epoch: number;
  peerId: string;
  /** pending: P2P being negotiated; p2p: data channels open; relay: over signaling. */
  mode: 'pending' | 'p2p' | 'relay';
  up: boolean;
  pc: RTCPeerConnection | null;
  dcs: Partial<Record<Channel, RTCDataChannel>>;
  remoteSet: boolean;
  pendingIce: RTCIceCandidateInit[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** Control messages travel as JSON arrays so they can never collide with game messages. */
const ping = (ts: number): string => JSON.stringify(['ping', ts]);
const pong = (ts: number): string => JSON.stringify(['pong', ts]);

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

function webrtcAvailable(): boolean {
  return typeof globalThis.RTCPeerConnection === 'function';
}

function resolveOptions(opts: NetOptions): ResolvedOptions {
  return {
    forceRelay: !!opts.forceRelay,
    p2pTimeoutMs: opts.p2pTimeoutMs ?? DEFAULT_P2P_TIMEOUT_MS,
    iceServers: opts.iceServers ?? DEFAULT_ICE_SERVERS,
  };
}

const DETAIL = {
  waiting: 'Waiting for the other player…',
  joining: 'Looking for the room…',
  connecting: 'Connecting…',
  p2p: 'Connected directly',
  relayed: 'Connected through relay',
  peerLeft: 'The other player left',
  linkLost: 'Connection lost, reconnecting…',
  closed: 'Left the room',
};

export class NetSession implements Session {
  readonly roomCode: string;
  readonly role: PeerRole;
  readonly selfId: string;

  private _status: SessionStatus;
  private readonly opts: ResolvedOptions;
  private closed = false;

  /** host: the admitted guest. guest: the host that welcomed us. */
  private peerId: string | null = null;
  /** Whether peerId has shown up in presence yet (presence can lag behind messages). */
  private peerSeen = false;
  /** Peers that said bye; never (re)admitted from a stale presence list. */
  private departed = new Set<string>();
  /** host: last epoch issued. */
  private epoch = 0;
  /** guest: last (host, epoch) we were welcomed with, to spot duplicates and lost links. */
  private lastHost: string | null = null;
  private lastEpoch = 0;
  private link: Link | null = null;

  /** Serialized 'event' messages waiting for a connection. */
  private queue: string[] = [];
  private rtt: number | null = null;
  private msgCbs = new Set<(msg: NetMessage, channel: Channel) => void>();
  private statusCbs = new Set<(status: SessionStatus) => void>();
  private unsubs: (() => void)[] = [];

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private joinTimer: ReturnType<typeof setInterval> | null = null;
  private joinDeadline: ReturnType<typeof setTimeout> | null = null;
  private pendingJoin: { resolve: (s: Session) => void; reject: (e: Error) => void } | null = null;
  private hostSeen = false;

  constructor(
    private readonly sig: Signaling,
    role: PeerRole,
    roomCode: string,
    opts: NetOptions,
    private readonly tuning: Tuning,
  ) {
    this.role = role;
    this.roomCode = roomCode;
    this.selfId = sig.selfId;
    this.opts = resolveOptions(opts);
    this._status =
      role === 'host'
        ? { phase: 'waiting', detail: DETAIL.waiting }
        : { phase: 'connecting', detail: DETAIL.joining };
    this.unsubs.push(
      sig.onMessage((m) => this.onSignal(m)),
      sig.onPresence((peers) => this.onPresence(peers)),
    );
    if (role === 'guest') {
      this.joinTimer = setInterval(() => this.tryJoin(), tuning.joinRetryMs);
    }
    this.onPresence(sig.peers());
  }

  // ---- public API ---------------------------------------------------------

  get status(): SessionStatus {
    return this._status;
  }

  send(channel: Channel, msg: NetMessage): void {
    if (this.closed) return;
    // Serialize now: throws to the caller on non-JSON input, and snapshots queued messages.
    const raw = JSON.stringify(msg);
    if (this.link?.up && this.transmit(channel, raw)) return;
    if (channel === 'event') {
      this.queue.push(raw);
      if (this.queue.length > MAX_EVENT_QUEUE) this.queue.shift();
    }
    // 'state' is lossy by contract: dropped while not connected.
  }

  onMessage(cb: (msg: NetMessage, channel: Channel) => void): () => void {
    this.msgCbs.add(cb);
    return () => {
      this.msgCbs.delete(cb);
    };
  }

  onStatus(cb: (status: SessionStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => {
      this.statusCbs.delete(cb);
    };
  }

  rttMs(): number | null {
    return this.rtt;
  }

  close(): void {
    if (this.closed) return;
    if (this.peerId) this.sig.send({ kind: 'bye', to: this.peerId });
    this.shutdown();
    this._status = { phase: 'disconnected', detail: DETAIL.closed };
    this.msgCbs.clear();
    this.statusCbs.clear();
  }

  /** Guest only: resolves once a host admits us, rejects on full / not found. */
  waitForAdmission(timeoutMs: number): Promise<Session> {
    return new Promise<Session>((resolve, reject) => {
      if (this.closed) {
        reject(new NetError(this._status.detail ?? 'Could not join the room', 'room-not-found'));
        return;
      }
      if (this.peerId) {
        resolve(this);
        return;
      }
      this.pendingJoin = { resolve, reject };
      this.joinDeadline = setTimeout(() => {
        this.joinDeadline = null;
        if (!this.pendingJoin) return;
        if (this.hostSeen) this.fail('The host did not answer', 'no-answer');
        else this.fail('Room not found', 'room-not-found');
      }, timeoutMs);
    });
  }

  // ---- presence & signaling -----------------------------------------------

  private onPresence(peers: PeerInfo[]): void {
    if (this.closed) return;
    if (this.peerId) {
      if (peers.some((p) => p.id === this.peerId)) this.peerSeen = true;
      else if (this.peerSeen) this.dropPeer(DETAIL.peerLeft);
    }
    if (this.role === 'host') {
      if (!this.peerId) {
        // peers is sorted by joinedAt, so the earliest guest wins a simultaneous join.
        const guest = peers.find((p) => p.role === 'guest' && !this.departed.has(p.id));
        if (guest) this.admit(guest.id);
      }
    } else {
      this.tryJoin();
    }
  }

  private onSignal(m: SignalMessage): void {
    if (this.closed) return;
    switch (m.kind) {
      case 'join':
        if (this.role === 'host') this.onJoin(m);
        break;
      case 'welcome':
        if (this.role === 'guest') this.onWelcome(m);
        break;
      case 'full':
        if (this.role === 'guest') this.fail('Room is full', 'room-full');
        break;
      case 'offer':
        if (this.role === 'guest') this.onOffer(m);
        break;
      case 'answer':
        if (this.role === 'host') this.onAnswer(m);
        break;
      case 'ice':
        this.onIce(m);
        break;
      case 'relay': {
        const link = this.link;
        if (link && m.from === link.peerId && m.epoch === link.epoch) this.switchToRelay(false);
        break;
      }
      case 'msg':
        if (m.from === this.peerId && (m.ch === 'state' || m.ch === 'event') && typeof m.d === 'string') {
          this.onWire(m.ch, m.d);
        }
        break;
      case 'bye':
        this.departed.add(m.from);
        if (m.from === this.peerId) this.dropPeer(DETAIL.peerLeft);
        break;
    }
  }

  // ---- host ---------------------------------------------------------------

  private onJoin(m: SignalMessage): void {
    const from = m.from;
    if (this.peerId === null) {
      // Admit only peers we can see, so a stale presence update can't immediately drop them.
      if (!this.departed.has(from) && this.isPresent(from)) this.admit(from);
      return;
    }
    if (this.peerId !== from) {
      this.sig.send({ kind: 'full', to: from });
      return;
    }
    // Our current guest asks again: either it never got the welcome (resend), or it lost the
    // link we think we have (it reports the current epoch) — then start a fresh link.
    if (m.epoch === this.epoch || !this.link) this.startEpoch();
    else this.sendWelcome();
  }

  private admit(guestId: string): void {
    this.peerId = guestId;
    this.peerSeen = this.isPresent(guestId);
    this.startEpoch();
  }

  private sendWelcome(): void {
    if (!this.peerId) return;
    this.sig.send({ kind: 'welcome', to: this.peerId, epoch: this.epoch, relay: this.mustRelay() });
  }

  /** Host: (re)start a link with the admitted guest. */
  private startEpoch(): void {
    if (!this.peerId) return;
    this.clearRestart();
    this.teardownLink();
    this.stopPing();
    this.epoch += 1;
    this.sendWelcome();
    this.setStatus({ phase: 'connecting', detail: DETAIL.connecting });
    const link = this.beginLink(this.epoch, this.peerId);
    if (this.mustRelay()) this.switchToRelay(false);
    else this.startOffer(link);
  }

  private startOffer(link: Link): void {
    let pc: RTCPeerConnection;
    try {
      pc = this.createPeerConnection(link);
    } catch (err) {
      console.warn('[net] RTCPeerConnection failed, using relay', err);
      this.switchToRelay(true);
      return;
    }
    void (async () => {
      try {
        const offer = await pc.createOffer();
        if (!this.isNegotiating(link)) return;
        await pc.setLocalDescription(offer);
        if (!this.isNegotiating(link)) return;
        const sdp = pc.localDescription?.sdp ?? offer.sdp;
        this.sig.send({ kind: 'offer', to: link.peerId, epoch: link.epoch, sdp });
      } catch (err) {
        if (!this.isNegotiating(link)) return;
        console.warn('[net] offer failed, using relay', err);
        this.switchToRelay(true);
      }
    })();
  }

  private onAnswer(m: SignalMessage): void {
    const link = this.link;
    if (!link || m.from !== link.peerId || m.epoch !== link.epoch) return;
    const pc = link.pc;
    if (!pc || link.remoteSet || link.mode !== 'pending' || typeof m.sdp !== 'string') return;
    link.remoteSet = true;
    pc.setRemoteDescription({ type: 'answer', sdp: m.sdp })
      .then(() => {
        if (this.isNegotiating(link)) this.flushIce(link);
      })
      .catch((err: unknown) => {
        if (!this.isNegotiating(link)) return;
        console.warn('[net] bad answer, using relay', err);
        this.switchToRelay(true);
      });
  }

  private scheduleRestart(): void {
    this.clearRestart();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.closed && this.peerId && !this.link) this.startEpoch();
    }, this.tuning.restartDelayMs);
  }

  private clearRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  // ---- guest --------------------------------------------------------------

  private tryJoin(): void {
    if (this.closed || this.role !== 'guest' || this.link) return;
    const host = this.sig.peers().find((p) => p.role === 'host');
    if (!host) return;
    this.hostSeen = true;
    const epoch = host.id === this.lastHost ? this.lastEpoch : 0;
    this.sig.send({ kind: 'join', to: host.id, epoch });
  }

  private onWelcome(m: SignalMessage): void {
    if (typeof m.epoch !== 'number') return;
    // Duplicate (or stale) welcome we already acted on. If that link is gone, our next `join`
    // (carrying this epoch) makes the host start a new one.
    if (m.from === this.lastHost && m.epoch <= this.lastEpoch) return;
    if (this.peerId !== m.from) this.peerSeen = this.isPresent(m.from);
    this.peerId = m.from;
    this.lastHost = m.from;
    this.lastEpoch = m.epoch;
    this.teardownLink();
    this.stopPing();
    this.setStatus({ phase: 'connecting', detail: DETAIL.connecting });
    this.beginLink(m.epoch, m.from);
    if (m.relay === true) this.switchToRelay(false);
    else if (this.mustRelay()) this.switchToRelay(true);
    this.resolveJoin();
  }

  private onOffer(m: SignalMessage): void {
    const link = this.link;
    if (!link || m.from !== link.peerId || m.epoch !== link.epoch) return;
    if (link.mode !== 'pending' || link.pc || typeof m.sdp !== 'string') return;
    const sdp = m.sdp;
    let pc: RTCPeerConnection;
    try {
      pc = this.createPeerConnection(link);
    } catch (err) {
      console.warn('[net] RTCPeerConnection failed, using relay', err);
      this.switchToRelay(true);
      return;
    }
    void (async () => {
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp });
        if (!this.isNegotiating(link)) return;
        link.remoteSet = true;
        this.flushIce(link);
        const answer = await pc.createAnswer();
        if (!this.isNegotiating(link)) return;
        await pc.setLocalDescription(answer);
        if (!this.isNegotiating(link)) return;
        const local = pc.localDescription?.sdp ?? answer.sdp;
        this.sig.send({ kind: 'answer', to: link.peerId, epoch: link.epoch, sdp: local });
      } catch (err) {
        if (!this.isNegotiating(link)) return;
        console.warn('[net] answering failed, using relay', err);
        this.switchToRelay(true);
      }
    })();
  }

  private resolveJoin(): void {
    const pending = this.pendingJoin;
    if (!pending) return;
    this.pendingJoin = null;
    if (this.joinDeadline) clearTimeout(this.joinDeadline);
    this.joinDeadline = null;
    pending.resolve(this);
  }

  // ---- links (both roles) -------------------------------------------------

  private isPresent(id: string): boolean {
    return this.sig.peers().some((p) => p.id === id);
  }

  private mustRelay(): boolean {
    return this.opts.forceRelay || !webrtcAvailable();
  }

  private beginLink(epoch: number, peerId: string): Link {
    const link: Link = {
      epoch,
      peerId,
      mode: 'pending',
      up: false,
      pc: null,
      dcs: {},
      remoteSet: false,
      pendingIce: [],
      timer: null,
    };
    this.link = link;
    link.timer = setTimeout(() => {
      link.timer = null;
      if (this.link === link && !link.up) this.switchToRelay(true);
    }, this.opts.p2pTimeoutMs);
    return link;
  }

  /** True while `link` is the current link and still negotiating WebRTC. */
  private isNegotiating(link: Link): boolean {
    return !this.closed && this.link === link && link.mode === 'pending';
  }

  private createPeerConnection(link: Link): RTCPeerConnection {
    const pc = new globalThis.RTCPeerConnection({ iceServers: this.opts.iceServers });
    link.pc = pc;
    pc.onicecandidate = (e) => {
      if (!e.candidate || !this.isNegotiating(link)) return;
      this.sig.send({ kind: 'ice', to: link.peerId, epoch: link.epoch, candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.onP2PFailure(link);
    };
    for (const ch of ['state', 'event'] as const) {
      const dc = pc.createDataChannel(ch, CHANNEL_INIT[ch]);
      link.dcs[ch] = dc;
      dc.onopen = () => this.onChannelOpen(link);
      dc.onclose = () => this.onP2PFailure(link);
      dc.onmessage = (e: MessageEvent) => {
        if (typeof e.data === 'string') this.onWire(ch, e.data);
      };
    }
    return pc;
  }

  private onIce(m: SignalMessage): void {
    const link = this.link;
    if (!link || m.from !== link.peerId || m.epoch !== link.epoch || link.mode !== 'pending') return;
    const candidate = m.candidate as RTCIceCandidateInit | undefined;
    if (!candidate || typeof candidate !== 'object') return;
    if (link.pc && link.remoteSet) {
      link.pc.addIceCandidate(candidate).catch(() => {});
    } else {
      link.pendingIce.push(candidate);
    }
  }

  private flushIce(link: Link): void {
    const pc = link.pc;
    if (!pc) return;
    for (const c of link.pendingIce.splice(0)) pc.addIceCandidate(c).catch(() => {});
  }

  private onChannelOpen(link: Link): void {
    if (!this.isNegotiating(link)) return;
    if (link.dcs.state?.readyState !== 'open' || link.dcs.event?.readyState !== 'open') return;
    link.mode = 'p2p';
    this.linkUp('p2p');
  }

  private onP2PFailure(link: Link): void {
    if (this.closed || this.link !== link || link.mode === 'relay') return;
    if (link.mode === 'pending') {
      // ICE failed before we ever connected: no point waiting for the timeout.
      this.switchToRelay(true);
      return;
    }
    // An established P2P link broke while the peer may still be around.
    this.teardownLink();
    this.stopPing();
    this.setStatus({ phase: 'disconnected', detail: DETAIL.linkLost });
    if (this.role === 'host') this.scheduleRestart();
    else this.tryJoin(); // reports the lost epoch, so the host re-offers at once
  }

  private switchToRelay(notify: boolean): void {
    const link = this.link;
    if (!link || link.mode === 'relay' || this.closed) return;
    this.closePeerConnection(link);
    link.mode = 'relay';
    if (notify) this.sig.send({ kind: 'relay', to: link.peerId, epoch: link.epoch });
    this.linkUp(this.sig.relayKind);
  }

  private linkUp(transport: TransportKind): void {
    const link = this.link;
    if (!link) return;
    link.up = true;
    if (link.timer) clearTimeout(link.timer);
    link.timer = null;
    this.flushQueue();
    this.setStatus({
      phase: 'connected',
      transport,
      detail: transport === 'p2p' ? DETAIL.p2p : DETAIL.relayed,
    });
    this.startPing();
  }

  private dropPeer(detail: string): void {
    this.teardownLink();
    this.stopPing();
    this.clearRestart();
    this.peerId = null;
    this.peerSeen = false;
    this.setStatus({ phase: 'disconnected', detail });
    if (this.role === 'guest') this.tryJoin();
  }

  private teardownLink(): void {
    const link = this.link;
    if (!link) return;
    this.link = null;
    if (link.timer) clearTimeout(link.timer);
    link.timer = null;
    this.closePeerConnection(link);
  }

  private closePeerConnection(link: Link): void {
    for (const dc of Object.values(link.dcs)) {
      dc.onopen = null;
      dc.onclose = null;
      dc.onmessage = null;
      try {
        dc.close();
      } catch {
        /* already closed */
      }
    }
    link.dcs = {};
    const pc = link.pc;
    link.pc = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
    link.pendingIce = [];
  }

  // ---- messages -----------------------------------------------------------

  /**
   * Sends a serialized message on the current link. Returns false only if the link is not ready
   * (the caller may queue and retry); a message the channel refuses outright (e.g. too large) is
   * dropped with a warning so it cannot block the queue.
   */
  private transmit(channel: Channel, raw: string): boolean {
    const link = this.link;
    if (!link || !link.up) return false;
    if (link.mode === 'p2p') {
      const dc = link.dcs[channel];
      if (!dc || dc.readyState !== 'open') return false;
      if (channel === 'state' && dc.bufferedAmount > STATE_BUFFER_LIMIT) return true; // lossy: skip
      try {
        dc.send(raw);
      } catch (err) {
        console.warn('[net] data channel refused a message; dropped', err);
      }
      return true;
    }
    if (link.mode === 'relay') {
      this.sig.send({ kind: 'msg', to: link.peerId, ch: channel, d: raw });
      return true;
    }
    return false;
  }

  private flushQueue(): void {
    while (this.queue.length > 0) {
      if (!this.transmit('event', this.queue[0])) return;
      this.queue.shift();
    }
  }

  private onWire(channel: Channel, raw: string): void {
    if (this.closed) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (Array.isArray(data)) {
      const [op, ts] = data as unknown[];
      if (typeof ts !== 'number') return;
      if (op === 'ping') this.transmit('event', pong(ts));
      else if (op === 'pong') this.addRttSample(now() - ts);
      return;
    }
    if (!data || typeof data !== 'object' || typeof (data as NetMessage).t !== 'string') return;
    for (const cb of [...this.msgCbs]) {
      try {
        cb(data as NetMessage, channel);
      } catch (err) {
        console.error('[net] message handler failed', err);
      }
    }
  }

  private startPing(): void {
    if (this.pingTimer) return;
    this.sendPing();
    this.pingTimer = setInterval(() => this.sendPing(), this.tuning.pingIntervalMs);
  }

  private sendPing(): void {
    this.transmit('event', ping(now()));
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private addRttSample(sample: number): void {
    if (!(sample >= 0) || !Number.isFinite(sample)) return;
    this.rtt = this.rtt === null ? sample : this.rtt + this.tuning.rttAlpha * (sample - this.rtt);
  }

  // ---- status & lifecycle -------------------------------------------------

  private setStatus(next: SessionStatus): void {
    const cur = this._status;
    if (cur.phase === next.phase && cur.transport === next.transport && cur.detail === next.detail) return;
    this._status = next;
    for (const cb of [...this.statusCbs]) {
      try {
        cb(next);
      } catch (err) {
        console.error('[net] status handler failed', err);
      }
    }
  }

  private fail(detail: string, code: NetErrorCode): void {
    if (this.closed) return;
    const pending = this.pendingJoin;
    this.pendingJoin = null;
    this.shutdown();
    this.setStatus({ phase: 'failed', detail });
    pending?.reject(new NetError(detail, code));
    this.msgCbs.clear();
    this.statusCbs.clear();
  }

  private shutdown(): void {
    this.closed = true;
    if (this.joinTimer) clearInterval(this.joinTimer);
    if (this.joinDeadline) clearTimeout(this.joinDeadline);
    this.joinTimer = null;
    this.joinDeadline = null;
    this.stopPing();
    this.clearRestart();
    this.teardownLink();
    for (const off of this.unsubs.splice(0)) off();
    this.sig.close();
    this.queue = [];
  }
}

// ---- room creation / joining ----------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function openSignaling(
  factory: SignalingFactory,
  init: SignalingInit,
  tuning: Tuning,
): Promise<Signaling> {
  let sig: Signaling;
  try {
    sig = factory(init);
  } catch (err) {
    throw new NetError(err instanceof Error ? err.message : 'Signaling unavailable', 'unreachable');
  }
  try {
    await withTimeout(sig.ready, tuning.readyTimeoutMs);
  } catch (err) {
    sig.close();
    console.warn('[net] signaling failed', err);
    throw new NetError('Could not reach the game server', 'unreachable');
  }
  return sig;
}

export async function createRoomWith(
  factory: SignalingFactory,
  opts: NetOptions,
  tuning: Tuning = DEFAULT_TUNING,
): Promise<Session> {
  const selfId = makePeerId();
  for (let attempt = 0; attempt < tuning.maxCodeAttempts; attempt++) {
    const code = generateRoomCode();
    const sig = await openSignaling(
      factory,
      { code, selfId, role: 'host', joinedAt: Date.now() },
      tuning,
    );
    // Someone is already in this room (another host, or a stale guest): pick another code.
    await sleep(tuning.hostProbeMs);
    if (sig.peers().length > 0) {
      sig.close();
      continue;
    }
    return new NetSession(sig, 'host', code, opts, tuning);
  }
  throw new NetError('Could not create a room, please try again', 'unreachable');
}

export async function joinRoomWith(
  factory: SignalingFactory,
  rawCode: string,
  opts: NetOptions,
  tuning: Tuning = DEFAULT_TUNING,
): Promise<Session> {
  const code = normalizeRoomCode(rawCode);
  if (!code) throw new NetError('Room codes are 4 letters or digits', 'invalid-code');
  const started = now();
  const sig = await openSignaling(
    factory,
    { code, selfId: makePeerId(), role: 'guest', joinedAt: Date.now() },
    tuning,
  );
  const session = new NetSession(sig, 'guest', code, opts, tuning);
  return session.waitForAdmission(Math.max(0, tuning.joinTimeoutMs - (now() - started)));
}

// Session logic over an in-memory signaling hub. Node has no WebRTC, so P2P paths use a small
// fake RTCPeerConnection; the real thing is covered by tests/e2e/net.spec.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BaseSignaling,
  type PeerInfo,
  type SignalingInit,
  type SignalMessage,
} from '../../src/net/signaling';
import {
  createRoomWith,
  DEFAULT_TUNING,
  joinRoomWith,
  NetError,
  type Tuning,
} from '../../src/net/session';
import type { Channel, NetMessage, NetOptions, Session, SessionStatus } from '../../src/net/types';

// ---------------------------------------------------------------------------
// In-memory signaling

class MemorySignaling extends BaseSignaling {
  readonly relayKind = 'relay' as const;
  phantom: PeerInfo | null = null;
  sent: SignalMessage[] = [];

  constructor(
    private readonly hub: MemoryHub,
    readonly info: SignalingInit,
  ) {
    super(info);
    hub.members.add(this);
    setTimeout(() => {
      if (this.closed) return;
      hub.refresh();
      this.markReady();
    }, 1);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  receive(msg: SignalMessage): void {
    this.deliver(msg);
  }

  updatePeers(list: PeerInfo[]): void {
    this.setPeers(this.phantom ? [...list, this.phantom] : list);
  }

  protected transmit(msg: SignalMessage): void {
    this.sent.push(msg);
    this.hub.route(this, msg);
  }

  protected shutdown(): void {
    this.hub.members.delete(this);
    this.hub.refresh();
  }
}

class MemoryHub {
  members = new Set<MemorySignaling>();
  created: MemorySignaling[] = [];
  /** The next N signalings see a phantom host already in their room. */
  occupyNext = 0;
  private cut = new Set<string>();
  /** "viewer>target": viewer's presence list omits target (messages still flow). */
  private blind = new Set<string>();

  factory = (init: SignalingInit): MemorySignaling => {
    const sig = new MemorySignaling(this, init);
    if (this.occupyNext > 0) {
      this.occupyNext--;
      sig.phantom = { id: 'phantom', role: 'host', joinedAt: 0 };
    }
    this.created.push(sig);
    return sig;
  };

  private canTalk(a: MemorySignaling, b: MemorySignaling): boolean {
    return a !== b && a.info.code === b.info.code && !this.cut.has(a.selfId) && !this.cut.has(b.selfId);
  }

  refresh(): void {
    for (const m of this.members) {
      const visible = [...this.members].filter(
        (o) => this.canTalk(m, o) && !this.blind.has(`${m.selfId}>${o.selfId}`),
      );
      m.updatePeers(visible.map((o) => ({ id: o.selfId, role: o.info.role, joinedAt: o.info.joinedAt })));
    }
  }

  route(from: MemorySignaling, msg: SignalMessage): void {
    const copy = JSON.parse(JSON.stringify(msg)) as SignalMessage;
    setTimeout(() => {
      for (const m of this.members) if (this.canTalk(from, m)) m.receive(copy);
    }, 1);
  }

  /** Cut a peer off the network (its presence disappears for everyone, both ways). */
  partition(id: string): void {
    this.cut.add(id);
    this.refresh();
  }

  heal(id: string): void {
    this.cut.delete(id);
    this.refresh();
  }

  /** One-sided presence glitch: `viewer` stops seeing `target`; nobody else notices. */
  setBlind(viewer: string, target: string, on: boolean): void {
    if (on) this.blind.add(`${viewer}>${target}`);
    else this.blind.delete(`${viewer}>${target}`);
    this.refresh();
  }
}

// ---------------------------------------------------------------------------
// Fake WebRTC (just enough for the session's use of it)

class FakeDataChannel {
  static maxMessageSize = 10_000;
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  peer: FakeDataChannel | null = null;

  constructor(
    readonly label: string,
    readonly init: RTCDataChannelInit,
  ) {}

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('InvalidStateError');
    if (data.length > FakeDataChannel.maxMessageSize) throw new Error('OperationError: too large');
    const peer = this.peer;
    setTimeout(() => {
      if (peer?.readyState === 'open') peer.onmessage?.({ data });
    }, 1);
  }

  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    setTimeout(() => this.onclose?.(), 0);
    const peer = this.peer;
    if (peer && peer.readyState !== 'closed') {
      setTimeout(() => {
        peer.readyState = 'closed';
        peer.onclose?.();
      }, 1);
    }
  }

  open(): void {
    this.readyState = 'open';
    this.onopen?.();
  }
}

type FakeMode = 'connect' | 'hang' | 'fail';

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static mode: FakeMode = 'connect';
  private static nextId = 1;

  readonly id = FakePeerConnection.nextId++;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  onicecandidate: ((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  channels: FakeDataChannel[] = [];
  candidates: RTCIceCandidateInit[] = [];
  closed = false;

  constructor(readonly config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  createDataChannel(label: string, init: RTCDataChannelInit): FakeDataChannel {
    const dc = new FakeDataChannel(label, init);
    this.channels.push(dc);
    return dc;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: `fake:${this.id}` };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: `fake:${this.id}` };
  }

  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d;
    setTimeout(() => {
      if (!this.closed) {
        this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `cand-${this.id}`, sdpMid: '0' }) } });
      }
    }, 0);
    this.tryConnect();
  }

  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = d;
    this.tryConnect();
  }

  async addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    this.candidates.push(c);
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
    for (const dc of this.channels) dc.close();
  }

  private tryConnect(): void {
    if (!this.localDescription || !this.remoteDescription) return;
    const other = FakePeerConnection.instances.find(
      (p) => `fake:${p.id}` === this.remoteDescription?.sdp,
    );
    if (!other || other.closed || !other.localDescription || !other.remoteDescription) return;
    if (FakePeerConnection.mode === 'hang') return;
    setTimeout(() => {
      if (this.closed || other.closed) return;
      if (FakePeerConnection.mode === 'fail') {
        for (const pc of [this, other]) {
          pc.connectionState = 'failed';
          pc.onconnectionstatechange?.();
        }
        return;
      }
      for (const dc of this.channels) {
        const twin = other.channels.find((c) => c.label === dc.label)!;
        dc.peer = twin;
        twin.peer = dc;
      }
      for (const pc of [this, other]) pc.connectionState = 'connected';
      for (const dc of [...this.channels, ...other.channels]) dc.open();
    }, 2);
  }
}

// ---------------------------------------------------------------------------
// Helpers

const TUNING: Tuning = {
  ...DEFAULT_TUNING,
  hostProbeMs: 20,
  joinTimeoutMs: 400,
  joinRetryMs: 40,
  readyTimeoutMs: 400,
  pingIntervalMs: 40,
  restartDelayMs: 40,
  maxCodeAttempts: 4,
};

const OPTS: NetOptions = { signaling: 'broadcast', p2pTimeoutMs: 300 };

let hub: MemoryHub;
const sessions: Session[] = [];

function track(s: Session): Session {
  sessions.push(s);
  return s;
}

async function host(opts: Partial<NetOptions> = {}): Promise<Session> {
  return track(await createRoomWith(hub.factory, { ...OPTS, ...opts }, TUNING));
}

async function guest(code: string, opts: Partial<NetOptions> = {}): Promise<Session> {
  return track(await joinRoomWith(hub.factory, code, { ...OPTS, ...opts }, TUNING));
}

async function waitFor(cond: () => boolean, timeoutMs = 2000, what = 'condition'): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const connected = (s: Session) => s.status.phase === 'connected';

function inbox(s: Session): { msg: NetMessage; ch: Channel }[] {
  const box: { msg: NetMessage; ch: Channel }[] = [];
  s.onMessage((msg, ch) => box.push({ msg, ch }));
  return box;
}

function statusLog(s: Session): SessionStatus[] {
  const log: SessionStatus[] = [];
  s.onStatus((st) => log.push(st));
  return log;
}

async function pair(opts: Partial<NetOptions> = {}, guestOpts = opts) {
  const h = await host(opts);
  const g = await guest(h.roomCode, guestOpts);
  await waitFor(() => connected(h) && connected(g), 2000, 'both connected');
  return { h, g };
}

afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
  vi.unstubAllGlobals();
  FakePeerConnection.instances = [];
  FakePeerConnection.mode = 'connect';
});

function freshHub(): void {
  hub = new MemoryHub();
}

// ---------------------------------------------------------------------------

describe('session over relay (no WebRTC available)', () => {
  it('host waits, guest joins with any casing, both connect over relay', async () => {
    freshHub();
    const h = await host();
    expect(h.role).toBe('host');
    expect(h.roomCode).toMatch(/^[A-Z2-9]{4}$/);
    expect(h.status.phase).toBe('waiting');
    expect(h.rttMs()).toBeNull();

    const g = await guest(` ${h.roomCode.toLowerCase()} `);
    expect(g.role).toBe('guest');
    expect(g.roomCode).toBe(h.roomCode);
    expect(g.selfId).not.toBe(h.selfId);

    await waitFor(() => connected(h) && connected(g));
    expect(h.status.transport).toBe('relay');
    expect(g.status.transport).toBe('relay');
  });

  it('delivers state and event messages both ways and measures rtt', async () => {
    freshHub();
    const { h, g } = await pair();
    const hBox = inbox(h);
    const gBox = inbox(g);

    h.send('state', { t: 'pos', x: 1 });
    h.send('event', { t: 'door', id: 7 });
    g.send('state', { t: 'pos', x: 2 });
    g.send('event', { t: 'chat', text: 'hi' });

    await waitFor(() => hBox.length === 2 && gBox.length === 2);
    expect(gBox).toEqual([
      { msg: { t: 'pos', x: 1 }, ch: 'state' },
      { msg: { t: 'door', id: 7 }, ch: 'event' },
    ]);
    expect(hBox).toEqual([
      { msg: { t: 'pos', x: 2 }, ch: 'state' },
      { msg: { t: 'chat', text: 'hi' }, ch: 'event' },
    ]);

    await waitFor(() => h.rttMs() !== null && g.rttMs() !== null);
    expect(h.rttMs()).toBeGreaterThanOrEqual(0);
    // Pings are internal: they never reach game listeners.
    expect([...hBox, ...gBox].every((e) => typeof e.msg.t === 'string' && e.msg.t !== 'ping')).toBe(true);
  });

  it('queues events and drops state while not connected', async () => {
    freshHub();
    const h = await host();
    h.send('state', { t: 'pos', x: 0 });
    for (let i = 0; i < 5; i++) h.send('event', { t: 'ev', i });

    const g = await guest(h.roomCode);
    const gBox = inbox(g);
    await waitFor(() => gBox.length === 5);
    await new Promise((r) => setTimeout(r, 30));
    expect(gBox.map((e) => e.msg)).toEqual([0, 1, 2, 3, 4].map((i) => ({ t: 'ev', i })));
    expect(gBox.every((e) => e.ch === 'event')).toBe(true);
  });

  it('send() throws on non-JSON input and snapshots queued messages', async () => {
    freshHub();
    const h = await host();
    const cyclic: Record<string, unknown> = { t: 'loop' };
    cyclic.self = cyclic;
    expect(() => h.send('event', cyclic as NetMessage)).toThrow();

    const msg = { t: 'ev', n: 1 };
    h.send('event', msg);
    msg.n = 2; // mutated after send: the queued copy must not change
    const g = await guest(h.roomCode);
    const box = inbox(g);
    await waitFor(() => box.length === 1);
    expect(box[0].msg).toEqual({ t: 'ev', n: 1 });
  });

  it('rejects a third player with "Room is full"', async () => {
    freshHub();
    const { h, g } = await pair();
    const err = await guest(h.roomCode).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetError);
    expect((err as NetError).message).toBe('Room is full');
    expect((err as NetError).code).toBe('room-full');
    // The rejected guest released its signaling; the pair is unaffected.
    expect(hub.created.at(-1)!.isClosed).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(connected(h) && connected(g)).toBe(true);
  });

  it('rejects an unknown room with "Room not found"', async () => {
    freshHub();
    const start = Date.now();
    const err = await guest('ZZZZ').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetError);
    expect((err as NetError).message).toBe('Room not found');
    expect(Date.now() - start).toBeGreaterThanOrEqual(TUNING.joinTimeoutMs - 20);
    expect(hub.created[0].isClosed).toBe(true);
  });

  it('rejects malformed codes immediately', async () => {
    freshHub();
    const err = await guest('no!').catch((e: unknown) => e);
    expect((err as NetError).code).toBe('invalid-code');
    expect(hub.created).toHaveLength(0);
  });

  it('host picks another code when the room is already occupied', async () => {
    freshHub();
    hub.occupyNext = 2;
    const h = await host();
    expect(hub.created).toHaveLength(3);
    expect(hub.created[0].isClosed && hub.created[1].isClosed).toBe(true);
    expect(h.roomCode).toBe(hub.created[2].info.code);
    expect(h.status.phase).toBe('waiting');
  });

  it('createRoom gives up if every code is taken', async () => {
    freshHub();
    hub.occupyNext = 100;
    await expect(createRoomWith(hub.factory, OPTS, TUNING)).rejects.toBeInstanceOf(NetError);
    expect(hub.created).toHaveLength(TUNING.maxCodeAttempts);
    expect(hub.created.every((s) => s.isClosed)).toBe(true);
  });

  it('goes disconnected when presence is lost and reconnects when the peer returns', async () => {
    freshHub();
    const { h, g } = await pair();
    const hLog = statusLog(h);
    const gLog = statusLog(g);

    hub.partition(g.selfId);
    await waitFor(() => h.status.phase === 'disconnected' && g.status.phase === 'disconnected');
    expect(h.status.detail).toBe('The other player left');

    // Events sent while disconnected are queued for the reconnect.
    h.send('event', { t: 'while-away' });
    hub.heal(g.selfId);
    const gBox = inbox(g);
    await waitFor(() => connected(h) && connected(g), 2000, 'reconnect');
    await waitFor(() => gBox.some((e) => e.msg.t === 'while-away'));
    expect(hLog.map((s) => s.phase)).toEqual(['disconnected', 'connecting', 'connected']);
    expect(gLog.map((s) => s.phase)).toEqual(['disconnected', 'connecting', 'connected']);
  });

  it('recovers when only the guest lost sight of the host (host still thinks it is connected)', async () => {
    freshHub();
    const { h, g } = await pair();
    const hLog = statusLog(h);
    hub.setBlind(g.selfId, h.selfId, true);
    await waitFor(() => g.status.phase === 'disconnected');
    expect(connected(h)).toBe(true); // the host noticed nothing
    hub.setBlind(g.selfId, h.selfId, false);
    // The guest's join carries the epoch it lost, so the host starts a fresh link.
    await waitFor(() => connected(g) && connected(h) && hLog.length >= 2, 2000, 'recovery');
    expect(hLog.map((s) => s.phase)).toEqual(['connecting', 'connected']);
    const box = inbox(g);
    h.send('event', { t: 'back' });
    await waitFor(() => box.length === 1);
  });

  it('when the guest leaves, the host is disconnected and a new guest can join', async () => {
    freshHub();
    const { h, g } = await pair();
    g.close();
    expect(g.status.phase).toBe('disconnected');
    await waitFor(() => h.status.phase === 'disconnected');
    expect(h.status.detail).toBe('The other player left');

    const g2 = await guest(h.roomCode);
    await waitFor(() => connected(h) && connected(g2));
    const box = inbox(g2);
    h.send('event', { t: 'hello-again' });
    await waitFor(() => box.length === 1);
  });

  it('when the host leaves, the guest is disconnected', async () => {
    freshHub();
    const { h, g } = await pair();
    h.close();
    await waitFor(() => g.status.phase === 'disconnected');
    expect(g.status.detail).toBe('The other player left');
  });

  it('close() releases signaling and silences callbacks', async () => {
    freshHub();
    const { h, g } = await pair();
    const hSig = hub.created[0];
    let calls = 0;
    h.onMessage(() => calls++);
    h.onStatus(() => calls++);
    h.close();
    h.close(); // idempotent
    expect(hSig.isClosed).toBe(true);
    expect(hub.members.has(hSig)).toBe(false);
    g.send('event', { t: 'x' });
    h.send('event', { t: 'y' });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toBe(0);
  });

  it('ignores signals addressed to someone else', async () => {
    freshHub();
    const { h, g } = await pair();
    const box = inbox(g);
    // A stray relayed message from the host but addressed to another peer id.
    const hSig = hub.created[0];
    hSig.send({ kind: 'msg', to: 'someone-else', ch: 'event', d: JSON.stringify({ t: 'stray' }) });
    hSig.send({ kind: 'full', to: 'someone-else' });
    h.send('event', { t: 'real' });
    await waitFor(() => box.length === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(box.map((e) => e.msg.t)).toEqual(['real']);
    expect(connected(g)).toBe(true);
  });
});

describe('session with (fake) WebRTC', () => {
  it('negotiates P2P with two negotiated data channels and trickle ICE', async () => {
    freshHub();
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    const { h, g } = await pair({ iceServers: [] });
    expect(h.status.transport).toBe('p2p');
    expect(g.status.transport).toBe('p2p');

    const [hostPc, guestPc] = FakePeerConnection.instances;
    expect(hostPc.config.iceServers).toEqual([]);
    expect(hostPc.channels.map((c) => [c.label, c.init])).toEqual([
      ['state', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 }],
      ['event', { negotiated: true, id: 1, ordered: true }],
    ]);
    // Candidates crossed over signaling.
    await waitFor(() => hostPc.candidates.length > 0 && guestPc.candidates.length > 0);

    const hBox = inbox(h);
    const gBox = inbox(g);
    h.send('state', { t: 'pos', x: 3 });
    g.send('event', { t: 'ability', id: 'dash' });
    await waitFor(() => hBox.length === 1 && gBox.length === 1);
    expect(gBox[0]).toEqual({ msg: { t: 'pos', x: 3 }, ch: 'state' });
    expect(hBox[0]).toEqual({ msg: { t: 'ability', id: 'dash' }, ch: 'event' });
    await waitFor(() => h.rttMs() !== null && g.rttMs() !== null);

    // Game messages went over the data channels, not signaling.
    const relayed = hub.created.flatMap((s) => s.sent).filter((m) => m.kind === 'msg');
    expect(relayed).toHaveLength(0);
  });

  it('a message the data channel refuses is dropped without blocking later ones', async () => {
    freshHub();
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { h, g } = await pair();
    const box = inbox(g);
    h.send('event', { t: 'huge', blob: 'x'.repeat(20_000) });
    h.send('event', { t: 'small' });
    await waitFor(() => box.length === 1);
    expect(box[0].msg.t).toBe('small');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('uses the default STUN server when iceServers is not given', async () => {
    freshHub();
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    await pair();
    expect(FakePeerConnection.instances[0].config.iceServers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
  });

  it('re-offers after the data channel breaks', async () => {
    freshHub();
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    const { h, g } = await pair();
    const hLog = statusLog(h);
    const gLog = statusLog(g);

    FakePeerConnection.instances[0].channels[1].close(); // the host's 'event' channel dies
    await waitFor(
      () => FakePeerConnection.instances.length >= 4 && connected(h) && connected(g),
      2000,
      're-offer',
    );
    expect(h.status.transport).toBe('p2p');
    expect(hLog.map((s) => s.phase)).toContain('disconnected');
    expect(gLog.map((s) => s.phase)).toContain('disconnected');

    const box = inbox(g);
    h.send('event', { t: 'after' });
    await waitFor(() => box.length === 1);
  });

  it('falls back to relay when P2P does not connect within p2pTimeoutMs', async () => {
    freshHub();
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    FakePeerConnection.mode = 'hang';
    const start = Date.now();
    const { h, g } = await pair({ p2pTimeoutMs: 150 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
    expect(h.status.transport).toBe('relay');
    expect(g.status.transport).toBe('relay');
    // The abandoned peer connections are closed.
    expect(FakePeerConnection.instances.every((pc) => pc.closed)).toBe(true);

    const box = inbox(h);
    g.send('event', { t: 'relayed' });
    await waitFor(() => box.length === 1);
  });

  it('falls back right away when ICE fails', async () => {
    freshHub();
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    FakePeerConnection.mode = 'fail';
    const start = Date.now();
    const { h, g } = await pair({ p2pTimeoutMs: 5000 });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(h.status.transport).toBe('relay');
    expect(g.status.transport).toBe('relay');
  });

  it('forceRelay on either side skips WebRTC for both', async () => {
    freshHub();
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
    const a = await pair({ forceRelay: true, p2pTimeoutMs: 5000 }, { p2pTimeoutMs: 5000 });
    expect(a.h.status.transport).toBe('relay');
    expect(a.g.status.transport).toBe('relay');
    expect(FakePeerConnection.instances).toHaveLength(0);

    freshHub();
    const start = Date.now();
    const b = await pair({ p2pTimeoutMs: 5000 }, { forceRelay: true, p2pTimeoutMs: 5000 });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(b.h.status.transport).toBe('relay');
    expect(b.g.status.transport).toBe('relay');
    expect(FakePeerConnection.instances.every((pc) => pc.closed)).toBe(true);
  });
});

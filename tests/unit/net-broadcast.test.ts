// BroadcastSignaling runs in Node too (Node has a global BroadcastChannel).
import { afterEach, describe, expect, it } from 'vitest';
import {
  BroadcastSignaling,
  roomChannelName,
  type PeerInfo,
  type SignalMessage,
} from '../../src/net/signaling';
import { createRoomWith, DEFAULT_TUNING, joinRoomWith, type Tuning } from '../../src/net/session';
import type { PeerRole, Session } from '../../src/net/types';

const TIMING = { heartbeatMs: 30, timeoutMs: 150 };
const open: { close(): void }[] = [];
let seq = 0;

function room(): string {
  // Unique per test so parallel/previous tests can't interfere.
  return `T${process.pid % 1000}${seq++}`;
}

function make(code: string, role: PeerRole, id: string): BroadcastSignaling {
  const s = new BroadcastSignaling({ code, selfId: id, role, joinedAt: Date.now() }, TIMING);
  open.push(s);
  return s;
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const ids = (peers: PeerInfo[]) => peers.map((p) => p.id);

afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

describe('BroadcastSignaling', () => {
  it('announces presence and discovers existing peers without waiting a heartbeat', async () => {
    const code = room();
    const a = make(code, 'host', 'a');
    await a.ready;
    const b = make(code, 'guest', 'b');
    const other = make(`${code}X`, 'guest', 'c'); // different room
    await waitFor(() => a.peers().length === 1 && b.peers().length === 1);
    expect(a.peers()[0]).toMatchObject({ id: 'b', role: 'guest' });
    expect(b.peers()[0]).toMatchObject({ id: 'a', role: 'host' });
    expect(other.peers()).toEqual([]);
  });

  it('delivers messages to everyone or to one addressee, never back to the sender', async () => {
    const code = room();
    const a = make(code, 'host', 'a');
    const b = make(code, 'guest', 'b');
    const c = make(code, 'guest', 'c');
    const got: Record<string, SignalMessage[]> = { a: [], b: [], c: [] };
    a.onMessage((m) => got.a.push(m));
    b.onMessage((m) => got.b.push(m));
    c.onMessage((m) => got.c.push(m));
    a.send({ kind: 'hello' });
    a.send({ kind: 'secret', to: 'b', n: 1 });
    await waitFor(() => got.b.length === 2 && got.c.length === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(got.a).toEqual([]);
    expect(got.b).toEqual([
      { kind: 'hello', from: 'a' },
      { kind: 'secret', to: 'b', n: 1, from: 'a' },
    ]);
    expect(got.c).toEqual([{ kind: 'hello', from: 'a' }]);
  });

  it('removes a peer on leave, and on heartbeat timeout', async () => {
    const code = room();
    const a = make(code, 'host', 'a');
    const b = make(code, 'guest', 'b');
    const changes: string[][] = [];
    a.onPresence((p) => changes.push(ids(p)));

    // A raw peer that announces itself once and then goes silent (crashed tab).
    const ghost = new BroadcastChannel(roomChannelName(code));
    ghost.postMessage({ hs: 1, type: 'hb', id: 'ghost', role: 'guest', joinedAt: Date.now() + 1000 });
    await waitFor(() => ids(a.peers()).join() === 'b,ghost');
    ghost.close();
    await waitFor(() => ids(a.peers()).join() === 'b', 1000);

    b.close();
    await waitFor(() => a.peers().length === 0, 100); // leave is immediate, not a timeout
    expect(changes.at(-1)).toEqual([]);
  });

  it('close() is idempotent and stops delivery', async () => {
    const code = room();
    const a = make(code, 'host', 'a');
    const b = make(code, 'guest', 'b');
    let n = 0;
    b.onMessage(() => n++);
    b.close();
    b.close();
    a.send({ kind: 'x' });
    await new Promise((r) => setTimeout(r, 30));
    expect(n).toBe(0);
    await expect(b.ready).resolves.toBeUndefined(); // was ready before close
  });
});

describe('session over BroadcastSignaling (Node, no WebRTC)', () => {
  const tuning: Tuning = { ...DEFAULT_TUNING, hostProbeMs: 50, joinTimeoutMs: 600, joinRetryMs: 50 };
  const factory = (init: ConstructorParameters<typeof BroadcastSignaling>[0]) =>
    new BroadcastSignaling(init, TIMING);
  const sessions: Session[] = [];
  afterEach(() => {
    for (const s of sessions.splice(0)) s.close();
  });

  it('connects with transport "local", exchanges messages, rejects a third player', async () => {
    const h = await createRoomWith(factory, { signaling: 'broadcast' }, tuning);
    sessions.push(h);
    const g = await joinRoomWith(factory, h.roomCode, { signaling: 'broadcast' }, tuning);
    sessions.push(g);
    await waitFor(() => h.status.phase === 'connected' && g.status.phase === 'connected');
    expect(h.status.transport).toBe('local');
    expect(g.status.transport).toBe('local');

    const got: unknown[] = [];
    g.onMessage((m, ch) => got.push([ch, m]));
    h.send('event', { t: 'hi', n: 1 });
    h.send('state', { t: 'pos', v: [1, 2, 3] });
    await waitFor(() => got.length === 2);
    expect(got).toEqual([
      ['event', { t: 'hi', n: 1 }],
      ['state', { t: 'pos', v: [1, 2, 3] }],
    ]);

    await expect(joinRoomWith(factory, h.roomCode, { signaling: 'broadcast' }, tuning)).rejects.toThrow(
      'Room is full',
    );
  });
});

import { Vector3, type Scene } from 'three';
import { NET_INTERP_DELAY_MS, NET_SEND_HZ } from '../config';
import type { Input } from '../engine/input';
import type { NetMessage, PeerRole, Session, SessionStatus } from '../net';
import { SnapshotBuffer } from './interp';
import { Avatar, LocalPlayer, type RoleId } from './player';
import type { World } from './world';

export const roleFor = (peer: PeerRole | 'solo'): RoleId => (peer === 'guest' ? 'tether' : 'vanguard');

interface Remote {
  avatar: Avatar;
  buffer: SnapshotBuffer;
  position: Vector3;
  yaw: number;
  speed: number;
  visible: boolean;
}

/** Snapshot of game state for the HUD and for automated tests (`window.__hs`). */
export interface GameDebugState {
  role: RoleId | null;
  phase: SessionStatus['phase'] | 'solo' | 'menu';
  transport: string | null;
  rttMs: number | null;
  local: { x: number; z: number } | null;
  remote: { x: number; z: number } | null;
  remoteSnapshots: number;
}

/** Owns the players and keeps the remote one in sync over a session. */
export class Game {
  local: LocalPlayer | null = null;
  remote: Remote | null = null;
  session: Session | null = null;
  private sendAccum = 0;
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly world: World,
    private readonly scene: Scene,
    private readonly input: Input,
  ) {}

  get localRole(): RoleId | null {
    return this.local?.avatar.role ?? null;
  }

  /** Spawn our own player. Called for solo practice and when a session starts. */
  spawnLocal(role: RoleId): LocalPlayer {
    if (this.local) this.scene.remove(this.local.avatar.root);
    const spawn = this.world.deck.spawnPoints[role === 'vanguard' ? 0 : 1];
    const avatar = new Avatar(role);
    this.local = new LocalPlayer(avatar, spawn);
    this.scene.add(avatar.root);
    this.local.update(this.input, 0, this.world.deck.colliders, this.world.deck.bounds);
    return this.local;
  }

  attachSession(session: Session): void {
    this.detachSession();
    this.session = session;
    this.spawnLocal(roleFor(session.role));
    const otherRole: RoleId = roleFor(session.role === 'host' ? 'guest' : 'host');
    this.unsubs.push(
      session.onMessage((msg) => this.onMessage(msg, otherRole)),
      session.onStatus((s) => {
        if (s.phase === 'disconnected' || s.phase === 'failed') this.hideRemote();
      }),
    );
  }

  detachSession(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.session?.close();
    this.session = null;
    if (this.remote) this.scene.remove(this.remote.avatar.root);
    this.remote = null;
  }

  update(dt: number, nowMs: number): void {
    if (this.local) {
      this.local.update(this.input, dt, this.world.deck.colliders, this.world.deck.bounds);
      this.sendState(dt, nowMs);
    }
    if (this.remote) {
      const s = this.remote.buffer.sample(nowMs, NET_INTERP_DELAY_MS);
      if (s) {
        this.remote.position.set(s.x, 0, s.z);
        this.remote.yaw = s.ry;
        this.remote.speed = s.speed;
      }
      this.remote.avatar.root.visible = this.remote.visible;
      this.remote.avatar.animate(this.remote.position, this.remote.yaw, this.remote.speed, dt);
    }
  }

  debugState(): GameDebugState {
    const status = this.session?.status;
    return {
      role: this.localRole,
      phase: status?.phase ?? (this.local ? 'solo' : 'menu'),
      transport: status?.transport ?? null,
      rttMs: this.session?.rttMs() ?? null,
      local: this.local ? { x: round(this.local.position.x), z: round(this.local.position.z) } : null,
      remote: this.remote?.visible ? { x: round(this.remote.position.x), z: round(this.remote.position.z) } : null,
      remoteSnapshots: this.remote?.buffer.size ?? 0,
    };
  }

  private sendState(dt: number, nowMs: number): void {
    if (!this.session || this.session.status.phase !== 'connected' || !this.local) return;
    this.sendAccum += dt;
    if (this.sendAccum < 1 / NET_SEND_HZ) return;
    this.sendAccum %= 1 / NET_SEND_HZ;
    const p = this.local;
    this.session.send('state', {
      t: 'pos',
      ts: Math.round(nowMs),
      x: round(p.position.x),
      z: round(p.position.z),
      ry: round(p.yaw),
      sp: round(p.speed),
    });
  }

  private onMessage(msg: NetMessage, otherRole: RoleId): void {
    if (msg.t !== 'pos') return;
    const { ts, x, z, ry, sp } = msg as NetMessage & Record<'ts' | 'x' | 'z' | 'ry' | 'sp', number>;
    if (![ts, x, z, ry, sp].every(Number.isFinite)) return;
    if (!this.remote) {
      const avatar = new Avatar(otherRole);
      this.scene.add(avatar.root);
      this.remote = { avatar, buffer: new SnapshotBuffer(), position: new Vector3(x, 0, z), yaw: ry, speed: 0, visible: true };
    }
    this.remote.visible = true;
    this.remote.buffer.push({ ts, x, z, ry, speed: sp }, performance.now());
  }

  private hideRemote(): void {
    if (!this.remote) return;
    this.remote.visible = false;
    this.remote.buffer.clear();
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

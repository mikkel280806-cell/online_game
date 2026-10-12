import { Vector3 } from 'three';
import { NET_INTERP_DELAY_MS, NET_SEND_HZ } from '../config';
import { Avatar } from '../characters';
import type { NetMessage, PeerRole, Session, SessionStatus } from '../net';
import { Bot } from './bot';
import { Mission, STATIONS, type Actor } from './mission';
import { SnapshotBuffer } from './interp';
import { LocalPlayer, type Ground, type PlayerControl } from './player';
import type { RoleId } from './roles';
import type { World } from './world';

export const roleFor = (peer: PeerRole | 'solo'): RoleId => (peer === 'guest' ? 'tether' : 'vanguard');
const otherRole = (r: RoleId): RoleId => (r === 'vanguard' ? 'tether' : 'vanguard');

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
  local: { x: number; z: number; speed: number } | null;
  remote: { x: number; z: number } | null;
  remoteSnapshots: number;
  bot: { x: number; z: number; state: string } | null;
  mission: { step: number; progress: number; done: boolean };
}

/** Owns the players (local, remote partner or bot) and keeps the remote one in sync. */
export class Game {
  local: LocalPlayer | null = null;
  remote: Remote | null = null;
  bot: Bot | null = null;
  session: Session | null = null;
  readonly mission = new Mission();
  private localAct = false;
  private remoteAct = false;
  private sendAccum = 0;
  private unsubs: (() => void)[] = [];
  private readonly ground: Ground;

  constructor(private readonly world: World) {
    this.ground = { colliders: world.colliders, bounds: world.bounds, heightAt: world.heightAt };
  }

  get localRole(): RoleId | null {
    return this.local?.avatar.role ?? null;
  }

  /** Spawn our own player. Called for solo play and when a session starts. */
  spawnLocal(role: RoleId): LocalPlayer {
    if (this.local) this.world.scene.remove(this.local.avatar.root);
    const spawn = this.world.spawnPoints[role === 'vanguard' ? 0 : 1];
    const avatar = new Avatar(role);
    this.local = new LocalPlayer(avatar, spawn);
    this.world.add(avatar.root);
    this.local.update({ x: 0, z: 0, sprint: false }, 0, this.ground);
    return this.local;
  }

  /** Add an AI partner playing the other role (solo play). */
  spawnBot(): void {
    if (this.bot || !this.local) return;
    const role = otherRole(this.local.avatar.role);
    const avatar = new Avatar(role);
    const spawn = this.world.spawnPoints[role === 'vanguard' ? 0 : 1];
    this.bot = new Bot(new LocalPlayer(avatar, spawn));
    this.world.add(avatar.root);
  }

  removeBot(): void {
    if (!this.bot) return;
    this.world.scene.remove(this.bot.player.avatar.root);
    this.bot = null;
  }

  attachSession(session: Session): void {
    this.detachSession();
    this.removeBot();
    this.session = session;
    const mine = roleFor(session.role);
    this.spawnLocal(mine);
    this.unsubs.push(
      session.onMessage((msg) => this.onMessage(msg, otherRole(mine))),
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
    if (this.remote) this.world.scene.remove(this.remote.avatar.root);
    this.remote = null;
  }

  /** Move the local player (tests and debugging). */
  teleport(x: number, z: number): void {
    this.local?.teleport(x, z, this.ground);
  }

  /** The host (or a solo player) owns the mission; a guest shows the host's state. */
  get authority(): boolean {
    return !this.session || this.session.role === 'host';
  }

  update(dt: number, nowMs: number, control: PlayerControl): void {
    if (this.local) {
      this.localAct = !!control.act;
      this.local.update(control, dt, this.ground);
      this.sendState(dt, nowMs);
      if (this.bot) {
        const st = this.mission.botStation(this.bot.player.avatar.role, this.local.position);
        this.bot.task = st ? STATIONS[st] : null;
        this.bot.update(dt, this.local, this.ground);
      }
      if (this.authority) this.mission.update(dt, this.actors());
    }
  }

  /** Pose every avatar for the rendered frame (see LocalPlayer.present). */
  present(alpha: number, frameDt: number, nowMs: number): void {
    this.local?.present(alpha, frameDt);
    this.bot?.player.present(alpha, frameDt);
    if (this.remote) {
      // Sampled at the frame's own time, so the partner glides instead of stepping.
      const s = this.remote.buffer.sample(nowMs, NET_INTERP_DELAY_MS);
      if (s) {
        this.remote.position.set(s.x, this.world.heightAt(s.x, s.z), s.z);
        this.remote.yaw = s.ry;
        this.remote.speed = s.speed;
      }
      this.remote.avatar.root.visible = this.remote.visible;
      this.remote.avatar.animate(this.remote.position, this.remote.yaw, this.remote.speed, frameDt);
    }
  }

  private actors(): Actor[] {
    const list: Actor[] = [];
    const add = (role: RoleId, p: Vector3, act: boolean) => list.push({ role, x: p.x, z: p.z, act });
    if (this.local) add(this.local.avatar.role, this.local.position, this.localAct);
    if (this.bot) add(this.bot.player.avatar.role, this.bot.player.position, this.bot.holding);
    if (this.remote?.visible) add(this.remote.avatar.role, this.remote.position, this.remoteAct);
    return list;
  }

  /** The partner, whether a person or the bot. */
  partner(): { role: RoleId; position: Vector3; isBot: boolean } | null {
    if (this.remote?.visible) return { role: this.remote.avatar.role, position: this.remote.position, isBot: false };
    if (this.bot) return { role: this.bot.player.avatar.role, position: this.bot.player.display, isBot: true };
    return null;
  }

  debugState(): GameDebugState {
    const status = this.session?.status;
    return {
      role: this.localRole,
      phase: status?.phase ?? (this.local ? 'solo' : 'menu'),
      transport: status?.transport ?? null,
      rttMs: this.session?.rttMs() ?? null,
      local: this.local ? { x: round(this.local.position.x), z: round(this.local.position.z), speed: round(this.local.speed) } : null,
      remote: this.remote?.visible ? { x: round(this.remote.position.x), z: round(this.remote.position.z) } : null,
      remoteSnapshots: this.remote?.buffer.size ?? 0,
      bot: this.bot ? { x: round(this.bot.player.position.x), z: round(this.bot.player.position.z), state: this.bot.state } : null,
      mission: { step: this.mission.step, progress: round(this.mission.progress), done: this.mission.done },
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
      act: this.localAct ? 1 : 0,
      // The host's mission state rides along; a lost packet is replaced 50 ms later.
      ...(this.authority ? { ms: this.mission.step, mp: round(this.mission.progress) } : {}),
    });
  }

  private onMessage(msg: NetMessage, role: RoleId): void {
    if (msg.t !== 'pos') return;
    const { ts, x, z, ry, sp } = msg as NetMessage & Record<'ts' | 'x' | 'z' | 'ry' | 'sp', number>;
    if (![ts, x, z, ry, sp].every(Number.isFinite)) return;
    if (!this.remote) {
      const avatar = new Avatar(role);
      this.world.add(avatar.root);
      this.remote = {
        avatar,
        buffer: new SnapshotBuffer(),
        position: new Vector3(x, this.world.heightAt(x, z), z),
        yaw: ry,
        speed: 0,
        visible: true,
      };
    }
    this.remote.visible = true;
    this.remoteAct = msg.act === 1;
    if (!this.authority && typeof msg.ms === 'number' && typeof msg.mp === 'number') this.mission.apply(msg.ms, msg.mp);
    this.remote.buffer.push({ ts, x, z, ry, speed: sp }, performance.now());
  }

  private hideRemote(): void {
    if (!this.remote) return;
    this.remote.visible = false;
    this.remote.buffer.clear();
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

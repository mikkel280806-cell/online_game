import { Vector3 } from 'three';
import { NET_INTERP_DELAY_MS, NET_SEND_HZ } from '../config';
import { Avatar } from '../characters';
import type { NetMessage, PeerRole, Session, SessionStatus } from '../net';
import { Bot } from './bot';
import { Combat, type CombatFx, type Fighter } from './combat';
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
  combat: { active: boolean; won: boolean; killed: number; drones: number; hp: number | null; downed: boolean };
}

/** Owns the players (local, remote partner or bot) and keeps the remote one in sync. */
export class Game {
  local: LocalPlayer | null = null;
  remote: Remote | null = null;
  bot: Bot | null = null;
  session: Session | null = null;
  readonly mission = new Mission();
  readonly combat: Combat;
  /** Combat effects to draw this frame (made here or replayed from the host). */
  readonly fxOut: CombatFx[] = [];
  private localAct = false;
  private localBlock = false;
  private remoteAct = false;
  private remoteBlock = false;
  private sendAccum = 0;
  private unsubs: (() => void)[] = [];
  private readonly ground: Ground;

  constructor(private readonly world: World) {
    this.ground = { colliders: world.colliders, bounds: world.bounds, heightAt: world.heightAt };
    this.combat = new Combat(world.heightAt, world.colliders, undefined, world.spawnPoints[0]);
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
    if (!this.local) return;
    const me = this.local;
    const myV = this.combat.vitals[me.avatar.role];
    me.downed = myV.downed;
    this.localAct = !!control.act;
    this.localBlock = !!control.hold && me.avatar.role === 'vanguard' && !myV.downed;
    // Shield up: no sprinting, slow walk.
    const ctl = this.localBlock ? { ...control, sprint: false, x: control.x * 0.45, z: control.z * 0.45 } : control;
    me.update(ctl, dt, this.ground);
    if (control.attack) this.action('atk', this.fighterOf(me, this.localAct, this.localBlock));
    if (control.skill) this.action('skl', this.fighterOf(me, this.localAct, this.localBlock));
    this.sendState(dt, nowMs);
    if (this.bot) this.updateBot(dt, me);
    if (!this.authority) {
      this.combat.advanceBolts(dt);
      return;
    }
    this.mission.update(dt, this.actors());
    if (this.mission.done) this.combat.start();
    this.combat.update(dt, this.fighters());
    if (this.combat.takeRespawn()) this.respawn();
    const fx = this.combat.drain();
    if (fx.length) {
      this.fxOut.push(...fx);
      if (this.session?.status.phase === 'connected') this.session.send('event', { t: 'fx', l: fx });
    }
  }

  /** Attack or skill: done here by the host, asked of the host by a guest. */
  private action(kind: 'atk' | 'skl', f: Fighter): void {
    if (this.combat.vitals[f.role].downed) return;
    if (!this.authority) {
      if (this.session?.status.phase === 'connected') this.session.send('event', { t: kind });
      return;
    }
    if (kind === 'atk') this.combat.attack(f);
    else this.combat.skill(f);
  }

  private fighterOf(p: LocalPlayer, act: boolean, blocking: boolean): Fighter {
    return { role: p.avatar.role, x: p.position.x, z: p.position.z, yaw: p.yaw, act, blocking };
  }

  private fighters(): Fighter[] {
    const list: Fighter[] = [];
    if (this.local) list.push(this.fighterOf(this.local, this.localAct, this.localBlock));
    if (this.bot) list.push(this.fighterOf(this.bot.player, this.bot.holding, false));
    const r = this.remote;
    if (r?.visible) list.push({ role: r.avatar.role, x: r.position.x, z: r.position.z, yaw: r.yaw, act: this.remoteAct, blocking: this.remoteBlock });
    return list;
  }

  private updateBot(dt: number, me: LocalPlayer): void {
    const bot = this.bot!;
    const role = bot.player.avatar.role;
    const v = this.combat.vitals[role];
    bot.player.downed = v.downed;
    // Reviving the human comes first, then the mission.
    const st = this.mission.botStation(role, me.position);
    bot.task = me.downed ? { x: me.position.x, z: me.position.z } : st ? STATIONS[st] : null;
    bot.update(dt, me, this.ground);
    if (!this.combat.active || v.downed || !this.authority) return;
    // Fight: face the nearest drone in reach and use the role's attack (cooldowns pace it).
    const f = this.fighterOf(bot.player, bot.holding, false);
    let near = 0;
    let target: { x: number; z: number } | null = null;
    let td = Infinity;
    for (const d of this.combat.drones) {
      const l = Math.hypot(d.x - f.x, d.z - f.z);
      if (l < 7) near++;
      if (l < td) {
        td = l;
        target = d;
      }
    }
    if (!target || td > (role === 'tether' ? 20 : 2.8)) return;
    f.yaw = Math.atan2(target.x - f.x, target.z - f.z);
    this.combat.attack(f);
    if (role === 'tether' && near >= 2) this.combat.skill(f);
  }

  /** Everyone went down: regroup at the pad. */
  private respawn(): void {
    const [a, b] = this.world.spawnPoints;
    this.local?.teleport(a.x, a.z, this.ground);
    this.bot?.player.teleport(b.x, b.z, this.ground);
    if (this.session?.status.phase === 'connected') this.session.send('event', { t: 'respawn' });
  }


  /** Pose every avatar for the rendered frame (see LocalPlayer.present). */
  present(alpha: number, frameDt: number, nowMs: number): void {
    if (this.local) this.local.downed = this.combat.vitals[this.local.avatar.role].downed;
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
      layDown(this.remote.avatar.root, this.combat.vitals[this.remote.avatar.role].downed);
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

  /** The Vanguard's shield, if a human Vanguard is holding it up. */
  shield(): { pos: Vector3; yaw: number; blocking: boolean } | null {
    if (this.local?.avatar.role === 'vanguard') return { pos: this.local.display, yaw: this.local.yaw, blocking: this.localBlock };
    const r = this.remote;
    if (r?.visible && r.avatar.role === 'vanguard') return { pos: r.position, yaw: r.yaw, blocking: this.remoteBlock };
    return null;
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
      combat: {
        active: this.combat.active,
        won: this.combat.won,
        killed: this.combat.killed,
        drones: this.combat.drones.length,
        hp: this.local ? Math.round(this.combat.vitals[this.local.avatar.role].hp) : null,
        downed: this.local ? this.combat.vitals[this.local.avatar.role].downed : false,
      },
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
      blk: this.localBlock ? 1 : 0,
      ...(this.authority && this.mission.done ? { cb: this.combat.snapshot() } : {}),
      // The host's mission state rides along; a lost packet is replaced 50 ms later.
      ...(this.authority ? { ms: this.mission.step, mp: round(this.mission.progress) } : {}),
    });
  }

  private onMessage(msg: NetMessage, role: RoleId): void {
    if (msg.t === 'atk' || msg.t === 'skl') {
      // The guest asked to attack: do it from where the host sees them.
      const r = this.remote;
      if (!this.authority || !r) return;
      this.action(msg.t, { role: r.avatar.role, x: r.position.x, z: r.position.z, yaw: r.yaw, act: this.remoteAct, blocking: this.remoteBlock });
      return;
    }
    if (msg.t === 'fx' && !this.authority && Array.isArray(msg.l)) {
      for (const f of msg.l as CombatFx[]) {
        if (!f || typeof f !== 'object') continue;
        if (f.k === 'bolt' && [f.x, f.y, f.z, f.vx, f.vy, f.vz].every(Number.isFinite)) this.combat.addBolt(f);
        this.fxOut.push(f);
      }
      return;
    }
    if (msg.t === 'respawn' && !this.authority && this.local) {
      const p = this.world.spawnPoints[1];
      this.local.teleport(p.x, p.z, this.ground);
      return;
    }
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
    this.remoteBlock = msg.blk === 1;
    if (!this.authority && msg.cb && typeof msg.cb === 'object') this.combat.applySnapshot(msg.cb as Record<string, unknown>);
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

/** Downed crew lie on their side. */
function layDown(root: { rotation: { z: number }; position: { y: number } }, downed: boolean): void {
  root.rotation.z = downed ? 1.35 : 0;
  if (downed) root.position.y += 0.3;
}

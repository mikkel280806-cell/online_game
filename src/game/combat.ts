import type { Collider } from './collision';
import type { RoleId } from './roles';

// Combat after the beacon wakes the Meridian: hostile maintenance drones in waves. Pure logic,
// run by the host (or the solo player); the guest draws the host's state. Both roles have a
// primary attack (R) and a skill (C); a downed player is revived by a partner holding F.

export const PLAYER_HP = 100;
export const DRONE_HP = 4;
const WAVES = [3, 3, 3];
const BOLT_SPEED = 13;
const BOLT_DAMAGE = 18;
const STRIKE = { range: 2.8, arc: Math.PI * 0.6, damage: 2, cooldown: 0.55 };
const SHOT = { range: 26, cone: 0.7, damage: 1, cooldown: 0.32 };
const PULSE = { radius: 9, stun: 2.5, damage: 1, cooldown: 7 };
const REVIVE_REACH = 2.4;
const REVIVE_TIME = 2.5;
/** Seconds without damage before health regenerates. */
const REGEN_DELAY = 5;

export interface Drone {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  stun: number;
  cooldown: number;
  phase: number;
}

export interface Bolt {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

export interface Vitals {
  hp: number;
  downed: boolean;
  /** Revive progress 0..1 while a partner holds F. */
  revive: number;
  sinceHurt: number;
  attackCd: number;
  skillCd: number;
}

export interface Fighter {
  role: RoleId;
  x: number;
  z: number;
  yaw: number;
  /** Holding F (revive). */
  act: boolean;
  /** Vanguard holding the shield up. */
  blocking: boolean;
}

/** Something to draw or broadcast: the guest replays these. */
export type CombatFx =
  | { k: 'strike'; role: RoleId; x: number; z: number; yaw: number }
  | { k: 'shot'; role: RoleId; x: number; z: number; tx: number; ty: number; tz: number }
  | { k: 'pulse'; role: RoleId; x: number; z: number }
  | { k: 'bolt'; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { k: 'hit'; x: number; y: number; z: number }
  | { k: 'block'; x: number; y: number; z: number }
  | { k: 'boom'; x: number; y: number; z: number }
  | { k: 'hurt'; role: RoleId };

const newVitals = (): Vitals => ({ hp: PLAYER_HP, downed: false, revive: 0, sinceHurt: 99, attackCd: 0, skillCd: 0 });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function insideCollider(x: number, z: number, colliders: readonly Collider[]): boolean {
  for (const c of colliders) {
    if (c.kind === 'circle' ? Math.hypot(x - c.x, z - c.z) < c.r : x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
  }
  return false;
}

export class Combat {
  active = false;
  won = false;
  killed = 0;
  drones: Drone[] = [];
  bolts: Bolt[] = [];
  readonly vitals: Record<RoleId, Vitals> = { vanguard: newVitals(), tether: newVitals() };
  /** Effects since the last drain(). */
  private fx: CombatFx[] = [];
  private wave = 0;
  private nextId = 1;
  private allDownFor = 0;
  private seed = 7;

  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    private readonly colliders: readonly Collider[] = [],
    /** Where waves come from (the wreck's direction) and where the downed respawn. */
    private readonly spawnFrom: { x: number; z: number } = { x: -6, z: -48 },
    private readonly respawnAt: { x: number; z: number } = { x: 6, z: 16 },
  ) {}

  get total(): number {
    return WAVES.reduce((a, b) => a + b, 0);
  }

  get objective(): string | null {
    if (this.won) return 'Drones down. The signal came from the Meridian: head for the wreck.';
    if (this.active) return `Hostile drones from the wreck. Destroy them (${this.killed}/${this.total})`;
    return null;
  }

  start(): void {
    if (this.active || this.won) return;
    this.active = true;
    this.spawnWave();
  }

  drain(): CombatFx[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private spawnWave(): void {
    const n = WAVES[this.wave++];
    for (let i = 0; i < n; i++) {
      const x = this.spawnFrom.x + (i - (n - 1) / 2) * 7 + (this.rand() - 0.5) * 3;
      const z = this.spawnFrom.z + (this.rand() - 0.5) * 6;
      this.drones.push({ id: this.nextId++, x, y: this.heightAt(x, z) + 6, z, vx: 0, vz: 0, hp: DRONE_HP, stun: 0, cooldown: 2 + this.rand() * 1.5, phase: this.rand() * 6 });
    }
  }

  /** Primary attack: Vanguard strikes in front, Tether fires at the drone it faces. */
  attack(f: Fighter): void {
    const v = this.vitals[f.role];
    if (v.downed || v.attackCd > 0) return;
    if (f.role === 'vanguard') {
      v.attackCd = STRIKE.cooldown;
      this.fx.push({ k: 'strike', role: f.role, x: f.x, z: f.z, yaw: f.yaw });
      for (const d of this.drones) {
        const dx = d.x - f.x;
        const dz = d.z - f.z;
        const dy = d.y - this.heightAt(f.x, f.z);
        if (Math.hypot(dx, dz) > STRIKE.range || dy > 3.2) continue;
        if (Math.abs(wrap(Math.atan2(dx, dz) - f.yaw)) > STRIKE.arc / 2) continue;
        // Knock it back and down into reach of the next swing.
        const l = Math.hypot(dx, dz) || 1;
        d.vx += (dx / l) * 6;
        d.vz += (dz / l) * 6;
        d.y = Math.max(this.heightAt(d.x, d.z) + 1.4, d.y - 0.8);
        this.damage(d, STRIKE.damage);
      }
    } else {
      v.attackCd = SHOT.cooldown;
      const target = this.aim(f);
      const gy = this.heightAt(f.x, f.z);
      if (target) {
        this.fx.push({ k: 'shot', role: f.role, x: f.x, z: f.z, tx: target.x, ty: target.y, tz: target.z });
        this.damage(target, SHOT.damage);
      } else {
        this.fx.push({ k: 'shot', role: f.role, x: f.x, z: f.z, tx: f.x + Math.sin(f.yaw) * SHOT.range, ty: gy + 1.4, tz: f.z + Math.cos(f.yaw) * SHOT.range });
      }
    }
  }

  /** Tether's gravity pulse (the Vanguard's skill, the shield, is held: see Fighter.blocking). */
  skill(f: Fighter): void {
    const v = this.vitals[f.role];
    if (f.role !== 'tether' || v.downed || v.skillCd > 0) return;
    v.skillCd = PULSE.cooldown;
    this.fx.push({ k: 'pulse', role: f.role, x: f.x, z: f.z });
    for (const d of this.drones) {
      const dx = f.x - d.x;
      const dz = f.z - d.z;
      const l = Math.hypot(dx, dz);
      if (l > PULSE.radius) continue;
      d.stun = PULSE.stun;
      // Pulled in and dragged down: within the Vanguard's reach.
      d.vx += (dx / (l || 1)) * 7;
      d.vz += (dz / (l || 1)) * 7;
      this.damage(d, PULSE.damage);
    }
  }

  /** Nearest live drone in front of the fighter (within the cone), else nearest in range. */
  aim(f: Fighter): Drone | null {
    let best: Drone | null = null;
    let bestScore = Infinity;
    for (const d of this.drones) {
      const dx = d.x - f.x;
      const dz = d.z - f.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SHOT.range) continue;
      const off = Math.abs(wrap(Math.atan2(dx, dz) - f.yaw));
      const score = dist + (off > SHOT.cone ? 40 : off * 6);
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  private damage(d: Drone, n: number): void {
    d.hp -= n;
    this.fx.push({ k: 'hit', x: d.x, y: d.y, z: d.z });
    if (d.hp > 0) return;
    this.fx.push({ k: 'boom', x: d.x, y: d.y, z: d.z });
    this.drones = this.drones.filter((o) => o !== d);
    this.killed++;
  }

  update(dt: number, fighters: readonly Fighter[]): void {
    for (const f of fighters) {
      const v = this.vitals[f.role];
      v.attackCd = Math.max(0, v.attackCd - dt);
      v.skillCd = Math.max(0, v.skillCd - dt);
      v.sinceHurt += dt;
      if (!v.downed && v.sinceHurt > REGEN_DELAY) v.hp = Math.min(PLAYER_HP, v.hp + 10 * dt);
    }
    this.updateRevives(dt, fighters);
    if (!this.active) return;

    const alive = fighters.filter((f) => !this.vitals[f.role].downed);
    for (const d of this.drones) this.updateDrone(d, dt, alive);
    this.separate();
    this.updateBolts(dt, fighters);

    if (this.drones.length <= 1 && this.wave < WAVES.length) this.spawnWave();
    if (this.drones.length === 0 && this.wave >= WAVES.length) {
      this.active = false;
      this.won = true;
      this.bolts = [];
    }
  }

  private updateDrone(d: Drone, dt: number, targets: readonly Fighter[]): void {
    d.phase += dt;
    d.stun = Math.max(0, d.stun - dt);
    let target: Fighter | null = null;
    let td = Infinity;
    for (const f of targets) {
      const l = Math.hypot(f.x - d.x, f.z - d.z);
      if (l < td) {
        td = l;
        target = f;
      }
    }
    const ground = this.heightAt(d.x, d.z);
    // Stunned drones sag toward the ground; otherwise hover and bob.
    const hover = ground + (d.stun > 0 ? 1.3 : 2.6 + Math.sin(d.phase * 1.7) * 0.25);
    d.y += (hover - d.y) * Math.min(1, dt * 2.5);
    let ax = 0;
    let az = 0;
    if (target && d.stun <= 0) {
      const dx = target.x - d.x;
      const dz = target.z - d.z;
      const l = td || 1;
      // Hold a firing distance and circle the target.
      const want = 8;
      const radial = Math.max(-1, Math.min(1, (l - want) / 4));
      const side = Math.sin(d.phase * 0.4 + d.id) > 0 ? 1 : -1;
      ax = (dx / l) * radial * 9 + (-dz / l) * side * 3;
      az = (dz / l) * radial * 9 + (dx / l) * side * 3;
      d.cooldown -= dt;
      if (d.cooldown <= 0 && l < 20) {
        d.cooldown = 2.2 + this.rand() * 1.2;
        const ty = this.heightAt(target.x, target.z) + 1.2;
        const dist = Math.hypot(dx, ty - d.y, dz) || 1;
        const b = { x: d.x, y: d.y, z: d.z, vx: (dx / dist) * BOLT_SPEED, vy: ((ty - d.y) / dist) * BOLT_SPEED, vz: (dz / dist) * BOLT_SPEED, life: 3 };
        this.bolts.push(b);
        this.fx.push({ k: 'bolt', x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });
      }
    }
    // Damped motion, max 4 m/s of its own drive.
    d.vx += ax * dt;
    d.vz += az * dt;
    const drag = Math.exp(-2.2 * dt);
    d.vx *= drag;
    d.vz *= drag;
    const sp = Math.hypot(d.vx, d.vz);
    if (sp > 7) {
      d.vx *= 7 / sp;
      d.vz *= 7 / sp;
    }
    d.x += d.vx * dt;
    d.z += d.vz * dt;
  }

  private separate(): void {
    const ds = this.drones;
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const dx = ds[j].x - ds[i].x;
        const dz = ds[j].z - ds[i].z;
        const l = Math.hypot(dx, dz);
        if (l > 2.2 || l < 1e-4) continue;
        const push = (2.2 - l) / 2 / l;
        ds[i].x -= dx * push;
        ds[i].z -= dz * push;
        ds[j].x += dx * push;
        ds[j].z += dz * push;
      }
    }
  }

  private updateBolts(dt: number, fighters: readonly Fighter[]): void {
    const keep: Bolt[] = [];
    for (const b of this.bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.life -= dt;
      if (b.life <= 0 || b.y < this.heightAt(b.x, b.z) || insideCollider(b.x, b.z, this.colliders)) continue;
      let gone = false;
      for (const f of fighters) {
        const v = this.vitals[f.role];
        if (v.downed) continue;
        const gy = this.heightAt(f.x, f.z);
        if (Math.hypot(b.x - f.x, b.z - f.z) > 0.6 || b.y < gy || b.y > gy + 2.1) continue;
        gone = true;
        // The shield stops bolts coming from in front.
        const from = Math.atan2(-b.vx, -b.vz);
        if (f.blocking && f.role === 'vanguard' && Math.abs(wrap(from - f.yaw)) < 1.25) {
          this.fx.push({ k: 'block', x: b.x, y: b.y, z: b.z });
          break;
        }
        v.hp -= BOLT_DAMAGE;
        v.sinceHurt = 0;
        this.fx.push({ k: 'hurt', role: f.role });
        if (v.hp <= 0) {
          v.hp = 0;
          v.downed = true;
          v.revive = 0;
        }
        break;
      }
      if (!gone) keep.push(b);
    }
    this.bolts = keep;
  }

  private updateRevives(dt: number, fighters: readonly Fighter[]): void {
    for (const f of fighters) {
      const v = this.vitals[f.role];
      if (!v.downed) continue;
      const helper = fighters.some((o) => o !== f && o.act && !this.vitals[o.role].downed && Math.hypot(o.x - f.x, o.z - f.z) <= REVIVE_REACH);
      v.revive = helper ? v.revive + dt / REVIVE_TIME : Math.max(0, v.revive - dt);
      if (v.revive >= 1) {
        v.downed = false;
        v.revive = 0;
        v.hp = PLAYER_HP / 2;
        v.sinceHurt = 0;
      }
    }
    // Everyone down: regroup at the pad after a moment.
    const allDown = fighters.length > 0 && fighters.every((f) => this.vitals[f.role].downed);
    this.allDownFor = allDown ? this.allDownFor + dt : 0;
  }

  /** True once when everyone has been down long enough to respawn; resets their vitals. */
  takeRespawn(): { x: number; z: number } | null {
    if (this.allDownFor < 3) return null;
    this.allDownFor = 0;
    for (const v of Object.values(this.vitals)) Object.assign(v, newVitals());
    this.bolts = [];
    return this.respawnAt;
  }

  /** Revive prompt for a player standing at (x, z), if a downed partner is in reach. */
  revivePrompt(role: RoleId, x: number, z: number, partner: { role: RoleId; x: number; z: number } | null): { text: string; progress: number } | null {
    if (!partner || this.vitals[role].downed) return null;
    const v = this.vitals[partner.role];
    if (!v.downed || Math.hypot(partner.x - x, partner.z - z) > REVIVE_REACH) return null;
    return { text: `Revive the ${partner.role === 'vanguard' ? 'Vanguard' : 'Tether'}`, progress: v.revive };
  }

  // ---- network snapshot (host -> guest) ---------------------------------------------------

  snapshot(): Record<string, unknown> {
    const r = (n: number) => Math.round(n * 100) / 100;
    const vit = (v: Vitals) => [Math.round(v.hp), v.downed ? 1 : 0, r(v.revive), r(v.attackCd), r(v.skillCd)];
    return {
      a: this.active ? 1 : 0,
      w: this.won ? 1 : 0,
      k: this.killed,
      d: this.drones.map((d) => [d.id, r(d.x), r(d.y), r(d.z), d.hp, d.stun > 0 ? 1 : 0]),
      v: [vit(this.vitals.vanguard), vit(this.vitals.tether)],
    };
  }

  applySnapshot(s: Record<string, unknown>): void {
    if (!s || typeof s !== 'object') return;
    this.active = s.a === 1;
    this.won = s.w === 1;
    if (typeof s.k === 'number') this.killed = s.k;
    if (Array.isArray(s.d)) {
      this.drones = (s.d as number[][])
        .filter((a) => Array.isArray(a) && a.length >= 6 && a.every(Number.isFinite))
        .map(([id, x, y, z, hp, stun]) => {
          const prev = this.drones.find((o) => o.id === id);
          return { id, x, y, z, vx: 0, vz: 0, hp, stun: stun ? 1 : 0, cooldown: 0, phase: prev?.phase ?? 0 };
        });
    }
    if (Array.isArray(s.v) && s.v.length === 2) {
      (['vanguard', 'tether'] as const).forEach((role, i) => {
        const a = (s.v as number[][])[i];
        if (!Array.isArray(a) || a.length < 5 || !a.every(Number.isFinite)) return;
        const v = this.vitals[role];
        v.hp = a[0];
        v.downed = a[1] === 1;
        v.revive = a[2];
        v.attackCd = a[3];
        v.skillCd = a[4];
      });
    }
  }

  /** Guest: add a bolt the host fired, for drawing only. */
  addBolt(b: Omit<Bolt, 'life'>): void {
    this.bolts.push({ ...b, life: 3 });
  }

  /** Guest: move the drawn bolts (no hits; the host decides those). */
  advanceBolts(dt: number): void {
    for (const b of this.bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.life -= dt;
    }
    this.bolts = this.bolts.filter((b) => b.life > 0 && b.y > this.heightAt(b.x, b.z) && !insideCollider(b.x, b.z, this.colliders));
  }
}

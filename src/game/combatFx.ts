import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import type { HeightFn } from '../env/types';
import type { Combat, CombatFx } from './combat';
import type { RoleId } from './roles';

const glow = (r: number, g: number, b: number, opacity = 1) =>
  new MeshBasicMaterial({ color: new Color(r, g, b), transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });

const SPHERE = new SphereGeometry(1, 16, 12);
const BOLT_GEO = new SphereGeometry(0.11, 10, 8);
const BOLT_MAT = new MeshBasicMaterial({ color: new Color(5, 1.4, 0.35) });

interface Transient {
  obj: Object3D;
  age: number;
  life: number;
  tick(t: number): void;
}

/** Draws drones, bolts, attack effects and the Vanguard's shield from the combat state. */
export class CombatView {
  private drones = new Map<number, { g: Group; eye: MeshBasicMaterial; flash: number; stunned: boolean }>();
  private droneTemplate: Group;
  private eyeColor = new Color(3.2, 0.35, 0.2);
  private bolts: Mesh[] = [];
  private transients: Transient[] = [];
  private shield: Mesh;
  /** Red screen flash when the local player is hurt (read by the HUD). */
  hurt = 0;

  constructor(
    private readonly scene: Scene,
    private readonly heightAt: HeightFn,
    /** Registers lit meshes with the shadow cascades. */
    private readonly addLit: (o: Object3D) => void,
  ) {
    // Maintenance drone: gunmetal sphere, a sensor band, one red eye, three stub fins.
    const body = new MeshStandardMaterial({ color: '#3b3f45', metalness: 0.85, roughness: 0.32 });
    const band = new MeshStandardMaterial({ color: '#c9a24a', metalness: 0.7, roughness: 0.4 });
    const g = new Group();
    const shell = new Mesh(SPHERE, body);
    shell.scale.setScalar(0.38);
    shell.castShadow = true;
    const ring = new Mesh(new TorusGeometry(0.4, 0.045, 8, 32), band);
    ring.rotation.x = Math.PI / 2;
    g.add(shell, ring);
    for (let i = 0; i < 3; i++) {
      const fin = new Mesh(new BoxGeometry(0.05, 0.22, 0.3), body);
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      fin.position.set(Math.cos(a) * 0.36, -0.18, Math.sin(a) * 0.36);
      fin.rotation.y = -a;
      g.add(fin);
    }
    this.droneTemplate = g;

    this.shield = new Mesh(new SphereGeometry(1.15, 24, 12, -0.9, 1.8, 0.55, 1.45), glow(0.25, 0.75, 1.2, 0.28));
    this.shield.visible = false;
    scene.add(this.shield);
  }

  private makeDrone(): { g: Group; eye: MeshBasicMaterial } {
    const g = this.droneTemplate.clone();
    const eye = new MeshBasicMaterial({ color: this.eyeColor.clone() });
    const e = new Mesh(SPHERE, eye);
    e.scale.setScalar(0.11);
    e.position.set(0, 0.02, 0.34);
    g.add(e);
    this.scene.add(g);
    this.addLit(g);
    return { g, eye };
  }

  /** Replay effects from the combat log (local or from the host). */
  play(list: readonly CombatFx[], myRole: RoleId | null): void {
    for (const f of list) {
      switch (f.k) {
        case 'strike':
          this.strike(f.x, f.z, f.yaw);
          break;
        case 'shot':
          this.tracer(new Vector3(f.x, this.heightAt(f.x, f.z) + 1.35, f.z), new Vector3(f.tx, f.ty, f.tz));
          break;
        case 'pulse':
          this.ring(f.x, f.z, 9, glow(0.3, 0.9, 1.6, 0.7), 0.55);
          break;
        case 'hit': {
          let best: { flash: number } | null = null;
          let bd = 1.5;
          for (const d of this.drones.values()) {
            const l = d.g.position.distanceTo(new Vector3(f.x, f.y, f.z));
            if (l < bd) {
              bd = l;
              best = d;
            }
          }
          if (best) best.flash = 0.12;
          this.burst(f.x, f.y, f.z, 0.35, glow(2.5, 2, 1.4, 0.9), 0.15);
          break;
        }
        case 'block':
          this.burst(f.x, f.y, f.z, 0.5, glow(0.4, 1.2, 2, 0.9), 0.2);
          break;
        case 'boom':
          this.burst(f.x, f.y, f.z, 1.6, glow(3, 1.1, 0.3, 0.9), 0.45);
          this.burst(f.x, f.y, f.z, 0.8, glow(4, 3, 2, 1), 0.18);
          break;
        case 'hurt':
          if (f.role === myRole) this.hurt = 1;
          break;
        case 'bolt':
          break; // drawn from the bolt list
      }
    }
  }

  update(dt: number, combat: Combat, vanguard: { pos: Vector3; yaw: number; blocking: boolean } | null, focus: Vector3 | null): void {
    this.hurt = Math.max(0, this.hurt - dt * 2.5);
    // Drones: create, move (smoothed: the guest gets 20 Hz snapshots), face the nearest player.
    const seen = new Set<number>();
    for (const d of combat.drones) {
      seen.add(d.id);
      let v = this.drones.get(d.id);
      if (!v) {
        v = { ...this.makeDrone(), flash: 0, stunned: false };
        v.g.position.set(d.x, d.y, d.z);
        this.drones.set(d.id, v);
      }
      const k = 1 - Math.exp(-14 * dt);
      v.g.position.x += (d.x - v.g.position.x) * k;
      v.g.position.y += (d.y - v.g.position.y) * k;
      v.g.position.z += (d.z - v.g.position.z) * k;
      if (focus) v.g.rotation.y = Math.atan2(focus.x - v.g.position.x, focus.z - v.g.position.z);
      v.stunned = d.stun > 0;
      v.g.rotation.z = v.stunned ? Math.sin(performance.now() * 0.02) * 0.4 : 0;
      v.flash = Math.max(0, v.flash - dt);
      if (v.flash > 0) v.eye.color.setRGB(6, 6, 6);
      else if (v.stunned) v.eye.color.setRGB(0.3, 0.9, 1.6);
      else v.eye.color.copy(this.eyeColor);
    }
    for (const [id, v] of this.drones) {
      if (seen.has(id)) continue;
      this.scene.remove(v.g);
      v.eye.dispose();
      this.drones.delete(id);
    }

    // Bolts: a pool of glowing pellets stretched along their flight.
    while (this.bolts.length < combat.bolts.length) {
      const m = new Mesh(BOLT_GEO, BOLT_MAT);
      this.scene.add(m);
      this.bolts.push(m);
    }
    this.bolts.forEach((m, i) => {
      const b = combat.bolts[i];
      m.visible = !!b;
      if (!b) return;
      m.position.set(b.x, b.y, b.z);
      m.lookAt(b.x + b.vx, b.y + b.vy, b.z + b.vz);
      m.scale.set(1, 1, 3.2);
    });

    // Shield in front of the Vanguard while held.
    this.shield.visible = !!vanguard?.blocking;
    if (vanguard?.blocking) {
      this.shield.position.set(vanguard.pos.x, vanguard.pos.y + 1.0, vanguard.pos.z);
      this.shield.rotation.y = vanguard.yaw;
      (this.shield.material as MeshBasicMaterial).opacity = 0.22 + 0.06 * Math.sin(performance.now() * 0.012);
    }

    this.transients = this.transients.filter((t) => {
      t.age += dt;
      if (t.age >= t.life) {
        const m = t.obj as Mesh;
        this.scene.remove(m);
        (m.material as MeshBasicMaterial).dispose();
        if (m.geometry !== SPHERE) m.geometry.dispose();
        return false;
      }
      t.tick(t.age / t.life);
      return true;
    });
  }

  private add(obj: Mesh, life: number, tick: (t: number) => void): void {
    this.scene.add(obj);
    this.transients.push({ obj, age: 0, life, tick });
    tick(0);
  }

  private strike(x: number, z: number, yaw: number): void {
    const arc = Math.PI * 0.6;
    const mat = glow(2.2, 1.3, 0.45, 0.85);
    const m = new Mesh(new RingGeometry(0.9, 2.7, 24, 1, -arc / 2, arc), mat);
    m.rotation.set(-Math.PI / 2, 0, yaw - Math.PI / 2);
    m.position.set(x, this.heightAt(x, z) + 1.0, z);
    this.add(m, 0.2, (t) => {
      mat.opacity = 0.85 * (1 - t);
      m.scale.setScalar(0.85 + 0.25 * t);
    });
  }

  private tracer(from: Vector3, to: Vector3): void {
    const mat = glow(0.5, 1.6, 2.6, 0.9);
    const len = from.distanceTo(to);
    const m = new Mesh(new CylinderGeometry(0.035, 0.035, len, 6, 1, true), mat);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    m.rotateX(Math.PI / 2);
    this.add(m, 0.12, (t) => (mat.opacity = 0.9 * (1 - t)));
    this.burst(to.x, to.y, to.z, 0.3, glow(0.6, 1.8, 2.8, 0.9), 0.12);
  }

  private ring(x: number, z: number, radius: number, mat: MeshBasicMaterial, life: number): void {
    const m = new Mesh(new RingGeometry(0.85, 1, 48), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, this.heightAt(x, z) + 0.15, z);
    this.add(m, life, (t) => {
      m.scale.setScalar(0.5 + radius * t);
      mat.opacity = 0.75 * (1 - t);
    });
  }

  private burst(x: number, y: number, z: number, size: number, mat: MeshBasicMaterial, life: number): void {
    const m = new Mesh(SPHERE, mat);
    m.position.set(x, y, z);
    const base = mat.opacity;
    this.add(m, life, (t) => {
      m.scale.setScalar(size * (0.4 + t));
      mat.opacity = base * (1 - t);
    });
  }
}

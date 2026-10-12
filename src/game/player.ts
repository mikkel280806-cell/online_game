import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { damp } from '../engine/camera';
import type { Input } from '../engine/input';
import { lerpAngle } from './interp';
import { resolve, type Bounds, type Collider } from './collision';

export type RoleId = 'vanguard' | 'tether';

export const ROLES: Record<RoleId, { name: string; color: Color; css: string }> = {
  vanguard: { name: 'Vanguard', color: new Color(2.6, 1.05, 0.25), css: '#ffae5c' },
  tether: { name: 'Tether', color: new Color(0.3, 1.5, 2.6), css: '#6fe3ff' },
};

const RADIUS = 0.4;
const WALK = 5.2;
const SPRINT = 8.4;
const ACCEL = 38;
const FRICTION = 12;

/** Visual model of a crew member in a suit. Animation is driven by `speed`. */
export class Avatar {
  readonly root = new Group();
  private body = new Group();
  private phase = 0;

  constructor(readonly role: RoleId) {
    const accent = ROLES[role].color;
    const suit = new MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.15, roughness: 0.48 });
    const dark = new MeshStandardMaterial({ color: 0x262a31, metalness: 0.6, roughness: 0.4 });
    const glow = new MeshBasicMaterial({ color: accent, toneMapped: false });
    const visorMat = new MeshStandardMaterial({
      color: 0x05070a,
      metalness: 1,
      roughness: 0.08,
      emissive: accent.clone().multiplyScalar(0.25),
    });

    const torso = new Mesh(new CapsuleGeometry(0.3, 0.55, 6, 16), suit);
    torso.position.y = 0.95;
    const belt = new Mesh(new TorusGeometry(0.31, 0.035, 8, 32), glow);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.78;
    const helmet = new Mesh(new SphereGeometry(0.27, 24, 16), suit);
    helmet.position.y = 1.58;
    const visor = new Mesh(new SphereGeometry(0.22, 24, 16, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.36), visorMat);
    visor.position.set(0, 1.58, 0.07);
    const pack = new Mesh(new BoxGeometry(0.46, 0.55, 0.22), dark);
    pack.position.set(0, 1.05, -0.3);
    const packLights = new Mesh(new BoxGeometry(0.3, 0.04, 0.02), glow);
    packLights.position.set(0, 1.2, -0.42);
    const legs = new Mesh(new CylinderGeometry(0.2, 0.14, 0.5, 12), dark);
    legs.position.y = 0.32;
    const boots = new Mesh(new CylinderGeometry(0.16, 0.18, 0.1, 12), dark);
    boots.position.y = 0.05;

    this.body.add(torso, belt, helmet, visor, pack, packLights, legs, boots);
    this.body.traverse((o) => {
      if (o instanceof Mesh && o.material !== glow) o.castShadow = true;
    });
    this.root.add(this.body);
  }

  /** Set pose for this frame. `speed` in m/s drives the walk cycle. */
  animate(position: Vector3, yaw: number, speed: number, dt: number): void {
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
    const moving = Math.min(speed / WALK, 1.6);
    this.phase += dt * (4 + speed * 1.6);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.07 * moving;
    this.body.rotation.x = damp(this.body.rotation.x, moving * 0.12, 10, dt);
    this.body.rotation.z = Math.sin(this.phase) * 0.04 * moving;
  }
}

/** The player this browser controls. */
export class LocalPlayer {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;

  constructor(
    readonly avatar: Avatar,
    spawn: Vector3,
  ) {
    this.position.copy(spawn);
    this.yaw = Math.PI; // face the camera
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(input: Input, dt: number, colliders: Collider[], bounds: Bounds): void {
    const axis = input.moveAxis();
    let ix = axis.x;
    let iz = -axis.y; // screen-up is world -Z
    const len = Math.hypot(ix, iz);
    const max = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? SPRINT : WALK;
    if (len > 0) {
      ix /= len;
      iz /= len;
      this.velocity.x += ix * ACCEL * dt;
      this.velocity.z += iz * ACCEL * dt;
      const sp = this.speed;
      if (sp > max) this.velocity.multiplyScalar(max / sp);
    } else {
      const k = Math.exp(-FRICTION * dt);
      this.velocity.x *= k;
      this.velocity.z *= k;
    }
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    const r = resolve(nx, nz, RADIUS, colliders, bounds);
    // Lose the velocity that went into walls so we slide instead of sticking.
    if (dt > 0) {
      this.velocity.x = (r.x - this.position.x) / dt;
      this.velocity.z = (r.z - this.position.z) / dt;
    }
    this.position.x = r.x;
    this.position.z = r.z;
    if (this.speed > 0.3) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this.yaw = lerpAngle(this.yaw, target, 1 - Math.exp(-14 * dt));
    }
    this.avatar.animate(this.position, this.yaw, this.speed, dt);
  }
}

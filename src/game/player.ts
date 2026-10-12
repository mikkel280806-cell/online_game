import { Vector3 } from 'three';
import { Avatar } from '../characters';
import type { Input } from '../engine/input';
import { lerpAngle } from './interp';
import { resolve, type Bounds, type Collider } from './collision';

export { Avatar };
export { ROLES, type RoleId } from './roles';

const RADIUS = 0.4;
const WALK = 5.2;
const SPRINT = 8.4;
const ACCEL = 38;
const FRICTION = 12;

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

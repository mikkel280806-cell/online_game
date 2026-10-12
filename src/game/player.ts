import { Vector3 } from 'three';
import { Avatar } from '../characters';
import type { HeightFn } from '../env/types';
import { lerpAngle } from './interp';
import { resolve, type Bounds, type Collider } from './collision';

export { Avatar };
export { ROLES, type RoleId } from './roles';

const RADIUS = 0.4;
const WALK = 5.2;
const SPRINT = 8.4;
const ACCEL = 38;
const FRICTION = 12;

/** What a player wants to do this step, in world space. Used by humans and by the bot. */
export interface PlayerControl {
  /** Desired direction on the ground (x, z); length 0..1. */
  x: number;
  z: number;
  sprint: boolean;
}

export const NO_CONTROL: PlayerControl = { x: 0, z: 0, sprint: false };

/** Everything a walking character needs to know about the world. */
export interface Ground {
  colliders: Collider[];
  bounds: Bounds;
  heightAt: HeightFn;
}

/** A walking crew member: the local human player, or the bot. */
export class LocalPlayer {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;
  /** Where the avatar is drawn: between the last two simulation steps. */
  readonly display = new Vector3();
  private readonly prev = new Vector3();
  private prevYaw = 0;

  constructor(
    readonly avatar: Avatar,
    spawn: Vector3,
  ) {
    this.position.copy(spawn);
    this.yaw = Math.PI; // face the camera
    this.prev.copy(spawn);
    this.display.copy(spawn);
    this.prevYaw = this.yaw;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(control: PlayerControl, dt: number, ground: Ground): void {
    this.prev.copy(this.position);
    this.prevYaw = this.yaw;
    let ix = control.x;
    let iz = control.z;
    const len = Math.hypot(ix, iz);
    const max = (control.sprint ? SPRINT : WALK) * Math.min(1, len);
    if (len > 0.01) {
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
    const r = resolve(nx, nz, RADIUS, ground.colliders, ground.bounds);
    // Lose the velocity that went into walls so we slide instead of sticking.
    if (dt > 0) {
      this.velocity.x = (r.x - this.position.x) / dt;
      this.velocity.z = (r.z - this.position.z) / dt;
    }
    this.position.set(r.x, ground.heightAt(r.x, r.z), r.z);
    if (this.speed > 0.3) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this.yaw = lerpAngle(this.yaw, target, 1 - Math.exp(-14 * dt));
    }
  }

  /**
   * Pose the avatar for this rendered frame. The simulation runs in fixed steps, so the frame
   * falls between two of them: draw at that point (`alpha`) and animate with the frame's own dt,
   * otherwise the character moves in uneven jumps whenever the frame and step rates drift.
   */
  present(alpha: number, frameDt: number): void {
    // A teleport (spawn, respawn) must not be smeared across a frame.
    if (this.prev.distanceToSquared(this.position) > 25) this.prev.copy(this.position);
    this.display.lerpVectors(this.prev, this.position, alpha);
    const yaw = lerpAngle(this.prevYaw, this.yaw, alpha);
    this.avatar.animate(this.display, yaw, this.speed, frameDt);
  }
}

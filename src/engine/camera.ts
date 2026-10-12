import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

const tmp = new Vector3();

/**
 * Angled 3/4 follow camera: sits above and behind the focus point at a fixed yaw,
 * so screen-up is always world -Z. Follows with critically damped smoothing.
 */
export class FollowCamera {
  readonly camera: PerspectiveCamera;
  /** Offset from the focus point. */
  offset = new Vector3(0, 13, 11);
  /** Higher = snappier follow. */
  stiffness = 5;
  private focus = new Vector3();
  private goal = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(38, aspect, 0.1, 3000);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the target without smoothing. */
  snapTo(target: Vector3): void {
    this.goal.copy(target);
    this.focus.copy(target);
    this.apply();
  }

  follow(target: Vector3, dt: number): void {
    this.goal.copy(target);
    const k = 1 - Math.exp(-this.stiffness * dt);
    this.focus.lerp(this.goal, k);
    this.apply();
  }

  /** Slow cinematic orbit used behind the title screen. */
  orbit(center: Vector3, radius: number, height: number, angle: number): void {
    this.camera.position.set(center.x + Math.sin(angle) * radius, center.y + height, center.z + Math.cos(angle) * radius);
    this.camera.lookAt(center);
  }

  private apply(): void {
    this.camera.position.copy(this.focus).add(this.offset);
    tmp.copy(this.focus).setY(this.focus.y + 0.8);
    this.camera.lookAt(tmp);
  }
}

export const damp = (current: number, target: number, lambda: number, dt: number) =>
  MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

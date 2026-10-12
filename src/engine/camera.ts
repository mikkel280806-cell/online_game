import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Input } from './input';

export const damp = (current: number, target: number, lambda: number, dt: number) =>
  MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Shortest-path damping for angles. */
const dampAngle = (current: number, target: number, lambda: number, dt: number) => {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-lambda * dt));
};

export type CameraMode = 'follow' | 'free';

const MIN_PITCH = 0.05;
const MAX_PITCH = 1.35;
const MIN_DIST = 4;
const MAX_DIST = 45;

const tmp = new Vector3();
const look = new Vector3();

/**
 * Third-person camera that orbits the player (drag / two-finger swipe / Q-E to turn,
 * scroll or pinch to zoom) plus a free-flying camera (C to toggle) for looking around.
 * Keeps itself above the ground.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'follow';
  /** Ground height lookup so the camera never dips under the terrain. */
  groundAt: (x: number, z: number) => number = () => 0;

  // Follow camera: yaw 0 = behind the player looking north (-Z).
  private yaw = 0;
  private pitch = 0.5;
  private distance = 13;
  private goalYaw = 0;
  private goalPitch = 0.5;
  private goalDistance = 13;
  private focus = new Vector3();
  private hasFocus = false;

  // Free camera.
  private freeYaw = 0;
  private freePitch = 0;
  private freeVel = new Vector3();

  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(42, aspect, 0.25, 16000);
  }

  /** Listen for mouse and trackpad input on the canvas. */
  attach(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      this.dragging = false;
      el.releasePointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.rotate(-dx * 0.0055, dy * 0.0045);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey) {
          // Trackpad pinch.
          this.zoom(Math.exp(e.deltaY * 0.012));
        } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          // Two-finger horizontal swipe turns the camera.
          this.rotate(-e.deltaX * 0.004, 0);
        } else {
          this.zoom(Math.exp(e.deltaY * 0.0015));
        }
      },
      { passive: false },
    );
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Camera heading, for camera-relative movement. 0 = looking north (-Z). */
  get viewYaw(): number {
    return this.mode === 'free' ? this.freeYaw : this.yaw;
  }

  toggleFree(): CameraMode {
    if (this.mode === 'follow') {
      this.camera.getWorldDirection(tmp);
      this.freeYaw = Math.atan2(-tmp.x, -tmp.z);
      this.freePitch = Math.asin(MathUtils.clamp(tmp.y, -1, 1));
      this.freeVel.set(0, 0, 0);
      this.mode = 'free';
    } else {
      this.mode = 'follow';
    }
    return this.mode;
  }

  /** Jump straight to following `target` without smoothing. */
  snapTo(target: Vector3): void {
    this.focus.copy(target);
    this.hasFocus = true;
    this.yaw = this.goalYaw;
    this.pitch = this.goalPitch;
    this.distance = this.goalDistance;
    this.applyFollow();
  }

  /** Set the follow camera's angles directly (used by scripted shots). */
  setView(yaw: number, pitch: number, distance: number): void {
    this.goalYaw = this.yaw = yaw;
    this.goalPitch = this.pitch = MathUtils.clamp(pitch, MIN_PITCH, MAX_PITCH);
    this.goalDistance = this.distance = MathUtils.clamp(distance, MIN_DIST, MAX_DIST);
  }

  update(dt: number, target: Vector3 | null, input: Input): void {
    if (this.mode === 'free') {
      this.updateFree(dt, input);
      return;
    }
    if (input.isDown('KeyQ')) this.goalYaw += 1.8 * dt;
    if (input.isDown('KeyE')) this.goalYaw -= 1.8 * dt;
    this.yaw = dampAngle(this.yaw, this.goalYaw, 12, dt);
    this.pitch = damp(this.pitch, this.goalPitch, 12, dt);
    this.distance = damp(this.distance, this.goalDistance, 10, dt);
    if (target) {
      if (!this.hasFocus) this.focus.copy(target);
      this.hasFocus = true;
      this.focus.x = damp(this.focus.x, target.x, 9, dt);
      this.focus.y = damp(this.focus.y, target.y, 6, dt);
      this.focus.z = damp(this.focus.z, target.z, 9, dt);
    }
    this.applyFollow();
  }

  /** Slow cinematic orbit used behind the title screen. */
  orbit(center: Vector3, radius: number, height: number, angle: number, lookHeight = 2): void {
    this.camera.position.set(center.x + Math.sin(angle) * radius, 0, center.z + Math.cos(angle) * radius);
    this.camera.position.y = Math.max(center.y + height, this.groundAt(this.camera.position.x, this.camera.position.z) + 1.5);
    this.camera.lookAt(look.set(center.x, center.y + lookHeight, center.z));
  }

  private rotate(dYaw: number, dPitch: number): void {
    if (this.mode === 'free') {
      this.freeYaw += dYaw;
      this.freePitch = MathUtils.clamp(this.freePitch - dPitch, -1.45, 1.45);
    } else {
      this.goalYaw += dYaw;
      this.goalPitch = MathUtils.clamp(this.goalPitch + dPitch, MIN_PITCH, MAX_PITCH);
    }
  }

  private zoom(factor: number): void {
    if (this.mode === 'follow') this.goalDistance = MathUtils.clamp(this.goalDistance * factor, MIN_DIST, MAX_DIST);
  }

  private applyFollow(): void {
    const cp = Math.cos(this.pitch);
    const c = this.camera.position;
    c.set(
      this.focus.x + Math.sin(this.yaw) * cp * this.distance,
      this.focus.y + Math.sin(this.pitch) * this.distance + 1.2,
      this.focus.z + Math.cos(this.yaw) * cp * this.distance,
    );
    c.y = Math.max(c.y, this.groundAt(c.x, c.z) + 1.2);
    this.camera.lookAt(look.set(this.focus.x, this.focus.y + 1.3, this.focus.z));
  }

  private updateFree(dt: number, input: Input): void {
    const fast = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const speed = fast ? 70 : 14;
    const axis = input.moveAxis();
    const up = (input.isDown('Space') ? 1 : 0) - (input.isDown('ControlLeft') || input.isDown('KeyZ') ? 1 : 0);
    const cy = Math.cos(this.freeYaw);
    const sy = Math.sin(this.freeYaw);
    const cp = Math.cos(this.freePitch);
    const sp = Math.sin(this.freePitch);
    // Forward follows the view (including pitch); strafing stays level.
    tmp.set(-sy * cp * axis.y + cy * axis.x, sp * axis.y + up, -cy * cp * axis.y - sy * axis.x);
    if (tmp.lengthSq() > 1) tmp.normalize();
    tmp.multiplyScalar(speed);
    this.freeVel.lerp(tmp, 1 - Math.exp(-6 * dt));
    const c = this.camera.position;
    c.addScaledVector(this.freeVel, dt);
    c.y = Math.max(c.y, this.groundAt(c.x, c.z) + 0.6);
    look.set(c.x - sy * cp, c.y + sp, c.z - cy * cp);
    this.camera.lookAt(look);
  }
}

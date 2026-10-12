import { InstancedMesh, MathUtils, Mesh, PerspectiveCamera, Raycaster, SkinnedMesh, Vector3, type Object3D } from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
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

const MIN_PITCH = 0.05;
const MAX_PITCH = 1.35;
const MIN_DIST = 4;
const MAX_DIST = 45;

const look = new Vector3();
const dir = new Vector3();
const ray = new Raycaster();
(ray as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
/** Keep this far in front of whatever blocks the view (m). */
const CLEARANCE = 0.4;

/**
 * Third-person camera that orbits the player: drag / two-finger swipe / Q-E to turn,
 * scroll or pinch to zoom. Keeps itself above the ground.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  /** Ground height lookup so the camera never dips under the terrain. */
  groundAt: (x: number, z: number) => number = () => 0;
  private obstacles: Mesh[] = [];

  // Follow camera: yaw 0 = behind the player looking north (-Z).
  private yaw = 0;
  private pitch = 0.5;
  private distance = 13;
  private goalYaw = 0;
  private goalPitch = 0.5;
  private goalDistance = 13;
  /** Distance the camera may currently use: snaps in when blocked, eases back out. */
  private clipDistance = Infinity;
  private focus = new Vector3();
  private hasFocus = false;

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

  /**
   * Solid scenery the camera must stay in front of: it pulls in instead of looking through walls.
   * Builds a bounding-volume tree per mesh once, so a ray costs microseconds, not a scan of
   * every triangle of the merged buildings.
   */
  setObstacles(roots: Object3D[]): void {
    this.obstacles = [];
    for (const root of roots) {
      root.traverse((o) => {
        if (!(o instanceof Mesh) || o instanceof InstancedMesh || o instanceof SkinnedMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        // See-through effects (light cones, glows) don't block the view.
        if (m?.transparent || !o.geometry.attributes.position) return;
        o.geometry.boundsTree ??= new MeshBVH(o.geometry);
        o.raycast = acceleratedRaycast;
        this.obstacles.push(o);
      });
    }
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Camera heading, for camera-relative movement. 0 = looking north (-Z). */
  get viewYaw(): number {
    return this.yaw;
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
    this.applyFollow(dt);
  }

  /** Slow cinematic orbit used behind the title screen. */
  orbit(center: Vector3, radius: number, height: number, angle: number, lookHeight = 2): void {
    this.camera.position.set(center.x + Math.sin(angle) * radius, 0, center.z + Math.cos(angle) * radius);
    this.camera.position.y = Math.max(center.y + height, this.groundAt(this.camera.position.x, this.camera.position.z) + 1.5);
    this.camera.lookAt(look.set(center.x, center.y + lookHeight, center.z));
  }

  private rotate(dYaw: number, dPitch: number): void {
    this.goalYaw += dYaw;
    this.goalPitch = MathUtils.clamp(this.goalPitch + dPitch, MIN_PITCH, MAX_PITCH);
  }

  private zoom(factor: number): void {
    this.goalDistance = MathUtils.clamp(this.goalDistance * factor, MIN_DIST, MAX_DIST);
  }

  private applyFollow(dt = 0): void {
    const cp = Math.cos(this.pitch);
    const c = this.camera.position;
    c.set(
      this.focus.x + Math.sin(this.yaw) * cp * this.distance,
      this.focus.y + Math.sin(this.pitch) * this.distance + 1.2,
      this.focus.z + Math.cos(this.yaw) * cp * this.distance,
    );
    c.y = Math.max(c.y, this.groundAt(c.x, c.z) + 1.2);
    look.set(this.focus.x, this.focus.y + 1.3, this.focus.z);
    this.avoidObstacles(c, dt);
    this.camera.lookAt(look);
  }

  /** Pull the camera in along the view line when a wall, hull or crate is in the way. */
  private avoidObstacles(c: Vector3, dt: number): void {
    if (this.obstacles.length === 0) return;
    dir.subVectors(c, look);
    const full = dir.length();
    if (full < 1e-3) return;
    dir.divideScalar(full);
    ray.set(look, dir);
    ray.far = full + CLEARANCE;
    const hit = ray.intersectObjects(this.obstacles, false)[0];
    const allowed = hit ? Math.max(0.6, hit.distance - CLEARANCE) : full;
    // Snap in at once (never show the inside of a wall); ease back out when it clears.
    this.clipDistance = allowed < this.clipDistance || dt === 0 ? allowed : damp(this.clipDistance, allowed, 3, dt);
    if (this.clipDistance < full) c.copy(look).addScaledVector(dir, this.clipDistance);
  }
}

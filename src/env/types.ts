import type { Camera, Object3D, Vector3, WebGLRenderer } from 'three';
import type { Collider } from '../game/collision';

export type Quality = 'low' | 'medium' | 'high';

/** Passed to every environment module when the world is built. */
export interface EnvContext {
  gl: WebGLRenderer;
  quality: Quality;
}

/** Ground height in metres at a world position. Deterministic (same on both players' machines). */
export type HeightFn = (x: number, z: number) => number;

/** Contract for `src/env/terrain/index.ts` → `createTerrain(ctx)`. */
export interface Terrain {
  /** All terrain meshes: ground, far mountains, boulders, pebbles. */
  group: Object3D;
  heightAt: HeightFn;
  /** Unit surface normal at a world position. */
  normalAt(x: number, z: number, out: Vector3): Vector3;
  /** Boulders big enough to block walking. */
  colliders: Collider[];
  /** Called every frame (e.g. to follow the camera with detail meshes). */
  update(time: number, camera: Camera): void;
}

/** Contract for `src/env/props/index.ts` → `createProps(ctx, heightAt)`. */
export interface Props {
  /** Outpost, landing pad, dropship, the Meridian wreck, debris, lights. */
  group: Object3D;
  /** Footprints of buildings, ship landing gear, containers... */
  colliders: Collider[];
  update(time: number): void;
}

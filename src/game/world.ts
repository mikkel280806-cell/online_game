import { Scene, Vector3, type Object3D, type PerspectiveCamera, type WebGLRenderer } from 'three';
import { installAtmosphere } from '../env/atmosphere';
import { installRadianceClamp } from '../env/safety';
import { PLAY_RADIUS, SPAWN_POINTS } from '../env/layout';
import { createLighting, type Lighting } from '../env/lighting';
import { createProps, padSurfaceHeight } from '../env/props';
import { createSky, type Sky } from '../env/sky';
import { createTerrain, type TerrainWithStats } from '../env/terrain';
import type { HeightFn, Props, Quality } from '../env/types';
import type { Bounds, Collider } from './collision';

export interface World {
  scene: Scene;
  sky: Sky;
  terrain: TerrainWithStats;
  props: Props;
  lighting: Lighting;
  heightAt: HeightFn;
  colliders: Collider[];
  bounds: Bounds;
  spawnPoints: Vector3[];
  /** Register objects added after creation (e.g. characters) with the shadow system. */
  add(object: Object3D): void;
  update(time: number, camera: PerspectiveCamera): void;
  /** Match the world's quality-dependent parts (shadow cascades) to the renderer's tier. */
  setQuality(quality: Quality): void;
  /** Profiling switches: hide parts of the world, cheapen shaders (scripts/profile.mjs). */
  setDebug(opts: WorldDebug): void;
}

export interface WorldDebug {
  sky?: boolean;
  props?: boolean;
  terrainNear?: boolean;
  terrainFar?: boolean;
  rocks?: boolean;
  pebbles?: boolean;
  /** Flat grey ground and rocks instead of the full terrain shader. */
  terrainFlat?: boolean;
  /** Near ground vertex stride (1 = full density). */
  nearStride?: number;
  shadows?: boolean;
  cascades?: number;
  shadowSize?: number;
}

/** Chapter 1: the moon Vigil, Survey Outpost Kestrel-7, and the Meridian on the horizon. */
export function createWorld(gl: WebGLRenderer, camera: PerspectiveCamera, quality: Quality): World {
  const t0 = performance.now();
  installRadianceClamp();
  const scene = new Scene();
  scene.fog = installAtmosphere();

  const sky = createSky();
  scene.add(sky.group);

  const ctx = { gl, quality };
  const terrain = createTerrain(ctx);
  scene.add(terrain.group);
  const props = createProps(ctx, terrain.heightAt);
  scene.add(props.group);

  const lighting = createLighting(gl, scene, camera, sky, quality);
  lighting.register(scene);

  // Walkable ground: the terrain, plus the landing pad's raised deck.
  const heightAt: HeightFn = (x, z) => terrain.heightAt(x, z) + padSurfaceHeight(x, z);
  const spawnPoints = SPAWN_POINTS.map((p) => new Vector3(p.x, heightAt(p.x, p.z), p.z));
  console.info(`[world] built in ${(performance.now() - t0).toFixed(0)} ms`);

  return {
    scene,
    sky,
    terrain,
    props,
    lighting,
    heightAt,
    colliders: [...terrain.colliders, ...props.colliders],
    bounds: { cx: 0, cz: 0, radius: PLAY_RADIUS },
    spawnPoints,
    add(object) {
      scene.add(object);
      lighting.register(object);
    },
    update(time, cam) {
      sky.update(time, cam.position);
      terrain.update(time, cam);
      props.update(time);
      lighting.update();
    },
    setQuality(q) {
      lighting.setQuality(q);
    },
    setDebug(o) {
      if (o.sky !== undefined) sky.group.visible = o.sky;
      if (o.props !== undefined) props.group.visible = o.props;
      if (o.terrainNear !== undefined) terrain.debug.setPartVisible('near', o.terrainNear);
      if (o.terrainFar !== undefined) terrain.debug.setPartVisible('far', o.terrainFar);
      if (o.rocks !== undefined) terrain.debug.setPartVisible('rocks', o.rocks);
      if (o.pebbles !== undefined) terrain.debug.setPartVisible('pebbles', o.pebbles);
      if (o.terrainFlat !== undefined) terrain.debug.setFlatShading(o.terrainFlat);
      if (o.nearStride !== undefined) terrain.debug.setNearStride(o.nearStride);
      if (o.shadows !== undefined) lighting.setShadowsEnabled(o.shadows);
      if (o.cascades !== undefined || o.shadowSize !== undefined) {
        lighting.configureShadows({
          ...(o.cascades ? { cascades: o.cascades } : {}),
          ...(o.shadowSize ? { size: o.shadowSize } : {}),
        });
      }
    },
  };
}

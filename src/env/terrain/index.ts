// The moon surface around Kestrel-7: heightfield, ground meshes to the horizon, ground and
// rock materials, boulders and pebbles. Contract: `Terrain` in ../types.ts.
//
// Integration notes:
// - Call update(time, camera) every frame: it culls far-field chunks and moves the pebble window.
// - The key light should shine along SUN_DIR: the ground and rock materials then apply the
//   baked terrain sun-occlusion to it (long mountain/crater shadows beyond shadow-map range).
// - The far field reaches 10 km; keep the camera's far plane (or fog) beyond that.
// - The group must stay at the origin, untransformed (heightAt and culling are in world space).

import { Frustum, Group, Matrix4, Mesh, Vector3, type BufferGeometry, type Camera } from 'three';
import type { EnvContext, Terrain } from '../types';
import { TerrainGrid } from './grid';
import { TerrainModel } from './heightfield';
import { createTerrainMaterial, setTerrainFlatShading } from './material';
import { buildNearChunks, buildNearGeometry, buildPolarGeometries } from './meshes';
import { createRocks } from './rocks';
import { computeSunShadow, createSunShadow, sunVisibilityAt, type SunShadowData } from './sunshadow';
import { bakeTerrainTextures, type TerrainTextures } from './textures';

export { setTerrainDebug } from './material';
export { setTerrainAnisotropy } from './textures';

/** The near ground is drawn as NEAR_TILES x NEAR_TILES chunks. */
const NEAR_TILES = 6;

/** World seed: both players must use the same one. */
export const TERRAIN_SEED = 7;

/** CPU-only part of the terrain (no WebGL): usable from tests and gameplay code. */
export interface TerrainHeights {
  model: TerrainModel;
  grid: TerrainGrid;
}

export function buildTerrainHeights(seed = TERRAIN_SEED): TerrainHeights {
  const model = new TerrainModel(seed);
  return { model, grid: new TerrainGrid(model) };
}

export interface TerrainWithStats extends Terrain {
  /** 0..1: how much of the Hollow's disc is visible from (x, y, z), from the baked terrain occlusion. */
  sunVisibility(x: number, y: number, z: number): number;
  stats: { buildMs: number; boulders: number; breakdown: string };
  /** The baked ground textures (e.g. to lower anisotropy on weak GPUs). */
  textures: TerrainTextures;
  /** Profiling switches (scripts/profile.mjs). */
  debug: TerrainDebug;
}

export interface TerrainDebug {
  /** Flat grey instead of the full ground/rock shader. */
  setFlatShading(on: boolean): void;
  /** Draw the near ground with every n-th vertex (1 = full density). */
  setNearStride(stride: number): void;
  setPartVisible(part: 'near' | 'far' | 'rocks' | 'pebbles', on: boolean): void;
}

export function createTerrain(ctx: EnvContext): TerrainWithStats {
  const t0 = performance.now();
  const { model, grid } = buildTerrainHeights();
  const t1 = performance.now();
  const shadowData: SunShadowData = computeSunShadow((x, z) => grid.heightAt(x, z), ctx.quality !== 'low');
  const shadow = createSunShadow(shadowData);
  const t2 = performance.now();
  const textures = bakeTerrainTextures(ctx.gl, ctx.quality);
  const t3 = performance.now();

  const group = new Group();
  group.name = 'terrain';

  const groundMat = createTerrainMaterial({ textures, shadow, kind: 'ground' });
  // The near ground in 6x6 chunks (59 m square, ~3.9k triangles each) so the camera culls what
  // it doesn't see; they share one vertex buffer.
  const nearFull = buildNearGeometry(grid);
  const near = new Group();
  near.name = 'terrain-near';
  const nearChunks = buildNearChunks(nearFull, NEAR_TILES).map((g, i) => {
    const m = new Mesh(g, groundMat);
    m.name = `terrain-near-${i}`;
    m.receiveShadow = true;
    // Draw the ground after everything standing on it (props, rocks, characters render at
    // order 0): its expensive shader then runs only where it is visible, not under every prop.
    m.renderOrder = 1;
    m.matrixAutoUpdate = false;
    near.add(m);
    return m;
  });
  group.add(near);

  // The far field sits a hair behind the near mesh where they overlap. Its chunks are culled
  // against tight boxes in update() (bounding spheres of flat, wide chunks cull badly).
  const farMat = createTerrainMaterial({ textures, shadow, kind: 'ground' });
  farMat.polygonOffset = true;
  farMat.polygonOffsetFactor = 1;
  farMat.polygonOffsetUnits = 4;
  const farChunks: Mesh[] = [];
  for (const [i, g] of buildPolarGeometries(grid, 8, [150, 900, 10_000]).entries()) {
    const m = new Mesh(g, farMat);
    m.name = `terrain-far-${i}`;
    m.receiveShadow = true;
    m.renderOrder = 1;
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    farChunks.push(m);
    group.add(m);
  }
  const t4 = performance.now();

  const rockMat = createTerrainMaterial({ textures, shadow, kind: 'rock' });
  const rocks = createRocks(model, grid, rockMat, ctx.quality, TERRAIN_SEED);
  group.add(rocks.group);
  const t5 = performance.now();

  const buildMs = t5 - t0;
  const breakdown =
    `built in ${buildMs.toFixed(0)} ms (heights ${(t1 - t0).toFixed(0)}, sun occlusion ${(t2 - t1).toFixed(0)}, ` +
    `texture bake ${(t3 - t2).toFixed(0)}, meshes ${(t4 - t3).toFixed(0)}, rocks ${(t5 - t4).toFixed(0)}; ` +
    `${rocks.count} boulders, ${rocks.colliders.length} colliders)`;
  console.info(`[terrain] ${breakdown}`);

  const strided = new Map<number, BufferGeometry[]>([[1, nearChunks.map((m) => m.geometry)]]);
  const debug: TerrainDebug = {
    setFlatShading: setTerrainFlatShading,
    setNearStride(stride) {
      let geos = strided.get(stride);
      if (!geos) strided.set(stride, (geos = buildNearChunks(nearFull, NEAR_TILES, stride)));
      nearChunks.forEach((m, i) => (m.geometry = geos[i]));
    },
    setPartVisible(part, on) {
      if (part === 'near') near.visible = on;
      else if (part === 'far') farVisible = on;
      else if (part === 'rocks') {
        rocksVisible = on;
        rocks.group.children.forEach((c) => c.name === 'terrain-boulders' && (c.visible = on));
      }
      else rocks.group.children.forEach((c) => c.name === 'terrain-pebbles' && (c.visible = on));
    },
  };
  let farVisible = true;
  let rocksVisible = true;

  return {
    group,
    debug,
    heightAt: (x, z) => grid.heightAt(x, z),
    normalAt: (x: number, z: number, out: Vector3) => grid.normalAt(x, z, out) as Vector3,
    colliders: rocks.colliders,
    sunVisibility: (x, y, z) => sunVisibilityAt(shadowData, x, y, z),
    stats: { buildMs, boulders: rocks.count, breakdown },
    textures,
    update(_time: number, camera: Camera) {
      camera.updateMatrixWorld();
      projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projView);
      for (const m of farChunks) m.visible = farVisible && frustum.intersectsBox(m.geometry.boundingBox!);
      for (const m of rocks.farMeshes) m.visible = rocksVisible && frustum.intersectsBox(m.boundingBox!);
      rocks.update(camera);
    },
  };
}

const projView = new Matrix4();
const frustum = new Frustum();

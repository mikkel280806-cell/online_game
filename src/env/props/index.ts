// Props for Chapter 1: landing pad 07 with the dropship Wren, Survey Outpost Kestrel-7, and the
// wreck of the Meridian with its debris field. All static geometry is merged by material
// (a dozen draw calls); light is mostly HDR emissive + glow sprites, plus three real lights.

import { DoubleSide, Group, Mesh, PointLight, SpotLight, Vector3, type BufferGeometry, type Material } from 'three';
import { LANDING_PAD } from '../layout';
import type { EnvContext, HeightFn, Props } from '../types';
import { Asm, PartBuilder, TY, newKit } from './builder';
import { ConeSet, GlowSet } from './fx';
import { computeColliders, PAD_BASE_RADIUS, SHIP } from './layout';
import { createCanopyGlass, createHardSurfaceMaterial, getSurfaceTextures } from './materials';
import { buildOutpost } from './outpost';
import { buildPad, padMarkSpec } from './pad';
import { buildShip } from './ship';
import { createDecalAtlas, createPadMarks, createSolarTexture } from './textures';
import { buildWreck } from './wreck';

export { padSurfaceHeight, PAD_TOP } from './layout';

export interface PropsStats {
  ms: number;
  triangles: number;
  meshes: number;
  /** Milliseconds per build stage. */
  stages: Record<string, number>;
}

/** Filled in by createProps (startup cost and size), for perf overlays and look-dev. */
export const propsStats: PropsStats = { ms: 0, triangles: 0, meshes: 0, stages: {} };

export function createProps(ctx: EnvContext, heightAt: HeightFn): Props {
  const t0 = performance.now();
  let tLast = t0;
  const stages: Record<string, number> = {};
  const stage = (name: string) => {
    const now = performance.now();
    stages[name] = Math.round(now - tLast);
    tLast = now;
  };
  const gl = ctx.gl;
  const tex = getSurfaceTextures(gl, ctx.quality);
  stage('bake');
  const atlas = createDecalAtlas(gl.capabilities.getMaxAnisotropy());
  stage('atlas');
  const group = new Group();
  group.name = 'props';

  const kit = newKit();
  const padB = new PartBuilder();
  const shellB = new PartBuilder();
  const glassB = new PartBuilder();
  const dishB = new PartBuilder();
  const solarB = new PartBuilder(true);
  const glows = new GlowSet();
  const cones = new ConeSet();

  buildPad(padB, kit, glows, heightAt);
  stage('pad');
  const shipM = TY(SHIP.x, heightAt(SHIP.x, SHIP.z) + SHIP.y, SHIP.z, SHIP.yaw);
  const ship = buildShip(new Asm(kit, shipM), shellB, glassB, glows, atlas);
  const umbilical = ship.umbilical.clone().applyMatrix4(shipM);
  stage('ship');
  const outpost = buildOutpost(kit, dishB, solarB, glows, cones, atlas, heightAt, umbilical);
  stage('outpost');
  const wreck = buildWreck(heightAt, glows, kit.decal, atlas, ctx.quality);
  stage('wreck');

  // ---- materials ------------------------------------------------------------------------------
  const hardMat = createHardSurfaceMaterial(tex, { tile: 3.2, dust: 0.75, wear: 0.55 });
  // The ship is maintained: lighter wear than the abandoned outpost.
  const shellMat = createHardSurfaceMaterial(tex, { tile: 3.2, dust: 0.6, wear: 0.3, side: DoubleSide, darkBackFaces: true });
  const padMat = createHardSurfaceMaterial(tex, {
    tile: 6.4,
    dust: 0.45,
    wear: 0.6,
    pad: { marks: createPadMarks(padMarkSpec()), centre: new Vector3(LANDING_PAD.x, 0, LANDING_PAD.z), radius: PAD_BASE_RADIUS },
  });
  const decalMat = createHardSurfaceMaterial(tex, { tile: 3.2, dust: 0.5, decal: true, map: atlas.texture });
  const solarMat = createHardSurfaceMaterial(tex, { tile: 3.2, dust: 0.45, map: createSolarTexture() });
  const wreckMat = createHardSurfaceMaterial(tex, {
    tile: 16,
    dust: 0.85,
    wear: 0.5,
    groundY: wreck.groundY,
    grimeHeight: 9,
    dustScale: 0.09,
    side: DoubleSide,
    darkBackFaces: true,
  });
  const glassMat = createCanopyGlass();

  let triangles = 0;
  let meshes = 0;
  const add = (geo: BufferGeometry | null, mat: Material, cast: boolean, name: string): Mesh | null => {
    if (!geo) return null;
    const m = new Mesh(geo, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
    triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    meshes++;
    return m;
  };
  add(kit.hard.build(), hardMat, true, 'props-hard');
  add(kit.small.build(), hardMat, false, 'props-small');
  add(shellB.build(), shellMat, true, 'props-ship-hull');
  add(padB.build(), padMat, false, 'props-pad'); // flat: its shadow is invisible
  add(kit.decal.build(), decalMat, false, 'props-decals');
  add(solarB.build(), solarMat, true, 'props-solar');
  add(glassB.build(), glassMat, true, 'props-canopy');
  add(wreck.builder.build(), wreckMat, false, 'props-wreck'); // beyond the shadow distance

  // Comms dish: its own mesh so it can turn.
  const dish = add(dishB.build(), hardMat, true, 'props-dish');
  if (dish) {
    dish.position.copy(outpost.dishPivot);
    dish.matrixAutoUpdate = true;
  }

  const coneMesh = cones.build();
  if (coneMesh) {
    group.add(coneMesh);
    meshes++;
  }
  const glowPts = glows.build();
  if (glowPts) {
    group.add(glowPts);
    meshes++;
  }

  // ---- real lights (3, no shadows) -----------------------------------------------------------
  const bay = new PointLight('#ffd2a0', 22, 12, 2);
  bay.position.copy(ship.bayLight).applyMatrix4(shipM);
  bay.name = 'props-bay-light';
  group.add(bay);
  const spots: SpotLight[] = [];
  for (const s of outpost.spots.slice(0, 2)) {
    const spot = new SpotLight('#d8e6ff', 26, 30, 0.6, 0.8, 2);
    spot.position.copy(s.pos);
    spot.target.position.copy(s.target);
    group.add(spot, spot.target);
    spots.push(spot);
  }

  stage('merge');
  propsStats.stages = stages;
  propsStats.ms = performance.now() - t0;
  propsStats.triangles = Math.round(triangles);
  propsStats.meshes = meshes;
  console.info(`[props] createProps ${propsStats.ms.toFixed(0)} ms (${Object.entries(stages).map(([k, v]) => `${k} ${v}`).join(', ')}), ${meshes} meshes, ${(triangles / 1000).toFixed(0)}k triangles`);

  const coneMat = coneMesh?.material as { uniforms?: { uTime: { value: number } } } | undefined;
  const glowMat = glowPts?.material as { uniforms?: { uTime: { value: number } } } | undefined;
  return {
    group,
    colliders: computeColliders(),
    update(time: number) {
      if (glowMat?.uniforms) glowMat.uniforms.uTime.value = time;
      if (coneMat?.uniforms) coneMat.uniforms.uTime.value = time;
      if (dish) dish.rotation.y = 0.9 + time * 0.05;
      // The bay light breathes very slightly (failing ballast).
      bay.intensity = 22 * (0.94 + 0.06 * Math.sin(time * 2.3) * Math.sin(time * 0.71));
    },
  };
}

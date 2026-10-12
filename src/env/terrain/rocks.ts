// Boulders, rocks and pebbles.
//
// Geometry: subdivided icospheres displaced by 3D noise, then cut by a few random planes
// (fracture faces), squashed and flattened at the base. Smooth normals across the cuts read
// as small bevels that catch the low sun.
//
// Placement follows geology rather than uniform noise: talus around outcrops, ejecta on fresh
// crater rims, a debris field along the trench and around the Meridian's crater, boulders on
// the hill slopes, and only a sprinkle of small stones near the outpost. Thousands of pebbles
// and small rocks are scattered in a window that follows the camera (deterministic per cell).

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type Camera,
  type Material,
} from 'three';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
import { mulberry32 } from '../../game/random';
import type { CircleCollider } from '../../game/collision';
import { LANDING_PAD, OUTPOST_FLAT_RADIUS, PLAY_RADIUS, TRENCH, WRECK } from '../layout';
import type { Quality } from '../types';
import { hash01, smoothstep, WRECK_FWD_X, WRECK_FWD_Z, type TerrainModel } from './heightfield';
import type { TerrainGrid } from './grid';

// ---------------------------------------------------------------------------------------------
// Geometry

export interface RockShapeOptions {
  detail: number;
  /** Number of fracture planes. */
  cuts: number;
  /** Height relative to width. */
  squash: number;
  lumpiness: number;
  /** Dihedral angle (rad) above which edges shade hard. */
  crease?: number;
}

/**
 * A unit rock: horizontal radius ~1, resting so that y = 0 is its widest-bottom contact.
 * Carries `aRockH` (0 at the base, 1 at the top) for the dust gradient in the material.
 */
export function makeRockGeometry(seed: number, o: RockShapeOptions): BufferGeometry {
  const rng = mulberry32(seed);
  const n3 = createNoise3D(mulberry32(seed ^ 0x5bd1e995));
  let g: BufferGeometry = new IcosahedronGeometry(1, o.detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.getAttribute('position') as BufferAttribute;
  const planes: { x: number; y: number; z: number; d: number }[] = [];
  for (let i = 0; i < o.cuts; i++) {
    // Mostly side and top cuts: fractured blocks, rarely undercut.
    const a = rng() * Math.PI * 2;
    const y = rng() * 1.2 - 0.25;
    const l = Math.hypot(1, y);
    planes.push({ x: Math.cos(a) / l, y: y / l, z: Math.sin(a) / l, d: 0.45 + rng() * 0.3 });
  }
  const sx = 0.85 + rng() * 0.3;
  const sz = 0.75 + rng() * 0.3;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const f1 = n3(v.x * 0.9 + 3.1, v.y * 0.9, v.z * 0.9);
    const f2 = n3(v.x * 2.3, v.y * 2.3 + 7.7, v.z * 2.3);
    const f3 = n3(v.x * 5.1 + 1.3, v.y * 5.1, v.z * 5.1);
    v.multiplyScalar(1 + o.lumpiness * (0.16 * f1 + 0.07 * f2 + 0.025 * f3));
    for (const p of planes) {
      const e = v.x * p.x + v.y * p.y + v.z * p.z - p.d;
      if (e > 0) {
        // Fracture faces: nearly planar, with a little roughness left in them.
        const k = 0.97 - 0.05 * f3;
        v.x -= p.x * e * k;
        v.y -= p.y * e * k;
        v.z -= p.z * e * k;
      }
    }
    v.x *= sx;
    v.z *= sz;
    v.y *= o.squash;
    // Flatten the underside: rocks settle onto a broad base.
    const floor = -0.35 * o.squash;
    if (v.y < floor) v.y = floor + (v.y - floor) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const scale = 1 / Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 2;
  const cx = (bb.max.x + bb.min.x) / 2;
  const cz = (bb.max.z + bb.min.z) / 2;
  const h = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = (pos.getX(i) - cx) * scale;
    const y = (pos.getY(i) - bb.min.y) * scale;
    const z = (pos.getZ(i) - cz) * scale;
    pos.setXYZ(i, x, y, z);
    h[i] = (pos.getY(i) - 0) / ((bb.max.y - bb.min.y) * scale);
  }
  g.setAttribute('aRockH', new BufferAttribute(h, 1));
  // Hard normals across fracture edges, smooth ones over the weathered lumps.
  const out = toCreasedNormals(g, o.crease ?? (32 * Math.PI) / 180);
  g.dispose();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Static boulders

export interface Boulder {
  x: number;
  z: number;
  /** Horizontal radius (m). */
  size: number;
}

interface Placed extends Boulder {
  y: number;
  q: Quaternion;
  sy: number;
  shape: number;
  tint: number;
}

const _up = new Vector3(0, 1, 0);
const _n = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

function powerLaw(rng: () => number, min: number, max: number, alpha = 2.4): number {
  const a = alpha - 1;
  const k = 1 - Math.pow(min / max, a);
  return min / Math.pow(1 - rng() * k, 1 / a);
}

/** Orientation: random yaw, mostly following the ground normal, with a little random tilt. */
function orient(rng: () => number, grid: TerrainGrid, x: number, z: number, follow: number, out: Quaternion) {
  grid.normalAt(x, z, _n);
  _n.lerp(_up, 1 - follow).normalize();
  _q.setFromUnitVectors(_up, _n);
  _q2.setFromAxisAngle(_up, rng() * Math.PI * 2);
  out.copy(_q).multiply(_q2);
  const tilt = (rng() - 0.5) * 0.35;
  _q2.setFromAxisAngle(_p.set(rng() - 0.5, 0, rng() - 0.5).normalize(), tilt);
  out.premultiply(_q2);
}

export function scatterBoulders(model: TerrainModel, grid: TerrainGrid, seed: number): Placed[] {
  const rng = mulberry32(seed);
  const out: Placed[] = [];
  const padR = LANDING_PAD.radius + 4;
  const blocked = (x: number, z: number, size: number) => {
    const r = Math.hypot(x, z);
    if (r < OUTPOST_FLAT_RADIUS - 8) return true;
    if (r < OUTPOST_FLAT_RADIUS && size > 0.45) return true;
    if (Math.hypot(x - LANDING_PAD.x, z - LANDING_PAD.z) < padR + size) return true;
    // Keep the Meridian's hull footprint clear (props place the hull there).
    const dx = x - WRECK.x;
    const dz = z - WRECK.z;
    const along = dx * WRECK_FWD_X + dz * WRECK_FWD_Z;
    const across = dx * -WRECK_FWD_Z + dz * WRECK_FWD_X;
    if (Math.abs(along) < WRECK.length * 0.5 + 8 && Math.abs(across) < 34) return true;
    return false;
  };
  const add = (x: number, z: number, size: number, follow = 0.7, syIn = 0, sink = 0) => {
    if (blocked(x, z, size)) return;
    const q = new Quaternion();
    orient(rng, grid, x, z, follow, q);
    const sy = syIn || 0.8 + rng() * 0.45;
    const height = size * sy;
    const y = grid.heightAt(x, z) - height * (0.12 + sink + rng() * 0.18) - 0.04 * size;
    out.push({ x, z, size, y, q, sy, shape: Math.floor(rng() * 1000), tint: rng() });
  };

  // 1. Bedrock slabs breaking the surface of each outcrop, then talus around it.
  for (const o of model.outcrops) {
    const ca = Math.cos(o.angle);
    const sa = Math.sin(o.angle);
    const slabs = Math.round(5 + o.a * 0.5);
    for (let i = 0; i < slabs; i++) {
      const ang = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 0.8;
      const lu = Math.cos(ang) * o.a * d;
      const lv = Math.sin(ang) * o.b * d;
      const size = (1.5 + rng() * 2.2) * Math.min(1, 0.45 + o.a / 18);
      add(o.x + lu * ca - lv * sa, o.z + lu * sa + lv * ca, size, 0.25, 0.4 + rng() * 0.3, 0.02);
    }
  }
  for (const o of model.outcrops) {
    const n = Math.round(16 + o.a * 1.6);
    const ca = Math.cos(o.angle);
    const sa = Math.sin(o.angle);
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const d = 0.55 + Math.pow(rng(), 0.7) * 1.1;
      const lu = Math.cos(ang) * o.a * d;
      const lv = Math.sin(ang) * o.b * d;
      const x = o.x + lu * ca - lv * sa;
      const z = o.z + lu * sa + lv * ca;
      const size = powerLaw(rng, 0.28, d < 0.9 ? 2.6 : 1.7, 2.2);
      add(x, z, size, 0.6);
    }
  }

  // 2. Ejecta on fresh crater rims.
  const rimRocks = (cx: number, cz: number, cr: number, fresh: number, maxCount: number) => {
    const n = Math.min(maxCount, Math.round(fresh * (3 + cr * 0.9)));
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const t = 0.92 + Math.pow(rng(), 1.6) * 0.9;
      add(cx + Math.cos(ang) * cr * t, cz + Math.sin(ang) * cr * t, powerLaw(rng, 0.28, Math.max(0.4, Math.min(3.2, cr * 0.13)), 2.3));
    }
  };
  for (const c of model.craters) rimRocks(c.x, c.z, c.r, c.fresh, 30);
  // Procedural medium craters near enough to read (same hashing as the height model).
  {
    const cell = 85;
    const lim = Math.ceil(420 / cell);
    for (let iz = -lim; iz <= lim; iz++) {
      for (let ix = -lim; ix <= lim; ix++) {
        const hv = hash01(ix, iz, 23) * 4294967296;
        if ((hv & 255) / 256 > 0.3) continue;
        const px = (ix + 0.15 + 0.7 * (((hv >>> 8) & 255) / 255)) * cell;
        const pz = (iz + 0.15 + 0.7 * (((hv >>> 16) & 255) / 255)) * cell;
        const pr = Math.hypot(px, pz);
        if (pr < 70 || pr > 400) continue;
        const u = ((hv >>> 24) & 255) / 255;
        const cr = 5 + 14 * u * u;
        const fresh = hash01(ix, iz, 27);
        if (fresh < 0.6) continue;
        rimRocks(px, pz, cr, fresh, 18);
      }
    }
  }

  // 3. Debris field: trench berms, the wreck crater rim and the bow-wave mound.
  {
    const tx = TRENCH.end.x - TRENCH.start.x;
    const tz = TRENCH.end.z - TRENCH.start.z;
    const tl = Math.hypot(tx, tz);
    const nx = -tz / tl;
    const nz = tx / tl;
    for (let i = 0; i < 260; i++) {
      const s = Math.pow(rng(), 0.7);
      const side = rng() < 0.5 ? -1 : 1;
      const half = (TRENCH.width / 2) * (0.5 + 0.5 * smoothstep(-0.05, 0.45, s));
      const lat = half * (0.6 + Math.pow(rng(), 0.8) * 2.2) * side;
      const x = TRENCH.start.x + tx * s + nx * lat;
      const z = TRENCH.start.z + tz * s + nz * lat;
      add(x, z, powerLaw(rng, 0.35, 3.6, 2.0), 0.5);
    }
    for (let i = 0; i < 240; i++) {
      const ang = rng() * Math.PI * 2;
      const t = 0.82 + Math.pow(rng(), 1.3) * 1.0;
      const a = WRECK.craterRadius * 1.55 * t;
      const b = WRECK.craterRadius * t;
      const lu = Math.cos(ang) * a;
      const lv = Math.sin(ang) * b;
      const x = WRECK.x + lu * WRECK_FWD_X - lv * WRECK_FWD_Z;
      const z = WRECK.z + lu * WRECK_FWD_Z + lv * WRECK_FWD_X;
      add(x, z, powerLaw(rng, 0.35, 3.2, 2.1), 0.5);
    }
    for (let i = 0; i < 90; i++) {
      const along = WRECK.length * 0.5 + 18 + (rng() - 0.3) * 70;
      const across = (rng() - 0.5) * 220;
      const a2 = along - (across * across) / 260;
      const x = WRECK.x + a2 * WRECK_FWD_X - across * WRECK_FWD_Z;
      const z = WRECK.z + a2 * WRECK_FWD_Z + across * WRECK_FWD_X;
      add(x, z, powerLaw(rng, 0.35, 2.6, 2.1), 0.5);
    }
  }

  // 4. Boulders on the hill ring, more on steeper ground.
  {
    let placed = 0;
    for (let tries = 0; tries < 3000 && placed < 320; tries++) {
      const ang = rng() * Math.PI * 2;
      const r = 165 + rng() * 190;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      grid.normalAt(x, z, _n);
      const steep = 1 - _n.y;
      if (rng() > 0.08 + steep * 6) continue;
      // Small clusters: a parent and a few children.
      const kids = rng() < 0.4 ? 1 + Math.floor(rng() * 4) : 0;
      const size = powerLaw(rng, 0.3, 2.8, 2.2);
      add(x, z, size, 0.65);
      for (let k = 0; k < kids; k++) {
        add(x + (rng() - 0.5) * size * 6, z + (rng() - 0.5) * size * 6, powerLaw(rng, 0.28, Math.max(0.35, size * 0.7), 2.4), 0.65);
      }
      placed += 1 + kids;
    }
  }

  // 5. Sparse scatter in the play area, thinning toward the outpost.
  for (let i = 0; i < 520; i++) {
    const ang = rng() * Math.PI * 2;
    const r = 30 + Math.sqrt(rng()) * 140;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const keep = r < OUTPOST_FLAT_RADIUS ? 0.12 : smoothstep(30, 110, r) * 0.55 + 0.05;
    if (rng() > keep) continue;
    const size = r < OUTPOST_FLAT_RADIUS ? 0.28 + rng() * 0.15 : powerLaw(rng, 0.28, 1.4, 2.5);
    add(x, z, size, 0.75);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Instanced meshes

export interface RockSet {
  group: Object3D;
  colliders: CircleCollider[];
  /** Number of boulders placed (for stats). */
  count: number;
  /** Instanced meshes far from the outpost; index.ts culls them against tight boxes. */
  farMeshes: InstancedMesh[];
  update(camera: Camera): void;
}

/** Size classes: geometry detail follows size, so small rocks stay cheap. */
const CLASSES = [
  { key: 'b', min: 1.3, shapes: 2, detail: 4, lowDetail: 3, farDetail: 3, cuts: 7 },
  { key: 'm', min: 0.6, shapes: 2, detail: 3, lowDetail: 2, farDetail: 2, cuts: 6 },
  { key: 's', min: 0, shapes: 2, detail: 1, lowDetail: 1, farDetail: 1, cuts: 4 },
];

export function createRocks(
  model: TerrainModel,
  grid: TerrainGrid,
  material: Material,
  quality: Quality,
  seed: number,
): RockSet {
  const group = new Object3D();
  group.name = 'terrain-rocks';
  const shape = (ci: number, i: number, detail: number) =>
    makeRockGeometry(seed * 31 + ci * 100 + i, {
      detail,
      cuts: CLASSES[ci].cuts + (i % 2),
      squash: 0.55 + 0.12 * i,
      lumpiness: ci === 0 ? 1 : 1.1,
      crease: ((ci === 2 ? 40 : 30) * Math.PI) / 180,
    });
  const shapes = CLASSES.map((c, ci) => Array.from({ length: c.shapes }, (_, i) => shape(ci, i, quality === 'low' ? c.lowDetail : c.detail)));
  // The debris field near the wreck is 500 m+ away: same shapes, fewer triangles.
  const farShapes = CLASSES.map((c, ci) => shape(ci, 0, c.farDetail));

  const placed = scatterBoulders(model, grid, seed * 7 + 1);
  const colliders: CircleCollider[] = [];
  // Bucket by (size class, shape, region) so far-away clusters cull separately.
  const buckets = new Map<string, { geo: BufferGeometry; far: boolean; list: Placed[] }>();
  for (const p of placed) {
    const ci = CLASSES.findIndex((c) => p.size >= c.min);
    const c = CLASSES[ci];
    const far = Math.hypot(p.x, p.z) > 420;
    // Far away one shape per class is plenty (fewer draw calls).
    const si = far ? 0 : p.shape % c.shapes;
    const key = `${c.key}${si}${far ? 'f' : 'n'}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { geo: far ? farShapes[ci] : shapes[ci][si], far, list: [] }));
    b.list.push(p);
    if (p.size > 0.8 && Math.hypot(p.x, p.z) < PLAY_RADIUS + 20) colliders.push({ kind: 'circle', x: p.x, z: p.z, r: p.size * 0.85 });
  }
  const farMeshes: InstancedMesh[] = [];
  for (const [key, b] of buckets) {
    const mesh = new InstancedMesh(b.geo, material, b.list.length);
    mesh.name = `rocks-${key}`;
    b.list.forEach((p, i) => {
      _s.set(p.size, p.size * p.sy, p.size);
      _m.compose(_p.set(p.x, p.y, p.z), p.q, _s);
      mesh.setMatrixAt(i, _m);
      const t = 0.82 + p.tint * 0.3;
      mesh.setColorAt(i, _c.setRGB(t, t * (0.97 + p.tint * 0.03), t * (0.94 + p.tint * 0.05)));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    if (b.far) farMeshes.push(mesh);
    group.add(mesh);
  }

  const pebbles = createPebbleField(model, grid, material, quality, seed);
  group.add(pebbles.group);
  return { group, colliders, count: placed.length, farMeshes, update: pebbles.update };
}

// ---------------------------------------------------------------------------------------------
// Pebble field following the camera

const PEBBLE_CELL = 5;
const PEBBLE_RADIUS = 48;

function createPebbleField(model: TerrainModel, grid: TerrainGrid, material: Material, quality: Quality, seed: number) {
  const group = new Object3D();
  group.name = 'terrain-pebbles';
  const scale = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
  const pebbleCap = Math.round(5200 * scale);
  const stoneCap = Math.round(1500 * scale);
  const pebbleGeos = [0].map((i) => makeRockGeometry(seed * 41 + 200 + i, { detail: 0, cuts: 2, squash: 0.65, lumpiness: 1.2, crease: 1.2 }));
  const stoneGeos = [0].map((i) =>
    makeRockGeometry(seed * 43 + 300 + i, { detail: 2, cuts: 4, squash: 0.68, lumpiness: 1.2, crease: 0.65 }),
  );
  const mk = (geo: BufferGeometry, cap: number, cast: boolean) => {
    const m = new InstancedMesh(geo, material, cap);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.count = 0;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.frustumCulled = true;
    group.add(m);
    return m;
  };
  const pebbleMeshes = pebbleGeos.map((g) => mk(g, Math.ceil(pebbleCap / pebbleGeos.length), false));
  const stoneMeshes = stoneGeos.map((g) => mk(g, Math.ceil(stoneCap / stoneGeos.length), quality === 'high'));
  const all = [...pebbleMeshes, ...stoneMeshes];
  // Prime colour buffers.
  for (const m of all) m.setColorAt(0, _c.setRGB(1, 1, 1));

  let lastKey = '';
  const q = new Quaternion();
  const fwd = new Vector3();

  function rebuild(fx: number, fz: number) {
    const counts = all.map(() => 0);
    const cx0 = Math.floor((fx - PEBBLE_RADIUS) / PEBBLE_CELL);
    const cx1 = Math.floor((fx + PEBBLE_RADIUS) / PEBBLE_CELL);
    const cz0 = Math.floor((fz - PEBBLE_RADIUS) / PEBBLE_CELL);
    const cz1 = Math.floor((fz + PEBBLE_RADIUS) / PEBBLE_CELL);
    for (let iz = cz0; iz <= cz1; iz++) {
      for (let ix = cx0; ix <= cx1; ix++) {
        const ccx = (ix + 0.5) * PEBBLE_CELL;
        const ccz = (iz + 0.5) * PEBBLE_CELL;
        const dc = Math.hypot(ccx - fx, ccz - fz);
        if (dc > PEBBLE_RADIUS) continue;
        const rng = mulberry32((Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ seed) >>> 0);
        const r = Math.hypot(ccx, ccz);
        model.sample(ccx, ccz);
        const rocky = model.rock;
        const flat = r < OUTPOST_FLAT_RADIUS + 4;
        // Density: patchy, more on rocky ground and around craters; sparse on the outpost apron.
        const patch = hash01(ix >> 2, iz >> 2, seed + 5);
        let dens = 0.45 + patch * 0.9 + rocky * 2.2;
        if (flat) dens *= r < 24 ? 0.18 : 0.35;
        const nPeb = Math.floor(dens * 9 * scale + rng());
        const stoneDens = flat ? (r < 22 ? 0 : 0.3) : 0.25 + patch * 0.6 + rocky * 2.2;
        const nStone = Math.floor(stoneDens * 2.4 * scale + rng());
        for (let k = 0; k < nPeb + nStone; k++) {
          const stone = k >= nPeb;
          const x = ix * PEBBLE_CELL + rng() * PEBBLE_CELL;
          const z = iz * PEBBLE_CELL + rng() * PEBBLE_CELL;
          if (Math.hypot(x - LANDING_PAD.x, z - LANDING_PAD.z) < LANDING_PAD.radius + 1.5) continue;
          const list = stone ? stoneMeshes : pebbleMeshes;
          const which = Math.floor(rng() * list.length);
          const mesh = list[which];
          const ci = (stone ? pebbleMeshes.length : 0) + which;
          if (counts[ci] >= mesh.instanceMatrix.count) continue;
          let size = stone ? powerLaw(rng, 0.11, flat ? 0.18 : 0.32, 2.6) : powerLaw(rng, 0.025, flat ? 0.06 : 0.11, 2.4);
          // Fade out at the window edge so rebuilds don't pop.
          size *= smoothstep(PEBBLE_RADIUS, PEBBLE_RADIUS - 8, Math.hypot(x - fx, z - fz));
          if (size < 0.012) continue;
          grid.normalAt(x, z, _n);
          _n.lerp(_up, 0.3).normalize();
          _q.setFromUnitVectors(_up, _n);
          _q2.setFromAxisAngle(_up, rng() * Math.PI * 2);
          q.copy(_q).multiply(_q2);
          const sy = 0.85 + rng() * 0.5;
          const y = grid.heightAt(x, z) - size * sy * (0.15 + rng() * 0.2);
          _s.set(size, size * sy, size);
          _m.compose(_p.set(x, y, z), q, _s);
          mesh.setMatrixAt(counts[ci], _m);
          const t = 0.75 + rng() * 0.45;
          mesh.setColorAt(counts[ci], _c.setRGB(t, t * 0.98, t * 0.95));
          counts[ci]++;
        }
      }
    }
    all.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    });
  }

  function update(camera: Camera) {
    camera.getWorldDirection(fwd);
    const c = camera.position;
    let fx: number;
    let fz: number;
    const gy = grid.heightAt(c.x, c.z);
    if (fwd.y < -0.08) {
      const t = Math.min(40 / Math.max(0.2, Math.hypot(fwd.x, fwd.z)), (c.y - gy) / -fwd.y);
      fx = c.x + fwd.x * t;
      fz = c.z + fwd.z * t;
    } else {
      const l = Math.hypot(fwd.x, fwd.z) || 1;
      fx = c.x + (fwd.x / l) * 24;
      fz = c.z + (fwd.z / l) * 24;
    }
    // Keep the camera itself well inside the window.
    const dx = fx - c.x;
    const dz = fz - c.z;
    const d = Math.hypot(dx, dz);
    if (d > 28) {
      fx = c.x + (dx / d) * 28;
      fz = c.z + (dz / d) * 28;
    }
    const key = `${Math.round(fx / 8)},${Math.round(fz / 8)}`;
    if (key === lastKey) return;
    lastKey = key;
    rebuild(Math.round(fx / 8) * 8, Math.round(fz / 8) * 8);
  }

  return { group, update };
}

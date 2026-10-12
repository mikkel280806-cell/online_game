// Accumulates many small procedural parts and merges them into one geometry per material,
// so the whole outpost costs a handful of draw calls. Every vertex carries its own surface
// description (albedo + `aSurf` = metalness, roughness, panel amount, glow), which the
// hard-surface shader reads, so differently painted parts can share one material.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type ColorRepresentation,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface Surf {
  color: ColorRepresentation;
  /** 0..1 (default 0). */
  metal?: number;
  /** 0..1 (default 0.6). */
  rough?: number;
  /** Amount of plating detail, grime and paint wear, 0..1 (default 1). 0 for rubber, glass, dust. */
  panel?: number;
  /** Emissive multiplier on the colour (HDR; > 1 blooms). */
  glow?: number;
  /** Plating scale multiplier (bigger = larger panels). Default 1. */
  scale?: number;
}

const _c = new Color();
const _v = new Vector3();
/** Dev aid: add `?propscheck` to the URL to log parts with NaN positions or zero normals. */
const DEBUG_CHECK = typeof location !== 'undefined' && location.search.includes('propscheck');

/** Optional per-vertex colour tweak (world position after transform, normal, colour to edit). */
export type ColorFn = (p: Vector3, n: Vector3, out: Color) => void;

export class PartBuilder {
  private parts: BufferGeometry[] = [];
  triangles = 0;

  constructor(private readonly keepUv = false) {}

  get count(): number {
    return this.parts.length;
  }

  add(geo: BufferGeometry, surf: Surf, matrix?: Matrix4, colorFn?: ColorFn): BufferGeometry {
    if (matrix) geo.applyMatrix4(matrix);
    if (!geo.index) {
      const n = geo.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new BufferAttribute(idx, 1));
    }
    for (const name of Object.keys(geo.attributes)) {
      if (name === 'position' || name === 'normal' || (this.keepUv && name === 'uv')) continue;
      geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (this.keepUv && !geo.attributes.uv) geo.setAttribute('uv', new BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.morphAttributes = {};
    geo.clearGroups();

    const n = geo.attributes.position.count;
    if (DEBUG_CHECK) {
      const pa = geo.attributes.position.array;
      const na = geo.attributes.normal.array;
      let bad = 0;
      for (let i = 0; i < n; i++) {
        const l = Math.hypot(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]);
        if (!(l > 0.5) || !Number.isFinite(pa[i * 3] + pa[i * 3 + 1] + pa[i * 3 + 2])) bad++;
      }
      if (bad) console.warn(`[props] bad part: ${bad}/${n} verts`, new Error().stack?.split('\n').slice(2, 5).join(' | '));
    }
    const col = new Float32Array(n * 3);
    const s = new Float32Array(n * 4);
    const tile = new Float32Array(n).fill(surf.scale ?? 1);
    _c.set(surf.color);
    const metal = surf.metal ?? 0;
    const rough = surf.rough ?? 0.6;
    const panel = surf.panel ?? 1;
    const glow = surf.glow ?? 0;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const nn = new Vector3();
    const tmp = new Color();
    for (let i = 0; i < n; i++) {
      if (colorFn) {
        tmp.copy(_c);
        colorFn(_v.fromBufferAttribute(pos, i), nn.fromBufferAttribute(nor, i), tmp);
        col[i * 3] = tmp.r;
        col[i * 3 + 1] = tmp.g;
        col[i * 3 + 2] = tmp.b;
      } else {
        col[i * 3] = _c.r;
        col[i * 3 + 1] = _c.g;
        col[i * 3 + 2] = _c.b;
      }
      s[i * 4] = metal;
      s[i * 4 + 1] = rough;
      s[i * 4 + 2] = panel;
      s[i * 4 + 3] = glow;
    }
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setAttribute('aSurf', new BufferAttribute(s, 4));
    geo.setAttribute('aTile', new BufferAttribute(tile, 1));
    this.parts.push(geo);
    this.triangles += (geo.index ? geo.index.count : n) / 3;
    return geo;
  }

  /** Merge everything added so far (null when empty). */
  build(): BufferGeometry | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) throw new Error('props: geometry merge failed');
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

// ---- transforms -------------------------------------------------------------------------------

const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _p = new Vector3();

/** Translation, Euler rotation (XYZ) and scale as a matrix. */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Matrix4 {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return new Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Like T but with rotation order YXZ (yaw first): handy for things placed on the ground. */
export function TY(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = sx, sz = sx): Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Matrix that maps the unit +Y axis (0..1) onto the segment a→b (for cylinders along Y, centred). */
export function between(a: Vector3, b: Vector3): { m: Matrix4; length: number } {
  const dir = new Vector3().subVectors(b, a);
  const length = dir.length();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  return { m: new Matrix4().compose(mid, q, new Vector3(1, 1, 1)), length };
}

/** Orientation that points local +Z along `normal` (with local +Y as close to `up` as possible). */
export function facing(pos: Vector3, normal: Vector3, up = new Vector3(0, 1, 0)): Matrix4 {
  const z = normal.clone().normalize();
  let x = new Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-6) x = new Vector3().crossVectors(new Vector3(1, 0, 0), z);
  x.normalize();
  const y = new Vector3().crossVectors(z, x);
  const m = new Matrix4().makeBasis(x, y, z);
  m.setPosition(pos);
  return m;
}

/** Chain of matrices: a sub-assembly helper. */
export class Asm {
  constructor(
    readonly kit: Kit,
    readonly m: Matrix4 = new Matrix4(),
  ) {}

  sub(local: Matrix4): Asm {
    return new Asm(this.kit, this.m.clone().multiply(local));
  }

  /** Big parts: cast shadows. */
  hard(geo: BufferGeometry, surf: Surf, local?: Matrix4, colorFn?: ColorFn): BufferGeometry {
    return this.kit.hard.add(geo, surf, local ? this.m.clone().multiply(local) : this.m.clone(), colorFn);
  }

  /** Small parts (< ~0.3 m): no shadow casting. */
  small(geo: BufferGeometry, surf: Surf, local?: Matrix4): BufferGeometry {
    return this.kit.small.add(geo, surf, local ? this.m.clone().multiply(local) : this.m.clone());
  }

  /** World point from local coordinates. */
  pt(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z).applyMatrix4(this.m);
  }

  /** World direction from a local one. */
  dir(x: number, y: number, z: number): Vector3 {
    return new Vector3(x, y, z).transformDirection(this.m);
  }
}

export interface Kit {
  hard: PartBuilder;
  small: PartBuilder;
  /** Decal quads (keep uv). */
  decal: PartBuilder;
}

export function newKit(): Kit {
  return { hard: new PartBuilder(), small: new PartBuilder(), decal: new PartBuilder(true) };
}

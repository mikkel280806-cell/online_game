// Geometry helpers for hard-surface props: bevelled boxes and cylinders, lathes, tubes,
// parametric lofts (hulls) and corrugated sheet.

import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Box with rounded (bevelled) edges. Default radius ~4% of the smallest side. */
export function rbox(w: number, h: number, d: number, r?: number, seg = 1): BufferGeometry {
  const m = Math.min(w, h, d);
  const radius = Math.min(r ?? Math.max(0.006, Math.min(0.12, m * 0.08)), m * 0.49);
  return new RoundedBoxGeometry(w, h, d, seg, radius);
}

export function cyl(rTop: number, rBot: number, h: number, seg = 16, open = false): BufferGeometry {
  return new CylinderGeometry(rTop, rBot, h, seg, 1, open);
}

/** Cylinder along Y with chamfered rims (catches the light like a machined part). */
export function bcyl(r: number, h: number, seg = 16, bevel?: number): BufferGeometry {
  const b = Math.min(bevel ?? Math.max(0.006, r * 0.08), h * 0.45, r * 0.45);
  const pts = [
    new Vector2(0, -h / 2),
    new Vector2(r - b, -h / 2),
    new Vector2(r, -h / 2 + b),
    new Vector2(r, h / 2 - b),
    new Vector2(r - b, h / 2),
    new Vector2(0, h / 2),
  ];
  return new LatheGeometry(pts, seg);
}

/** Lathe around Y from (radius, y) pairs. */
export function lathe(points: ReadonlyArray<readonly [number, number]>, seg = 24, phiStart = 0, phiLength = Math.PI * 2): BufferGeometry {
  return new LatheGeometry(
    points.map(([r, y]) => new Vector2(Math.max(r, 0), y)),
    seg,
    phiStart,
    phiLength,
  );
}

export function sphere(r: number, ws = 16, hs = 10): BufferGeometry {
  return new SphereGeometry(r, ws, hs);
}

/**
 * Smooth tube through points (Catmull-Rom). Open tubes get flat end caps, so the end of a pipe or
 * cable never shows a hole you can see into.
 */
export function tube(points: Vector3[], r: number, segs = 32, radial = 6, closed = false): BufferGeometry {
  const curve = new CatmullRomCurve3(points, closed, 'centripetal');
  const g = new TubeGeometry(curve, segs, r, radial, closed);
  return closed ? g : capTube(g, curve.getPoint(0), curve.getTangent(0), curve.getPoint(1), curve.getTangent(1), radial);
}

/** Adds flat caps over the first and last vertex rings of a TubeGeometry (drops its uv). */
function capTube(g: BufferGeometry, p0: Vector3, t0: Vector3, p1: Vector3, t1: Vector3, radial: number): BufferGeometry {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const ring = radial + 1;
  const n = pos.count;
  const P: number[] = Array.from(pos.array as Float32Array);
  const N: number[] = Array.from(nor.array as Float32Array);
  const I: number[] = Array.from(g.index!.array);
  const cap = (first: number, centre: Vector3, normal: Vector3) => {
    const base = P.length / 3;
    P.push(centre.x, centre.y, centre.z);
    N.push(normal.x, normal.y, normal.z);
    for (let j = 0; j < ring; j++) {
      P.push(pos.getX(first + j), pos.getY(first + j), pos.getZ(first + j));
      N.push(normal.x, normal.y, normal.z);
    }
    // Wind so the face normal matches `normal`.
    const a = new Vector3(P[(base + 1) * 3], P[(base + 1) * 3 + 1], P[(base + 1) * 3 + 2]).sub(centre);
    const b = new Vector3(P[(base + 2) * 3], P[(base + 2) * 3 + 1], P[(base + 2) * 3 + 2]).sub(centre);
    const flip = a.cross(b).dot(normal) < 0;
    for (let j = 0; j < radial; j++) {
      if (flip) I.push(base, base + 2 + j, base + 1 + j);
      else I.push(base, base + 1 + j, base + 2 + j);
    }
  };
  cap(0, p0, t0.clone().negate());
  cap(n - ring, p1, t1.clone());
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
  out.setIndex(I);
  g.dispose();
  return out;
}

/** Straight strut between two points (cylinder). */
export function strut(a: Vector3, b: Vector3, r: number, seg = 8, r2 = r): BufferGeometry {
  const len = a.distanceTo(b);
  return alignY(new CylinderGeometry(r2, r, len, seg, 1, false), a, b);
}

/** Moves a Y-aligned geometry (centred on the origin, length = |b - a|) so it spans a→b. */
export function alignY(g: BufferGeometry, a: Vector3, b: Vector3): BufferGeometry {
  const dir = new Vector3().subVectors(b, a);
  if (dir.lengthSq() < 1e-12) return g;
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  return g.applyMatrix4(new Matrix4().compose(mid, q, new Vector3(1, 1, 1)));
}

/**
 * Parametric surface over (u, v) in [0,1]^2 with nu x nv quads. Normals come from finite
 * differences of f, so seams and poles stay smooth. `keep` can drop quads (holes, ragged edges).
 */
export function paramSurface(
  f: (u: number, v: number, out: Vector3) => void,
  nu: number,
  nv: number,
  opts: { flip?: boolean; keep?: (u0: number, u1: number, v0: number, v1: number) => boolean; uRange?: [number, number]; vRange?: [number, number] } = {},
): BufferGeometry {
  const [ua, ub] = opts.uRange ?? [0, 1];
  const [va, vb] = opts.vRange ?? [0, 1];
  const cols = nv + 1;
  const count = (nu + 1) * cols;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const p = new Vector3();
  const pu0 = new Vector3();
  const pu1 = new Vector3();
  const pv0 = new Vector3();
  const pv1 = new Vector3();
  const du = new Vector3();
  const dv = new Vector3();
  const n = new Vector3();
  const eu = 1e-3 * (ub - ua || 1);
  const ev = 1e-3 * (vb - va || 1);
  for (let i = 0; i <= nu; i++) {
    const u = ua + ((ub - ua) * i) / nu;
    for (let j = 0; j <= nv; j++) {
      const v = va + ((vb - va) * j) / nv;
      f(u, v, p);
      f(Math.max(0, u - eu), v, pu0);
      f(Math.min(1, u + eu), v, pu1);
      f(u, v - ev, pv0);
      f(u, v + ev, pv1);
      du.subVectors(pu1, pu0);
      dv.subVectors(pv1, pv0);
      n.crossVectors(du, dv);
      if (n.lengthSq() < 1e-14) {
        // Degenerate (pole): nudge inward along u.
        f(u < 0.5 ? u + 0.02 : u - 0.02, v - ev, pv0);
        f(u < 0.5 ? u + 0.02 : u - 0.02, v + ev, pv1);
        dv.subVectors(pv1, pv0);
        n.crossVectors(du.lengthSq() > 1e-14 ? du : new Vector3(0, 0, 1), dv);
      }
      n.normalize();
      if (!Number.isFinite(n.x + n.y + n.z) || n.lengthSq() < 0.5) n.set(0, 1, 0);
      if (opts.flip) n.negate();
      const k = (i * cols + j) * 3;
      pos[k] = p.x;
      pos[k + 1] = p.y;
      pos[k + 2] = p.z;
      nor[k] = n.x;
      nor[k + 1] = n.y;
      nor[k + 2] = n.z;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nu; i++) {
    const u0 = ua + ((ub - ua) * i) / nu;
    const u1 = ua + ((ub - ua) * (i + 1)) / nu;
    for (let j = 0; j < nv; j++) {
      const v0 = va + ((vb - va) * j) / nv;
      const v1 = va + ((vb - va) * (j + 1)) / nv;
      if (opts.keep && !opts.keep(u0, u1, v0, v1)) continue;
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = (i + 1) * cols + j + 1;
      const d = i * cols + j + 1;
      if (opts.flip) idx.push(a, d, b, b, d, c);
      else idx.push(a, b, d, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** A superellipse point: angle a (0 = +X, PI/2 = up), half-width, top/bottom half-heights, exponents. */
export function superPoint(a: number, hw: number, ht: number, hb: number, nt: number, nb: number, out: Vector2): Vector2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const n = s >= 0 ? nt : nb;
  const e = 2 / n;
  out.x = hw * Math.sign(c) * Math.pow(Math.abs(c), e);
  out.y = (s >= 0 ? ht : hb) * Math.sign(s) * Math.pow(Math.abs(s), e);
  return out;
}

/** Hull station: a cross-section at position z. */
export interface Station {
  z: number;
  /** Full width. */
  w: number;
  /** Height above the centre line (top) and below it (bottom). */
  ht: number;
  hb: number;
  /** Centre line height. */
  y: number;
  /** Superellipse exponents (2 = ellipse, higher = boxier). */
  nt: number;
  nb: number;
  /** Optional sideways centre offset. */
  x?: number;
}

/** Catmull-Rom of four values at s, clamped near the [b, c] range to avoid overshoot bulges. */
function crClamped(a: number, b: number, c: number, d: number, s: number, s2: number, s3: number): number {
  const v = 0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s2 + (-a + 3 * b - 3 * c + d) * s3);
  const lo = b < c ? b : c;
  const hi = b < c ? c : b;
  const m = (hi - lo) * 0.15;
  return v < lo - m ? lo - m : v > hi + m ? hi + m : v;
}

/** Catmull-Rom interpolation of hull stations by parameter t in [0,1] (uniform per station). */
export function stationAt(stations: Station[], t: number, out: Station): Station {
  const n = stations.length - 1;
  const f = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const s = f - i;
  const p0 = stations[Math.max(i - 1, 0)];
  const p1 = stations[i];
  const p2 = stations[i + 1];
  const p3 = stations[Math.min(i + 2, n)];
  const s2 = s * s;
  const s3 = s2 * s;
  out.z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * s + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * s2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * s3);
  out.w = crClamped(p0.w, p1.w, p2.w, p3.w, s, s2, s3);
  out.ht = crClamped(p0.ht, p1.ht, p2.ht, p3.ht, s, s2, s3);
  out.hb = crClamped(p0.hb, p1.hb, p2.hb, p3.hb, s, s2, s3);
  out.y = crClamped(p0.y, p1.y, p2.y, p3.y, s, s2, s3);
  out.nt = crClamped(p0.nt, p1.nt, p2.nt, p3.nt, s, s2, s3);
  out.nb = crClamped(p0.nb, p1.nb, p2.nb, p3.nb, s, s2, s3);
  out.x = crClamped(p0.x ?? 0, p1.x ?? 0, p2.x ?? 0, p3.x ?? 0, s, s2, s3);
  return out;
}

/** Point on a lofted hull: u along the stations (0 = first), v around (0..1 → angle 0..2PI starting at +X). */
export function hullPoint(stations: Station[], u: number, v: number, out: Vector3, inset = 0): Vector3 {
  const st = stationAt(stations, u, tmpStation);
  const a = v * Math.PI * 2;
  superPoint(a, Math.max(st.w / 2 - inset, 0.001), Math.max(st.ht - inset, 0.001), Math.max(st.hb - inset, 0.001), st.nt, st.nb, tmp2);
  return out.set((st.x ?? 0) + tmp2.x, st.y + tmp2.y, st.z);
}
const tmpStation: Station = { z: 0, w: 0, ht: 0, hb: 0, y: 0, nt: 2, nb: 2, x: 0 };
const tmp2 = new Vector2();

/** Extrude a closed 2D outline (x, y) along +Z by depth, with an optional bevel. */
export function extrude(outline: ReadonlyArray<readonly [number, number]>, depth: number, bevel = 0, curveSegments = 4): BufferGeometry {
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(depth - bevel * 2, 0.001),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  return g;
}

/** Cross-section of a corrugated sheet (see corrugated()): (x, z) breakpoints from -w/2 to w/2. */
export function corrugationProfile(w: number, pitch: number, depth: number): [number, number][] {
  const ribs = Math.max(1, Math.round(w / pitch));
  const p = w / ribs;
  const xs: [number, number][] = [];
  for (let i = 0; i < ribs; i++) {
    const x0 = -w / 2 + i * p;
    xs.push([x0, 0], [x0 + p * 0.18, depth], [x0 + p * 0.5, depth], [x0 + p * 0.68, 0]);
  }
  xs.push([w / 2, 0]);
  return xs;
}

/**
 * Decal quad (atlas rect) wrapped onto a corrugated sheet made with the same w/pitch/depth, in the
 * sheet's frame: centred at (cx, cy), `lift` metres off the paint, facets lit like the sheet.
 */
export function corrugatedDecal(
  w: number,
  pitch: number,
  depth: number,
  cx: number,
  cy: number,
  width: number,
  uv: { u0: number; v0: number; u1: number; v1: number; aspect: number },
  lift = 0.004,
): BufferGeometry {
  const prof = corrugationProfile(w, pitch, depth);
  const h = width / uv.aspect;
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const zAt = (x: number) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [ax, az] = prof[i];
      const [bx, bz] = prof[i + 1];
      if (x >= ax && x <= bx) return az + ((x - ax) / Math.max(bx - ax, 1e-9)) * (bz - az);
    }
    return 0;
  };
  const cuts = [x0, ...prof.map(([x]) => x).filter((x) => x > x0 && x < x1), x1];
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const xa = cuts[i];
    const xb = cuts[i + 1];
    const za = zAt(xa);
    const zb = zAt(xb);
    const l = Math.hypot(xb - xa, zb - za) || 1;
    const nx = -(zb - za) / l;
    const nz = (xb - xa) / l;
    const base = pos.length / 3;
    const ua = uv.u0 + ((xa - x0) / width) * (uv.u1 - uv.u0);
    const ub = uv.u0 + ((xb - x0) / width) * (uv.u1 - uv.u0);
    pos.push(xa + nx * lift, cy - h / 2, za + nz * lift, xb + nx * lift, cy - h / 2, zb + nz * lift, xb + nx * lift, cy + h / 2, zb + nz * lift, xa + nx * lift, cy + h / 2, za + nz * lift);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    uvs.push(ua, uv.v0, ub, uv.v0, ub, uv.v1, ua, uv.v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(idx);
  return g;
}

/**
 * Corrugated sheet in the XY plane (facing +Z), width w along X, height h along Y.
 * Trapezoidal ribs of the given pitch and depth, like a cargo container wall. Single-sided:
 * put something solid behind it.
 */
export function corrugated(w: number, h: number, pitch: number, depth: number): BufferGeometry {
  const xs = corrugationProfile(w, pitch, depth);
  // Build as a ribbon: vertices duplicated per segment for crisp facets.
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const [x0, z0] = xs[i];
    const [x1, z1] = xs[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const l = Math.hypot(dx, dz) || 1;
    // Normal: rotate segment direction by +90° in XZ, facing +Z.
    let nx = -dz / l;
    let nz = dx / l;
    if (nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const base = pos.length / 3;
    pos.push(x0, -h / 2, z0, x1, -h / 2, z1, x1, h / 2, z1, x0, h / 2, z0);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

/** Quad in the XY plane facing +Z (w x h), with uv mapped to the given atlas rectangle. */
export function quad(w: number, h: number, uv: { u0: number; v0: number; u1: number; v1: number }): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Deterministic smooth 1D/2D value noise in [0,1] for JS-side variation. */
export function vnoise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (i: number, j: number) => {
    let t = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0;
    t = Math.imul(t ^ (t >>> 13), 1274126177);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm2(x: number, y: number, octaves = 4, seed = 0): number {
  let s = 0;
  let a = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise2(x, y, seed + i * 17);
    norm += a;
    x *= 2.03;
    y *= 2.03;
    a *= 0.5;
  }
  return s / norm;
}

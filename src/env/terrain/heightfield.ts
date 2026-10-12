// Procedural height model for the moon "Vigil" around Survey Outpost Kestrel-7.
//
// Pure maths (no WebGL), deterministic for a given seed, so both players build the same
// ground and unit tests can run it in Node. `TerrainModel.sample(x, z)` returns the analytic
// height in metres and writes a few material hints (rock exposure, albedo bias, drift) as
// side outputs. The rendered meshes sample this function on grids; `heightAt` interpolates
// those grids (see grid.ts), so what players stand on matches what they see.

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { mulberry32 } from '../../game/random';
import {
  LANDING_PAD,
  MOUNTAIN_START_RADIUS,
  OUTPOST_BLEND_RADIUS,
  OUTPOST_FLAT_RADIUS,
  SUN_DIR,
  TRENCH,
  VISTA_CORRIDOR,
  WRECK,
} from '../layout';

export interface CraterDef {
  x: number;
  z: number;
  /** Rim radius (m). */
  r: number;
  depth: number;
  rim: number;
  /** 0 = old and slumped, 1 = fresh with sharp rim, bright ejecta and exposed rock. */
  fresh: number;
}

export interface OutcropDef {
  x: number;
  z: number;
  /** Semi-axes (m) and orientation (rad). */
  a: number;
  b: number;
  angle: number;
  height: number;
}

const TAU = Math.PI * 2;
/** Radius of the moon, used for a gentle curvature drop toward the horizon. */
export const MOON_RADIUS = 350_000;
/** Heights are exactly zero out to here (a little past the flat radius, so grid triangles touching it stay flat too). */
export const FLAT_EXACT_RADIUS = OUTPOST_FLAT_RADIUS + 2.5;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Integer hash → [0, 1). Deterministic across JS engines (32-bit integer maths only). */
export function hash01(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Distance from p to segment ab, and the parameter along it (unclamped). */
function segInfo(px: number, pz: number, ax: number, az: number, bx: number, bz: number, out: { d: number; s: number }) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const s = ((px - ax) * dx + (pz - az) * dz) / l2;
  const sc = s < 0 ? 0 : s > 1 ? 1 : s;
  const qx = ax + dx * sc - px;
  const qz = az + dz * sc - pz;
  out.d = Math.sqrt(qx * qx + qz * qz);
  out.s = s;
}

// Horizontal direction toward the sun.
const SUN_H_LEN = Math.hypot(SUN_DIR.x, SUN_DIR.z);
export const SUN_HX = SUN_DIR.x / SUN_H_LEN;
export const SUN_HZ = SUN_DIR.z / SUN_H_LEN;
export const SUN_TAN = SUN_DIR.y / SUN_H_LEN;

/** A mountain range behind the wreck (as seen from the outpost): segment x0, z0, x1, z1. */
const BACKDROP = [-1700, -2350, 1200, -2800];

// The Meridian's frame: forward (bow) and side axes on the ground plane.
export const WRECK_FWD_X = -Math.sin(WRECK.yaw);
export const WRECK_FWD_Z = -Math.cos(WRECK.yaw);
const WRECK_SIDE_X = WRECK_FWD_Z;
const WRECK_SIDE_Z = -WRECK_FWD_X;
/** Crater semi-axes: long along the hull so the whole 420 m ship lies in it. */
const WRECK_CRATER_A = WRECK.craterRadius * 1.55;
const WRECK_CRATER_B = WRECK.craterRadius;

/** Crater cross-section: t = distance / rim radius. Returns height offset (m). */
function craterProfile(t: number, depth: number, rim: number, fresh: number, flatFloor: number): number {
  if (t >= 2.6) return 0;
  if (t < 0) t = 0;
  if (t < 1) {
    // Bowl rising to the rim. Fresh craters have steeper upper walls.
    const e = 1.6 + fresh * 1.4;
    let h = -depth + (depth + rim) * Math.pow(t, e);
    if (flatFloor > 0) {
      const f = -depth * (1 - flatFloor);
      h = -smin(-h, -f, depth * 0.12);
    }
    return h;
  }
  // Ejecta blanket falling away from the rim.
  const u = (t - 1) / 1.6;
  const k = 2.2 + fresh * 1.5;
  return rim * Math.exp(-(t - 1) * k) * (1 - u) * (1 - u);
}

/**
 * Fast 2D value noise with analytic derivatives (quintic fade), range about [-1, 1].
 * Used for the eroded mountain/hill fbm, where derivatives damp detail on slopes.
 */
class ValueNoise {
  private readonly perm = new Uint8Array(512);
  private readonly vals = new Float32Array(256);
  dx = 0;
  dz = 0;
  constructor(rng: () => number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
      this.vals[i] = rng() * 2 - 1;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  noised(x: number, z: number): number {
    const fx0 = Math.floor(x);
    const fz0 = Math.floor(z);
    const fx = x - fx0;
    const fz = z - fz0;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
    const duz = 30 * fz * fz * (fz * (fz - 2) + 1);
    const X = fx0 & 255;
    const Z = fz0 & 255;
    const P = this.perm;
    const V = this.vals;
    const a = V[P[P[X] + Z]];
    const b = V[P[P[X + 1] + Z]];
    const c = V[P[P[X] + Z + 1]];
    const d = V[P[P[X + 1] + Z + 1]];
    const k1 = b - a;
    const k2 = c - a;
    const k4 = a - b - c + d;
    this.dx = dux * (k1 + k4 * uz);
    this.dz = duz * (k2 + k4 * ux);
    return a + k1 * ux + k2 * uz + k4 * ux * uz;
  }
}

interface CraterLevel {
  cell: number;
  prob: number;
  rMin: number;
  rMax: number;
  salt: number;
  minDist: number;
  maxDist: number;
}

/** Procedural crater fields: one jittered crater per cell (with probability `prob`). */
const CRATER_LEVELS: CraterLevel[] = [
  { cell: 22, prob: 0.2, rMin: 1.0, rMax: 4.2, salt: 11, minDist: 44, maxDist: 900 },
  { cell: 85, prob: 0.3, rMin: 5, rMax: 19, salt: 23, minDist: 70, maxDist: 3500 },
  { cell: 420, prob: 0.42, rMin: 28, rMax: 120, salt: 37, minDist: 360, maxDist: 12000 },
];

export class TerrainModel {
  readonly craters: CraterDef[] = [];
  readonly outcrops: OutcropDef[] = [];

  /** Side outputs of the last `sample()` call. */
  rock = 0;
  /** Albedo bias: >0 brighter (fresh ejecta), <0 darker (disturbed, ploughed regolith). */
  bright = 0;
  /** 0..1: how much loose drifted dust (ripples) there is. */
  drift = 0;

  private readonly nBase: NoiseFunction2D;
  private readonly nMid: NoiseFunction2D;
  private readonly nFine: NoiseFunction2D;
  private readonly nDune: NoiseFunction2D;
  private readonly nMask: NoiseFunction2D;
  private readonly nHill: NoiseFunction2D;
  private readonly nWarp: NoiseFunction2D;
  private readonly nRange: NoiseFunction2D;
  private readonly nDetail: NoiseFunction2D;
  private readonly vn: ValueNoise;
  private readonly seg = { d: 0, s: 0 };
  /** Slope-ness of the last eroded() call (accumulated derivative magnitude). */
  private erodedSlope = 0;

  constructor(readonly seed = 7) {
    const rng = mulberry32(seed * 7919 + 17);
    const mk = () => createNoise2D(mulberry32(Math.floor(rng() * 2 ** 31)));
    this.nBase = mk();
    this.nMid = mk();
    this.nFine = mk();
    this.nDune = mk();
    this.nMask = mk();
    this.nHill = mk();
    this.nWarp = mk();
    mk(); // reserved slot: keeps the seed stream of the noises below stable
    this.nRange = mk();
    this.nDetail = mk();
    this.vn = new ValueNoise(mulberry32(Math.floor(rng() * 2 ** 31)));
    this.placeFeatures(mulberry32(seed * 104729 + 3));
  }

  /**
   * "Eroded" fbm (after Inigo Quilez): each octave is damped by the accumulated slope, so
   * valleys stay smooth and detail gathers on ridges and crests, like weathered ranges.
   */
  private eroded(x: number, z: number, oct: number): number {
    const vn = this.vn;
    let a = 0;
    let b = 1;
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < oct; i++) {
      const v = vn.noised(x, z);
      dx += vn.dx;
      dz += vn.dz;
      a += (b * v) / (1 + dx * dx + dz * dz);
      b *= 0.5;
      const nx = 1.6 * x - 1.2 * z;
      z = 1.2 * x + 1.6 * z + 7.31;
      x = nx + 3.7;
    }
    this.erodedSlope = Math.sqrt(dx * dx + dz * dz);
    return a;
  }

  /** Hand-tuned-by-rules features in the play area: impact craters and rocky outcrops. */
  private placeFeatures(rng: () => number) {
    const okSpot = (x: number, z: number, clear: number) => {
      const r = Math.hypot(x, z);
      if (r < OUTPOST_BLEND_RADIUS - 18 + clear * 0.5) return false;
      if (Math.hypot(x - LANDING_PAD.x, z - LANDING_PAD.z) < LANDING_PAD.radius + 30) return false;
      for (const c of this.craters) if (Math.hypot(x - c.x, z - c.z) < c.r + clear + 6) return false;
      for (const o of this.outcrops) if (Math.hypot(x - o.x, z - o.z) < o.a + clear + 10) return false;
      return true;
    };
    // A hero outcrop the look-dev "outcrop" view frames, then a few more.
    this.outcrops.push({ x: 74, z: -58, a: 17, b: 9, angle: 0.5, height: 3.4 });
    let guard = 0;
    while (this.outcrops.length < 8 && guard++ < 500) {
      const ang = rng() * TAU;
      const r = 70 + rng() * 85;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const a = 7 + rng() * 12;
      if (!okSpot(x, z, a)) continue;
      this.outcrops.push({ x, z, a, b: a * (0.4 + rng() * 0.4), angle: rng() * Math.PI, height: 1.3 + rng() * 2.6 });
    }
    // Craters: two large-ish ones, then a spread of small ones.
    guard = 0;
    while (this.craters.length < 13 && guard++ < 800) {
      const big = this.craters.length < 3;
      const ang = rng() * TAU;
      const rr = big ? 95 + rng() * 60 : 62 + rng() * 100;
      const x = Math.cos(ang) * rr;
      const z = Math.sin(ang) * rr;
      const r = big ? 14 + rng() * 12 : 3 + rng() * rng() * 10;
      if (!okSpot(x, z, r)) continue;
      const fresh = big ? 0.25 + rng() * 0.5 : rng();
      this.craters.push({ x, z, r, depth: r * (0.13 + 0.17 * fresh), rim: r * (0.02 + 0.05 * fresh), fresh });
    }
  }

  private fbm(n: NoiseFunction2D, x: number, z: number, oct: number): number {
    let s = 0;
    let a = 0.5;
    for (let i = 0; i < oct; i++) {
      s += a * n(x, z);
      const nx = 1.6 * x - 1.2 * z;
      z = 1.2 * x + 1.6 * z;
      x = nx;
      a *= 0.5;
    }
    return s;
  }

  private ridged(n: NoiseFunction2D, x: number, z: number, oct: number): number {
    let s = 0;
    let a = 0.5;
    let w = 1;
    let norm = 0;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(n(x, z));
      v *= v * w;
      w = Math.min(1, v * 2.2);
      s += a * v;
      norm += a;
      const nx = 1.7 * x - 1.15 * z;
      z = 1.15 * x + 1.7 * z;
      x = nx;
      a *= 0.5;
    }
    return s / norm;
  }

  private resLog = -Infinity;
  private lastRes = 0;
  /** Octaves of a fractal with base wavelength `base` worth computing at the current resolution. */
  private readonly oct = (base: number, max: number): number => {
    if (this.resLog === -Infinity) return max;
    const o = Math.floor(Math.log2(base) - this.resLog) + 2;
    return o < 1 ? 1 : o > max ? max : o;
  };

  /**
   * Analytic terrain height (m) at a world position. Writes rock/bright/drift side outputs.
   * `res` is the spacing (m) of the grid being sampled: octaves and features smaller than it
   * are skipped (they would only alias). 0 = full detail.
   */
  sample(x: number, z: number, res = 0): number {
    const r = Math.sqrt(x * x + z * z);
    let rock = 0;
    let bright = 0;
    if (res !== this.lastRes) {
      this.lastRes = res;
      this.resLog = res > 0 ? Math.log2(2 * res) : -Infinity;
    }
    const oct = this.oct;

    // ---- rolling plains -------------------------------------------------------------
    let h = 5.0 * this.fbm(this.nBase, x / 640, z / 640, oct(640, 3));
    h += 1.6 * this.fbm(this.nMid, x / 130, z / 130, oct(130, 3));
    if (res < 9) h += 0.3 * this.nFine(x / 19, z / 19);
    if (res < 3.5) h += 0.12 * this.nFine(z / 7.5 + 13.7, x / 7.5 - 3.1);

    // ---- regolith drifts: elongated, sharp-crested dunes in patches --------------------
    const driftMask = smoothstep(-0.15, 0.55, this.nMask(x / 240, z / 240));
    if (driftMask > 0 && res < 12) {
      const wu = x * 0.6 + z * 0.8;
      const wv = -x * 0.8 + z * 0.6;
      const warp = 7 * this.nDune(x / 80, z / 80);
      let d = 1 - Math.abs(this.nDune((wu + warp) / 27, wv / 110));
      d = d * d * d;
      h += 0.85 * d * driftMask;
    }
    this.drift = driftMask;

    // ---- impact craters ---------------------------------------------------------------
    for (let i = 0; r < 320 && i < this.craters.length; i++) {
      const c = this.craters[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const lim = c.r * 2.6;
      if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
      let t = Math.sqrt(dx * dx + dz * dz) / c.r;
      if (t >= 2.6) continue;
      t += 0.07 * this.nDetail(x / (c.r * 0.7) + c.x, z / (c.r * 0.7));
      h += craterProfile(t, c.depth, c.rim, c.fresh, c.r > 12 ? 0.25 : 0);
      rock = Math.max(rock, 0.6 * c.fresh * smoothstep(0.62, 0.95, t) * smoothstep(1.35, 1.0, t));
      if (t > 0.85) bright += c.fresh * 0.55 * Math.exp(-(t - 1) * 1.6) * smoothstep(0.85, 1.0, t);
    }
    for (let li = 0; li < CRATER_LEVELS.length; li++) {
      const L = CRATER_LEVELS[li];
      if (r < L.minDist - L.cell * 1.5 || r > L.maxDist + L.cell) continue;
      if (res > 0 && L.rMax < res * 0.9) continue;
      const fx = x / L.cell;
      const fz = z / L.cell;
      const cx = Math.floor(fx);
      const cz = Math.floor(fz);
      const reach = (2.6 * L.rMax) / L.cell;
      const ox = fx - cx;
      const oz = fz - cz;
      const i0 = ox + 0.15 < reach ? -1 : 0;
      const i1 = 1.15 - ox < reach ? 1 : 0;
      const j0 = oz + 0.15 < reach ? -1 : 0;
      const j1 = 1.15 - oz < reach ? 1 : 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const ix = cx + i;
          const iz = cz + j;
          // One 32-bit hash gives existence, position, size and freshness (8 bits each... roughly).
          const hv = hash01(ix, iz, L.salt) * 4294967296;
          if ((hv & 255) / 256 > L.prob) continue;
          const px = (ix + 0.15 + 0.7 * (((hv >>> 8) & 255) / 255)) * L.cell;
          const pz = (iz + 0.15 + 0.7 * (((hv >>> 16) & 255) / 255)) * L.cell;
          const u = ((hv >>> 24) & 255) / 255;
          const cr = L.rMin + (L.rMax - L.rMin) * u * u;
          const dx = x - px;
          const dz = z - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= cr * cr * 6.76) continue;
          const pr = Math.sqrt(px * px + pz * pz);
          if (pr < L.minDist || pr > L.maxDist) continue;
          if (this.inWreckZone(px, pz, cr)) continue;
          const fresh = hash01(ix, iz, L.salt + 4);
          let t = Math.sqrt(d2) / cr;
          t += 0.06 * this.nDetail(x / (cr * 0.8) + ix, z / (cr * 0.8) + iz);
          const depth = cr * (0.11 + 0.16 * fresh);
          const rim = cr * (0.015 + 0.045 * fresh);
          h += craterProfile(t, depth, rim, fresh, cr > 14 ? 0.3 : 0);
          if (fresh > 0.55) {
            rock = Math.max(rock, (fresh - 0.4) * 0.9 * smoothstep(0.6, 0.95, t) * smoothstep(1.3, 1.0, t));
            if (t > 0.8) bright += (fresh - 0.55) * 0.9 * Math.exp(-(t - 1) * 1.8) * smoothstep(0.8, 1.0, t);
          }
        }
      }
    }

    // ---- low rocky outcrops: bedrock ledges poking through the dust -------------------
    for (let i = 0; r < 220 && i < this.outcrops.length; i++) {
      const o = this.outcrops[i];
      const dx = x - o.x;
      const dz = z - o.z;
      const lim = o.a * 1.8;
      if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
      const ca = Math.cos(o.angle);
      const sa = Math.sin(o.angle);
      const lu = (dx * ca + dz * sa) / o.a;
      const lv = (-dx * sa + dz * ca) / o.b;
      let d = Math.sqrt(lu * lu + lv * lv);
      if (d > 1.8) continue;
      d += 0.28 * this.nDetail(x / 6 + 40, z / 6) + 0.12 * this.nFine(x / 2.6, z / 2.6 + 9);
      const core = smoothstep(1.0, 0.62, d);
      const apron = smoothstep(1.7, 0.9, d);
      // Blocky top: terraces (strata ledges) with a ridged texture.
      // A low bedrock rise; the crisp ledges on top are boulder slabs (rocks.ts).
      let oh = o.height * 0.6 * core * (0.7 + 0.3 * this.ridged(this.nHill, x / 7, z / 7, 2));
      const step = 0.75;
      const q = oh / step;
      const fl = Math.floor(q);
      oh = oh * 0.35 + 0.65 * (fl + smoothstep(0.25, 0.75, q - fl)) * step;
      h += oh + o.height * 0.22 * apron;
      rock = Math.max(rock, smoothstep(0.95, 0.75, d));
    }

    // Toward the sun the skyline stays low, so the Hollow hangs just above it and lights the outpost.
    const sunCos = r > 1 ? (x * SUN_HX + z * SUN_HZ) / r : 0;
    const cone = smoothstep(0.4, 0.82, sunCos);

    // ---- ring of hills enclosing the play area -----------------------------------------
    const ringR = r + 30 * this.nWarp(x / 230, z / 230);
    if (ringR > 150 && ringR < 400) {
      const band = smoothstep(150, 230, ringR) * (1 - smoothstep(262, 395, ringR));
      const ca = r > 0 ? x / r : 1;
      const sa = r > 0 ? z / r : 0;
      const amp = (10 + 25 * smoothstep(-0.55, 0.55, this.nHill(ca * 1.9 + 5, sa * 1.9))) * (1 - 0.5 * cone);
      const e = this.eroded(x / 120 + 40, z / 120 - 20, oct(120, 7));
      const shape = smoothstep(-0.75, 0.85, e);
      let hh = amp * band * shape;
      // Layered bedrock: partial terraces give ledges and short rocky risers.
      // The layer boundaries wander, so ledges never read as contour lines.
      const step = 4.5;
      const q = hh / step + 0.45 * this.nDetail(x / 45 + 7, z / 45);
      const fl = Math.floor(q);
      const fr = q - fl;
      const riser = smoothstep(0.25, 0.75, fr);
      const tw = 0.4 * smoothstep(-0.3, 0.4, this.nMask(x / 90 + 3, z / 90));
      hh += (fl + riser - q) * step * tw;
      hh += 2.2 * band * shape * this.ridged(this.nHill, x / 38, z / 38, oct(38, 3));
      h += hh;
      const riserRock = 4 * riser * (1 - riser) * smoothstep(3, 9, hh);
      rock = Math.max(rock, band * Math.max(smoothstep(0.45, 0.85, shape) * smoothstep(0.5, 1.6, this.erodedSlope), riserRock) * 0.8);
    }

    // ---- distant mountain ranges ---------------------------------------------------------
    const mr = r + 150 * this.nWarp(x / 700 + 11, z / 700) - 650 * cone;
    let mmask = smoothstep(MOUNTAIN_START_RADIUS, MOUNTAIN_START_RADIUS + 650, mr);
    if (mmask > 0) {
      mmask *= 1 - this.wreckValley(x, z);
      if (mmask > 0.0005) {
        const wx = x + 260 * this.nWarp(x / 2600, z / 2600);
        const wz = z + 260 * this.nWarp(x / 2600 + 31, z / 2600 - 17);
        const e = this.eroded(wx / 1100, wz / 1100, oct(1100, 8));
        let m = smoothstep(-0.7, 0.95, e);
        m = m * Math.sqrt(m); // ~ m^1.5: peaky summits, broad valleys
        // Uplift belts: long ranges rather than isolated massifs, plus the range that
        // backs the Meridian as seen from the outpost.
        const belt = this.fbm(this.nRange, wx / 2600, wz / 2600, 2);
        segInfo(x, z, BACKDROP[0], BACKDROP[1], BACKDROP[2], BACKDROP[3], this.seg);
        const backdrop = this.seg.d < 2200 ? Math.exp(-((this.seg.d / 650) ** 2)) : 0;
        const uplift = Math.max(smoothstep(-0.35, 0.35, belt), backdrop);
        const amp = 470 * (1 + 0.4 * smoothstep(2000, 7000, r)) * (1 - 0.6 * cone);
        let mh = amp * (0.12 * m + uplift * (0.18 + 0.7 * m));
        // Jagged crests ride on the uplifted ranges, so the skyline has peaks and saddles.
        const crest = this.ridged(this.nRange, wx / 1400 + 11, wz / 1400, oct(1400, 4));
        mh += amp * uplift * 0.36 * crest * Math.sqrt(crest) * smoothstep(-0.1, 0.4, m);
        // Spurs and gullies on the flanks (the eroded fbm alone leaves slopes too smooth).
        const steep = smoothstep(0.25, 1.1, this.erodedSlope) * smoothstep(20, 120, mh);
        if (steep > 0) {
          const spur = this.ridged(this.nDetail, wx / 520 + 3, wz / 520, oct(520, 2));
          const gully = res < 70 ? this.ridged(this.nFine, wx / 150, wz / 150 - 5, oct(150, 3)) : 0.5;
          mh += amp * steep * (0.1 * (spur - 0.45) + 0.06 * (gully - 0.5));
        }
        // Sedimentary benches: soft terraces on the flanks.
        const tq = mh / 26 + 0.5 * this.nDetail(x / 400, z / 400 + 9);
        const tf = Math.floor(tq);
        mh += (tf + smoothstep(0.3, 0.7, tq - tf) - tq) * 26 * 0.3 * smoothstep(-0.2, 0.4, this.nMask(x / 1200, z / 1200 - 4));
        h += mmask * mh;
        rock = Math.max(rock, mmask * smoothstep(40, 160, mh) * smoothstep(0.35, 1.3, this.erodedSlope));
      }
    }

    // ---- far rim ranges: the world edge (10 km) is always hidden behind a skyline ----------
    if (r > 6500) {
      const rim = smoothstep(6500, 9700, r);
      // Broad, uneven massifs (features many far-mesh cells wide, so no saw-teeth).
      const mass = smoothstep(-0.6, 0.8, this.eroded(x / 3300 + 17, z / 3300 - 4, oct(3300, 6)));
      const crest = this.ridged(this.nRange, x / 4200 - 5, z / 4200 + 3, oct(4200, 3));
      h += rim * (260 + 560 * mass + 220 * crest * Math.sqrt(crest));
      rock = Math.max(rock, rim * 0.7);
    }

    // Safety net: never let the sunward skyline climb above ~7° as seen from the outpost.
    // (smin is smooth and leaves heights far below the limit untouched.)
    if (cone > 0) {
      const hmax = 4 + r * 0.125;
      h += (smin(h, hmax, 60) - h) * cone;
    }

    // ---- the Meridian's crater and trench ---------------------------------------------------
    const wz0 = this.wreckShape(x, z);
    h += wz0;
    rock = Math.max(rock, this.wreckRock);
    bright += this.wreckBright;

    // ---- keep the view from the outpost to the wreck open ----------------------------------
    const seg = this.seg;
    segInfo(x, z, VISTA_CORRIDOR.from.x, VISTA_CORRIDOR.from.z, VISTA_CORRIDOR.to.x, VISTA_CORRIDOR.to.z, seg);
    const half = VISTA_CORRIDOR.width / 2;
    const cm = 1 - smoothstep(half, half + 60, seg.d);
    if (cm > 0 && h > VISTA_CORRIDOR.maxHeight * 0.5) {
      const k = VISTA_CORRIDOR.maxHeight * 0.5;
      const clamped = k + (VISTA_CORRIDOR.maxHeight - k) * (1 - Math.exp(-(h - k) / (VISTA_CORRIDOR.maxHeight - k)));
      h += (clamped - h) * cm;
    }

    // ---- flat outpost apron -------------------------------------------------------------------
    if (r < OUTPOST_BLEND_RADIUS) {
      const w = smoothstep(FLAT_EXACT_RADIUS, OUTPOST_BLEND_RADIUS, r);
      h *= w;
      rock *= w;
      bright *= w;
      this.drift *= 0.4 + 0.6 * w;
    }

    // Planet curvature (subtle, sells distance on the horizon).
    if (r > 60) h -= ((r - 60) * (r - 60)) / (2 * MOON_RADIUS);

    this.rock = rock > 1 ? 1 : rock;
    this.bright = bright > 1 ? 1 : bright < -1 ? -1 : bright;
    return h;
  }

  private wreckRock = 0;
  private wreckBright = 0;

  /** 1 near the wreck and trench (mountains stay away), fading to 0. */
  wreckValley(x: number, z: number): number {
    const seg = this.seg;
    segInfo(x, z, TRENCH.start.x, TRENCH.start.z, WRECK.x, WRECK.z, seg);
    let d = seg.d;
    segInfo(x, z, WRECK.x, WRECK.z, VISTA_CORRIDOR.to.x, VISTA_CORRIDOR.to.z, seg);
    d = Math.min(d, seg.d);
    return 1 - smoothstep(330, 760, d);
  }

  /** True if a procedural crater would land on the wreck crater, trench or hull. */
  private inWreckZone(px: number, pz: number, cr: number): boolean {
    const dx = px - WRECK.x;
    const dz = pz - WRECK.z;
    const a = (dx * WRECK_FWD_X + dz * WRECK_FWD_Z) / (WRECK_CRATER_A + cr);
    const b = (dx * WRECK_SIDE_X + dz * WRECK_SIDE_Z) / (WRECK_CRATER_B + cr);
    if (a * a + b * b < 1.3) return true;
    const seg = this.seg;
    segInfo(px, pz, TRENCH.start.x, TRENCH.start.z, TRENCH.end.x, TRENCH.end.z, seg);
    return seg.d < TRENCH.width + cr && seg.s > -0.1 && seg.s < 1.2;
  }

  /** Crater under the Meridian, bow-wave mound, hull trough and the ploughed trench with spoil berms. */
  private wreckShape(x: number, z: number): number {
    this.wreckRock = 0;
    this.wreckBright = 0;
    const dx = x - WRECK.x;
    const dz = z - WRECK.z;
    // Quick reject: outside the crater/mound reach and the trench's bounding box.
    if (dx * dx + dz * dz > 640 * 640) {
      const m = TRENCH.width * 2.6;
      if (x < Math.min(TRENCH.start.x, TRENCH.end.x) - m || x > Math.max(TRENCH.start.x, TRENCH.end.x) + m) return 0;
      if (z < Math.min(TRENCH.start.z, TRENCH.end.z) - m || z > Math.max(TRENCH.start.z, TRENCH.end.z) + m) return 0;
    }
    let h = 0;
    const along = dx * WRECK_FWD_X + dz * WRECK_FWD_Z;
    const across = dx * WRECK_SIDE_X + dz * WRECK_SIDE_Z;
    const ea = along / WRECK_CRATER_A;
    const eb = across / WRECK_CRATER_B;
    let t = Math.sqrt(ea * ea + eb * eb);
    if (t < 2.6) {
      t += 0.05 * this.nDetail(x / 60, z / 60 + 77) + 0.025 * this.nFine(x / 17, z / 17);
      h += craterProfile(t, WRECK.craterDepth, 4.2, 0.55, 0.35);
      this.wreckRock = smoothstep(0.75, 0.97, t) * smoothstep(1.3, 1.0, t) * 0.6;
      this.wreckBright = -0.35 * smoothstep(1.25, 0.9, t);
      // Trough the hull lies in.
      const ta = Math.abs(along) / (WRECK.length * 0.5 + 15);
      if (ta < 1.2 && Math.abs(across) < 70) {
        const tr = 1 - smoothstep(0.85, 1.2, ta);
        h -= 3 * tr * Math.pow(1 - smoothstep(0, 65, Math.abs(across)), 1.5);
      }
    }
    // Regolith shoved ahead of the bow: a crescent mound.
    const ma = along - (WRECK.length * 0.5 + 18) + (across * across) / 260;
    if (Math.abs(across) < 260 && ma > -120 && ma < 160) {
      const mound = 8.5 * Math.exp(-((ma / 30) ** 2)) * Math.exp(-((across / 90) ** 2));
      h += mound * (0.85 + 0.15 * this.nFine(x / 9, z / 9));
      this.wreckBright -= 0.25 * smoothstep(0.5, 3, mound);
    }
    // Ploughed trench from first touchdown to the stern.
    const seg = this.seg;
    segInfo(x, z, TRENCH.start.x, TRENCH.start.z, TRENCH.end.x, TRENCH.end.z, seg);
    const s = seg.s;
    if (s > -0.12 && s < 1.25 && seg.d < TRENCH.width * 2.4) {
      const half = (TRENCH.width / 2) * (0.5 + 0.5 * smoothstep(-0.05, 0.45, s));
      const grow = smoothstep(-0.08, 0.3, s) * (s < 1 ? 1 : smoothstep(1.22, 1.0, s));
      const lat = seg.d + 2.5 * this.nDetail(s * 14, 3.3) + 1.2 * this.nFine(x / 11, z / 11);
      const u = lat / half;
      const depth = TRENCH.depth * grow;
      if (u < 1.05) {
        h -= depth * (1 - smoothstep(0.45, 1.05, u));
        // Long grooves gouged by hull plating.
        h += 0.45 * grow * Math.sin(lat * 0.85) * (1 - smoothstep(0.3, 0.95, u));
      }
      const bermH = 4.6 * grow * (0.75 + 0.25 * this.nDetail(s * 22, 9.1));
      h += bermH * Math.exp(-(((u - 1.28) / 0.42) ** 2));
      const near = 1 - smoothstep(0.9, 2.0, u);
      this.wreckRock = Math.max(this.wreckRock, grow * smoothstep(0.55, 1.0, u) * smoothstep(1.7, 1.15, u) * 0.6);
      this.wreckBright -= 0.4 * grow * near;
    }
    return h;
  }
}

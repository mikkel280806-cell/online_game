// Precomputed height grids and the exact surface interpolation the meshes use.
//
// - Near grid: a square of 4/3 m cells around the outpost and play area (±176 m).
// - Polar grid: rings from 150 m out to 10 km, with spacing proportional to distance
//   (constant angular size from the outpost), so the horizon gets detail where it shows.
//   Inside the near square the polar mesh is sunk ("skirted") a little under the near mesh;
//   the near grid's outer band is morphed onto the polar surface so the two meet without seams.
//
// heightAt() interpolates exactly the triangles that are rendered, so feet meet the ground.

import { FLAT_EXACT_RADIUS, TerrainModel, smoothstep } from './heightfield';

export const NEAR_HALF = 176;
export const NEAR_CELLS = 264;
export const NEAR_STEP = (2 * NEAR_HALF) / NEAR_CELLS;
export const NEAR_VERTS = NEAR_CELLS + 1;
/** Width of the band where the near grid blends onto the polar surface. */
const MORPH_BAND = 18;

export const POLAR_SEG = 512;
export const POLAR_R0 = 150;
export const POLAR_RMAX = 10_000;
export const POLAR_G = 1 + (2 * Math.PI) / POLAR_SEG;
export const POLAR_RINGS = Math.ceil(Math.log(POLAR_RMAX / POLAR_R0) / Math.log(POLAR_G)) + 1;
const LOG_G = Math.log(POLAR_G);
const DTHETA = (2 * Math.PI) / POLAR_SEG;

/** How far the polar mesh is sunk below the near mesh inside the near square. */
export function polarDrop(x: number, z: number): number {
  const inside = NEAR_HALF - Math.max(Math.abs(x), Math.abs(z));
  return inside <= 5 ? 0 : 1.5 * smoothstep(5, 16, inside);
}

/** Packs a 0..1 value into a byte. */
const u8 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

export class TerrainGrid {
  readonly model: TerrainModel;
  /** Near grid heights, row-major [j * NEAR_VERTS + i], x = -NEAR_HALF + i * step. */
  readonly nearH = new Float32Array(NEAR_VERTS * NEAR_VERTS);
  /** Per-vertex material hints (rock, bright, concavity, drift) as bytes. */
  readonly nearAttr = new Uint8Array(NEAR_VERTS * NEAR_VERTS * 4);
  /** Polar heights as modelled [k * POLAR_SEG + j] (k = ring, j = angle). */
  readonly polarRaw = new Float32Array(POLAR_RINGS * POLAR_SEG);
  /** Polar heights as rendered (sunk under the near square). */
  readonly polarH = new Float32Array(POLAR_RINGS * POLAR_SEG);
  readonly polarAttr = new Uint8Array(POLAR_RINGS * POLAR_SEG * 4);
  readonly ringR = new Float64Array(POLAR_RINGS);
  readonly cosT = new Float64Array(POLAR_SEG);
  readonly sinT = new Float64Array(POLAR_SEG);
  /** Max height of the whole polar grid (for shadow sweeps). */
  maxHeight = 0;

  constructor(model: TerrainModel) {
    this.model = model;
    for (let k = 0; k < POLAR_RINGS; k++) this.ringR[k] = POLAR_R0 * Math.pow(POLAR_G, k);
    for (let j = 0; j < POLAR_SEG; j++) {
      this.cosT[j] = Math.cos(j * DTHETA);
      this.sinT[j] = Math.sin(j * DTHETA);
    }
    this.buildPolar();
    this.buildNear();
  }

  private buildPolar() {
    const m = this.model;
    const { polarRaw, polarH, polarAttr, ringR, cosT, sinT } = this;
    let maxH = -Infinity;
    for (let k = 0; k < POLAR_RINGS; k++) {
      const r = ringR[k];
      const res = r * (POLAR_G - 1);
      for (let j = 0; j < POLAR_SEG; j++) {
        const x = r * cosT[j];
        const z = r * sinT[j];
        // (The far rim ranges in the model keep the edge itself behind a skyline.)
        const h = m.sample(x, z, res);
        const idx = k * POLAR_SEG + j;
        polarRaw[idx] = h;
        polarH[idx] = h - polarDrop(x, z);
        if (h > maxH) maxH = h;
        const a = idx * 4;
        polarAttr[a] = u8(m.rock);
        polarAttr[a + 1] = u8(0.5 + 0.5 * m.bright);
        polarAttr[a + 3] = u8(m.drift);
      }
    }
    this.maxHeight = maxH;
    // Concavity from ring/angle neighbours.
    for (let k = 0; k < POLAR_RINGS; k++) {
      const k0 = Math.max(0, k - 1);
      const k1 = Math.min(POLAR_RINGS - 1, k + 1);
      const dr = (ringR[k1] - ringR[k0]) * 0.5;
      const dt = ringR[k] * DTHETA;
      for (let j = 0; j < POLAR_SEG; j++) {
        const jm = (j + POLAR_SEG - 1) % POLAR_SEG;
        const jp = (j + 1) % POLAR_SEG;
        const h = polarRaw[k * POLAR_SEG + j];
        const lap =
          (polarRaw[k0 * POLAR_SEG + j] + polarRaw[k1 * POLAR_SEG + j] - 2 * h) / (dr * dr * 4) +
          (polarRaw[k * POLAR_SEG + jm] + polarRaw[k * POLAR_SEG + jp] - 2 * h) / (dt * dt);
        polarAttr[(k * POLAR_SEG + j) * 4 + 2] = u8(0.5 + Math.max(-0.5, Math.min(0.5, lap * 4)));
      }
    }
  }

  private buildNear() {
    const m = this.model;
    const { nearH, nearAttr } = this;
    const N = NEAR_VERTS;
    for (let j = 0; j < N; j++) {
      const z = -NEAR_HALF + j * NEAR_STEP;
      for (let i = 0; i < N; i++) {
        const x = -NEAR_HALF + i * NEAR_STEP;
        const idx = j * N + i;
        let h: number;
        const r = Math.sqrt(x * x + z * z);
        if (r <= FLAT_EXACT_RADIUS) {
          h = 0;
          m.rock = 0;
          m.bright = 0;
          m.drift = 0.3;
        } else {
          h = m.sample(x, z, NEAR_STEP);
        }
        const edge = Math.max(Math.abs(x), Math.abs(z));
        const morph = smoothstep(NEAR_HALF - MORPH_BAND, NEAR_HALF, edge);
        if (morph > 0) h += (this.polarSurface(x, z, this.polarRaw) - h) * morph;
        nearH[idx] = h;
        const a = idx * 4;
        nearAttr[a] = u8(m.rock);
        nearAttr[a + 1] = u8(0.5 + 0.5 * m.bright);
        nearAttr[a + 3] = u8(m.drift);
      }
    }
    // Concavity at a ~4 m scale (stride 3).
    const S = 3;
    const d2 = (S * NEAR_STEP) ** 2;
    for (let j = 0; j < N; j++) {
      const jm = Math.max(0, j - S) * N;
      const jp = Math.min(N - 1, j + S) * N;
      for (let i = 0; i < N; i++) {
        const im = Math.max(0, i - S);
        const ip = Math.min(N - 1, i + S);
        const h = nearH[j * N + i];
        const lap = (nearH[j * N + im] + nearH[j * N + ip] + nearH[jm + i] + nearH[jp + i] - 4 * h) / d2;
        nearAttr[(j * N + i) * 4 + 2] = u8(0.5 + Math.max(-0.5, Math.min(0.5, lap * 4)));
      }
    }
  }

  /** Ground height exactly as rendered. */
  heightAt(x: number, z: number): number {
    if (x > -NEAR_HALF && x < NEAR_HALF && z > -NEAR_HALF && z < NEAR_HALF) return this.nearSurface(x, z);
    const r = Math.sqrt(x * x + z * z);
    if (r >= this.ringR[POLAR_RINGS - 1]) return this.model.sample(x, z);
    return this.polarSurface(x, z, this.polarH);
  }

  private nearSurface(x: number, z: number): number {
    const N = NEAR_VERTS;
    const fx = (x + NEAR_HALF) / NEAR_STEP;
    const fz = (z + NEAR_HALF) / NEAR_STEP;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i > NEAR_CELLS - 1) i = NEAR_CELLS - 1;
    if (j > NEAR_CELLS - 1) j = NEAR_CELLS - 1;
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    const u = fx - i;
    const v = fz - j;
    const H = this.nearH;
    const h00 = H[j * N + i];
    const h10 = H[j * N + i + 1];
    const h01 = H[(j + 1) * N + i];
    const h11 = H[(j + 1) * N + i + 1];
    // Diagonal v00-v11 (matches the index buffer in meshes.ts).
    if (v >= u) return h00 + (h11 - h01) * u + (h01 - h00) * v;
    return h00 + (h10 - h00) * u + (h11 - h10) * v;
  }

  /** Interpolates the polar triangle mesh (diagonal v00-v11) with world-space barycentrics. */
  polarSurface(x: number, z: number, H: Float32Array): number {
    const r = Math.sqrt(x * x + z * z);
    let k = Math.floor(Math.log(r / POLAR_R0) / LOG_G);
    if (k < 0) k = 0;
    if (k > POLAR_RINGS - 2) k = POLAR_RINGS - 2;
    let th = Math.atan2(z, x);
    if (th < 0) th += 2 * Math.PI;
    let j = Math.floor(th / DTHETA);
    if (j >= POLAR_SEG) j = POLAR_SEG - 1;
    const j1 = (j + 1) % POLAR_SEG;
    const r0 = this.ringR[k];
    const r1 = this.ringR[k + 1];
    const c0 = this.cosT[j];
    const s0 = this.sinT[j];
    const c1 = this.cosT[j1];
    const s1 = this.sinT[j1];
    // v00 (k, j), v01 (k, j+1), v10 (k+1, j), v11 (k+1, j+1)
    const ax = r0 * c0;
    const az = r0 * s0;
    const h00 = H[k * POLAR_SEG + j];
    const h01 = H[k * POLAR_SEG + j1];
    const h10 = H[(k + 1) * POLAR_SEG + j];
    const h11 = H[(k + 1) * POLAR_SEG + j1];
    const cx = r1 * c1;
    const cz = r1 * s1;
    // Triangle A: v00, v01, v11.
    let bx = r0 * c1;
    let bz = r0 * s1;
    let hb = h01;
    let w = bary(x, z, ax, az, bx, bz, cx, cz);
    if (w[0] < -1e-6 || w[1] < -1e-6 || w[2] < -1e-6) {
      // Triangle B: v00, v11, v10 (reorder so b = v10).
      bx = r1 * c0;
      bz = r1 * s0;
      hb = h10;
      w = bary(x, z, ax, az, bx, bz, cx, cz);
    }
    return w[0] * h00 + w[1] * hb + w[2] * h11;
  }

  /** Unit normal of the rendered surface via central differences of heightAt. */
  normalAt(x: number, z: number, out: { x: number; y: number; z: number }) {
    const e = x > -NEAR_HALF && x < NEAR_HALF && z > -NEAR_HALF && z < NEAR_HALF ? NEAR_STEP * 0.75 : Math.max(1, Math.hypot(x, z) * 0.01);
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const l = Math.sqrt(dx * dx + 1 + dz * dz);
    out.x = -dx / l;
    out.y = 1 / l;
    out.z = -dz / l;
    return out;
  }
}

const _w: [number, number, number] = [0, 0, 0];
function bary(px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  const v0x = bx - ax;
  const v0z = bz - az;
  const v1x = cx - ax;
  const v1z = cz - az;
  const v2x = px - ax;
  const v2z = pz - az;
  const den = v0x * v1z - v1x * v0z;
  const wb = (v2x * v1z - v1x * v2z) / den;
  const wc = (v0x * v2z - v2x * v0z) / den;
  _w[0] = 1 - wb - wc;
  _w[1] = wb;
  _w[2] = wc;
  return _w;
}

// Baked terrain sun-occlusion. The Hollow never moves, so for every ground point we can
// precompute the height of the terrain "horizon" toward it: a single sweep along sun-aligned
// rows gives H(u) = max over sunward samples of (h - distance * tan(elevation)).
// We store H for the low and the high edge of the sun's disc (RG half-float), so the shader
// gets soft, distance-correct penumbrae: lit fraction = (y - H_high) / (H_low - H_high).
//
// Two levels: a fine one around the play area and a coarse one out to the mountains.
// This complements the renderer's shadow maps (which cover only the near field).

import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGFormat, Vector4, type Texture } from 'three';
import { SUN_HX, SUN_HZ, SUN_TAN } from './heightfield';

export interface SunShadow {
  near: Texture;
  far: Texture;
  /** (half extent of near grid, half extent of far grid, sun dir x, sun dir z) */
  grid: Vector4;
}

/** Angular radius of the sun's disc used for the penumbra (radians). */
const SUN_RADIUS = (2.2 * Math.PI) / 180;

interface Level {
  half: number;
  n: number;
}

/** Sweeps one level. `init` gives the horizon (low, high) entering each row from the sun side. */
function sweep(
  heightAt: (x: number, z: number) => number,
  L: Level,
  init: ((x: number, z: number) => [number, number]) | null,
): Float32Array {
  const { half, n } = L;
  const du = (2 * half) / n;
  const elev = Math.atan(SUN_TAN);
  const tLow = Math.tan(elev - SUN_RADIUS) * du;
  const tHigh = Math.tan(elev + SUN_RADIUS) * du;
  // Perpendicular axis (v) = (-sz, sx).
  const px = -SUN_HZ;
  const pz = SUN_HX;
  const out = new Float32Array(n * n * 2);
  const row = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const v = -half + (j + 0.5) * du;
    for (let i = 0; i < n; i++) {
      const u = -half + (i + 0.5) * du;
      row[i] = heightAt(u * SUN_HX + v * px, u * SUN_HZ + v * pz);
    }
    let hl = -2000;
    let hh = -2000;
    if (init) {
      const u = half + du * 0.5;
      [hl, hh] = init(u * SUN_HX + v * px, u * SUN_HZ + v * pz);
    }
    // March from the sun side (largest u) away from it.
    for (let i = n - 1; i >= 0; i--) {
      const o = (j * n + i) * 2;
      out[o] = hl;
      out[o + 1] = hh;
      const h = row[i];
      hl = (hl > h ? hl : h) - tLow;
      hh = (hh > h ? hh : h) - tHigh;
      if (hl < -2000) hl = -2000;
      if (hh < -2000) hh = -2000;
    }
  }
  return out;
}

/** Bilinear sample of a swept level at a world point. */
function sampleLevel(data: Float32Array, L: Level, x: number, z: number): [number, number] {
  const u = x * SUN_HX + z * SUN_HZ;
  const v = -x * SUN_HZ + z * SUN_HX;
  const du = (2 * L.half) / L.n;
  const fi = Math.min(L.n - 1.001, Math.max(0, (u + L.half) / du - 0.5));
  const fj = Math.min(L.n - 1.001, Math.max(0, (v + L.half) / du - 0.5));
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const a = fi - i;
  const b = fj - j;
  const res: [number, number] = [0, 0];
  for (let c = 0; c < 2; c++) {
    const p00 = data[(j * L.n + i) * 2 + c];
    const p10 = data[(j * L.n + i + 1) * 2 + c];
    const p01 = data[((j + 1) * L.n + i) * 2 + c];
    const p11 = data[((j + 1) * L.n + i + 1) * 2 + c];
    res[c] = (p00 * (1 - a) + p10 * a) * (1 - b) + (p01 * (1 - a) + p11 * a) * b;
  }
  return res;
}

function toTexture(data: Float32Array, n: number): DataTexture {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i]);
  const tex = new DataTexture(half, n, n, RGFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export interface SunShadowData {
  near: Float32Array;
  far: Float32Array;
  nearLevel: Level;
  farLevel: Level;
}

export function computeSunShadow(heightAt: (x: number, z: number) => number, fine: boolean): SunShadowData {
  const farLevel: Level = { half: 7000, n: fine ? 640 : 448 };
  const nearLevel: Level = { half: 340, n: fine ? 512 : 384 };
  const far = sweep(heightAt, farLevel, null);
  const near = sweep(heightAt, nearLevel, (x, z) => sampleLevel(far, farLevel, x, z));
  return { near, far, nearLevel, farLevel };
}

export function createSunShadow(data: SunShadowData): SunShadow {
  return {
    near: toTexture(data.near, data.nearLevel.n),
    far: toTexture(data.far, data.farLevel.n),
    grid: new Vector4(data.nearLevel.half, data.farLevel.half, SUN_HX, SUN_HZ),
  };
}

/** CPU lookup of the sun visibility (0..1) at a world point at height y, for gameplay or tests. */
export function sunVisibilityAt(data: SunShadowData, x: number, y: number, z: number): number {
  const u = x * SUN_HX + z * SUN_HZ;
  const v = -x * SUN_HZ + z * SUN_HX;
  const inNear = Math.abs(u) < data.nearLevel.half * 0.88 && Math.abs(v) < data.nearLevel.half * 0.88;
  const [hl, hh] = inNear ? sampleLevel(data.near, data.nearLevel, x, z) : sampleLevel(data.far, data.farLevel, x, z);
  const vis = (y + 0.2 - hh) / Math.max(hl - hh, 0.25);
  return vis < 0 ? 0 : vis > 1 ? 1 : vis;
}

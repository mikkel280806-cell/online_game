// GPU-baked, tileable ground textures (see ../bake.ts). Heights are in metres of the tile,
// so normal maps come out with physically sensible slopes.
//
//   regolithA: albedo (sRGB) + roughness (A)      tile = REGOLITH_TILE metres
//   regolithN: normal (RGB) + height 0..1 (A)
//   rockA / rockN: layered basalt, same packing   tile = ROCK_TILE metres
//   macro: low-frequency variation masks (RGBA)   tile = MACRO_TILE metres

import type { Texture, WebGLRenderer } from 'three';
import { bakeTexture } from '../bake';
import type { Quality } from '../types';

export const REGOLITH_TILE = 4;
export const ROCK_TILE = 6;
export const MACRO_TILE = 512;

export interface TerrainTextures {
  regolithA: Texture;
  regolithN: Texture;
  rockA: Texture;
  rockN: Texture;
  macro: Texture;
}

// Shared helpers for both bakes. Colours are LINEAR.
const COMMON = /* glsl */ `
const vec3 DUST = vec3(0.205, 0.171, 0.139);
const vec3 BASALT = vec3(0.052, 0.044, 0.038);
const vec3 BASALT_LIGHT = vec3(0.102, 0.085, 0.072);

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Scattered rounded stones on a tileable cell grid. Returns height in cell units; id and
// the stone's own random value come back through 'info' (x = id, y = coverage 0..1).
float stones(vec2 uv, float freq, float density, float size, out vec2 info) {
  vec2 p = uv * freq;
  vec2 n = floor(p), f = fract(p);
  float h = 0.0;
  info = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cell = mod(n + g, vec2(freq));
      float e = hash12(cell + 7.7);
      // Stones cluster in patches rather than sprinkling evenly.
      float cluster = smoothstep(-0.25, 0.55, gnoiseP(cell / freq * 5.0 + 0.5, vec2(5.0)));
      if (e > density * (0.15 + 1.7 * cluster)) continue;
      vec2 d = g + hash22(cell) - f;
      d = rot(e * 37.0) * d;
      d.x *= 0.75 + 0.7 * fract(e * 13.7);
      float rad = size * (0.45 + 0.8 * hash12(cell + 3.1));
      float q = 1.0 - dot(d, d) / (rad * rad);
      if (q > 0.0) {
        // Rounded tops, half-buried in dust.
        float b = pow(q, 0.6) * rad * 0.6;
        if (b > h) { h = b; info = vec2(hash12(cell + 1.3), smoothstep(0.0, 0.25, q)); }
      }
    }
  }
  return h;
}
`;

const REGOLITH = /* glsl */ `
${COMMON}
const float TILE = ${REGOLITH_TILE.toFixed(1)};

// Height in metres.
float regHeight(vec2 uv, out vec4 info) {
  // Gentle lumps, scuffs and clods of compacted dust.
  float h = fbmP(uv * 6.0, vec2(6.0), 4) * 0.018;
  h += fbmP(uv * 20.0 + 3.3, vec2(20.0), 3) * 0.005;
  // Fine grain and clumps.
  h += fbmP(uv * 64.0, vec2(64.0), 3) * 0.0025;
  h += gnoiseP(uv * 160.0, vec2(160.0)) * 0.0009;
  // Micro-craters: shallow pits with a soft raised lip.
  vec3 v = voronoiP(uv * 7.0, vec2(7.0));
  float pit = step(v.z, 0.09) * (v.z / 0.09);
  float pr = 0.08 + 0.14 * pit;
  float t = v.x / pr;
  float crater = pit > 0.0 ? (t < 1.0 ? (t * t - 1.0) * 0.006 * (0.4 + pit) : exp(-(t - 1.0) * 4.0) * 0.001) : 0.0;
  h += crater;
  // Pebbles (2-6 cm) and grit (0.5-1.5 cm).
  vec2 i1, i2;
  float cell1 = TILE / 40.0, cell2 = TILE / 150.0;
  float s1 = stones(uv, 40.0, 0.07, 0.33, i1) * cell1;
  float s2 = stones(uv, 150.0, 0.16, 0.3, i2) * cell2;
  float stone = max(s1, s2);
  info = vec4(s1 > s2 ? i1 : i2, stone, crater);
  return h + stone * 0.9;
}

vec4 bakeAlbedo(vec2 uv) {
  vec4 info;
  float h = regHeight(uv, info);
  vec3 col = DUST;
  float tone = fbmP(uv * 4.0, vec2(4.0), 4);
  col *= 0.92 + 0.16 * tone;
  col *= 0.93 + 0.14 * hash12(floor(uv * 512.0));       // per-texel grain
  col *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), smoothstep(-0.3, 0.4, fbmP(uv * 3.0 + 9.1, vec2(3.0), 3)));
  // Micro-crater interiors: slightly darker, disturbed dust.
  col *= 1.0 + info.w * 4.0;
  // Stones: from dark basalt to pale breccia, dusted on top.
  if (info.z > 0.0) {
    float id = info.x;
    vec3 stoneCol = mix(BASALT * 1.2, vec3(0.24, 0.215, 0.19), id * id);
    stoneCol *= 0.85 + 0.3 * hash12(floor(uv * 900.0));
    col = mix(col, stoneCol, info.y * 0.75);
  }
  float rough = 0.96 - info.y * 0.14 * step(0.0001, info.z) - 0.03 * tone;
  return vec4(col, rough);
}

vec4 bakeNormal(vec2 uv) {
  vec4 info;
  float e = uTexel;
  float hx0 = regHeight(uv - vec2(e, 0.0), info);
  float hx1 = regHeight(uv + vec2(e, 0.0), info);
  float hy0 = regHeight(uv - vec2(0.0, e), info);
  float hy1 = regHeight(uv + vec2(0.0, e), info);
  float h = regHeight(uv, info);
  float d = 2.0 * e * TILE;
  vec3 n = normalize(vec3(-(hx1 - hx0) / d, -(hy1 - hy0) / d, 1.0));
  return vec4(n * 0.5 + 0.5, clamp(h / 0.05 + 0.4, 0.0, 1.0));
}
`;

const ROCK = /* glsl */ `
${COMMON}
const float TILE = ${ROCK_TILE.toFixed(1)};

// Voronoi with nearest-cell data, tileable. Returns F1, F2-F1 (edge distance), cell id; and the
// offset to the cell point through 'rel' and the cell index through 'cellOut'.
// Voronoi with nearest-cell data, tileable. Returns (F1, F2-F1 edge distance, cell id), the offset to
// the nearest cell point ('rel'), its cell index ('cellOut') and a hash of the shared edge ('edge').
vec3 vor(vec2 p, vec2 period, out vec2 rel, out vec2 cellOut, out float edge) {
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0, id2 = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cell = mod(n + g, period);
      vec2 r = g + hash22(cell) * 0.85 + 0.075 - f;
      float d = dot(r, r);
      float cid = hash12(cell + 0.37);
      if (d < f1) { f2 = f1; id2 = id; f1 = d; id = cid; rel = r; cellOut = cell; }
      else if (d < f2) { f2 = d; id2 = cid; }
    }
  }
  f1 = sqrt(f1); f2 = sqrt(f2);
  edge = fract(sin((id + id2) * 91.7 + id * id2 * 37.1) * 4375.85);
  return vec3(f1, f2 - f1, id);
}

// Height (m) of weathered, layered basalt. info: x = crack, y = strata band, z = block id, w = dust.
float rockHeight(vec2 uv, out vec4 info) {
  // Irregular, warped domain so fractures never look like tiles or dried mud.
  vec2 w = vec2(fbmP(uv * 4.0, vec2(4.0), 3), fbmP(uv * 4.0 + 7.3, vec2(4.0), 3));
  vec2 q = uv + w * 0.07;
  // Strata: layering along v (world up for side projections), wavy and uneven.
  float sv = q.y * 7.0 + fbmP(uv * vec2(3.0, 1.0), vec2(3.0, 1.0), 3) * 0.9;
  float band = fract(sv);
  float layer = floor(sv);
  float ledge = smoothstep(0.0, 0.12, band) * (1.0 - smoothstep(0.7, 1.0, band));
  float h = ledge * 0.025 + band * 0.03;
  // Fracture blocks with planar facets; only some edges open into cracks.
  vec2 rel, cell;
  float edge;
  vec3 v = vor(q * 4.0 + vec2(0.0, layer * 0.37), vec2(4.0), rel, cell, edge);
  vec2 slope = hash22(cell + 4.1) - 0.5;
  h += dot(slope, rel) * 0.1 + v.z * 0.05;
  float open = smoothstep(0.35, 0.75, edge);
  float crack = (1.0 - smoothstep(0.0, 0.035 + 0.03 * open, v.y)) * (0.25 + 0.75 * open);
  // Finer, sparser fractures.
  vec2 rel2, cell2;
  float edge2;
  vec3 v2 = vor(q * 11.0, vec2(11.0), rel2, cell2, edge2);
  h += dot(hash22(cell2 + 2.3) - 0.5, rel2) * 0.025;
  float crack2 = (1.0 - smoothstep(0.0, 0.03, v2.y)) * step(0.6, edge2);
  h -= crack * 0.05 + crack2 * 0.012;
  // Weathering: rounded erosion, grain, pitting (vesicles).
  h += fbmP(uv * 12.0 + 1.1, vec2(12.0), 4) * 0.025;
  h += fbmP(uv * 48.0, vec2(48.0), 4) * 0.006;
  vec3 ves = voronoiP(uv * 90.0, vec2(90.0));
  float pit = step(ves.z, 0.3) * (1.0 - smoothstep(0.08, 0.22, ves.x));
  h -= pit * 0.003;
  // Dust settles into cracks and hollows.
  float hollow = smoothstep(0.1, 0.6, -fbmP(uv * 6.0 + 3.0, vec2(6.0), 3));
  float dust = max(crack * 0.7, hollow * 0.55);
  info = vec4(max(crack, crack2 * 0.6), mod(layer, 3.0) / 2.0, v.z, dust);
  return h;
}

vec4 bakeAlbedo(vec2 uv) {
  vec4 info;
  rockHeight(uv, info);
  vec3 col = mix(BASALT, BASALT_LIGHT, info.y * 0.8 + 0.2 * info.z);
  col *= 0.8 + 0.4 * fbmP(uv * 16.0, vec2(16.0), 4) + 0.15 * (hash12(floor(uv * 700.0)) - 0.5);
  col *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), smoothstep(-0.2, 0.5, fbmP(uv * 3.0, vec2(3.0), 3)));
  col = mix(col, DUST * 0.85, info.w * 0.7);
  col *= 1.0 - info.x * 0.35;
  float rough = mix(0.78, 0.95, info.w) + 0.05 * fbmP(uv * 20.0, vec2(20.0), 2);
  return vec4(col, rough);
}

vec4 bakeNormal(vec2 uv) {
  vec4 info;
  float e = uTexel;
  float hx0 = rockHeight(uv - vec2(e, 0.0), info);
  float hx1 = rockHeight(uv + vec2(e, 0.0), info);
  float hy0 = rockHeight(uv - vec2(0.0, e), info);
  float hy1 = rockHeight(uv + vec2(0.0, e), info);
  float h = rockHeight(uv, info);
  float d = 2.0 * e * TILE;
  vec3 n = normalize(vec3(-(hx1 - hx0) / d, -(hy1 - hy0) / d, 1.0));
  return vec4(n * 0.5 + 0.5, clamp(h / 0.12 + 0.5, 0.0, 1.0));
}
`;

const MACRO = /* glsl */ `
vec4 bake(vec2 uv) {
  float a = fbmP(uv * 4.0, vec2(4.0), 6) * 0.5 + 0.5;
  float b = fbmP(uv * 9.0 + 3.1, vec2(9.0), 5) * 0.5 + 0.5;
  float c = fbmP(uv * 6.0 + 7.7, vec2(6.0), 5) * 0.5 + 0.5;
  float d = ridgedP(uv * 5.0 + 1.3, vec2(5.0), 5);
  return vec4(a, b, c, d);
}
`;

export function bakeTerrainTextures(gl: WebGLRenderer, quality: Quality): TerrainTextures {
  const size = quality === 'low' ? 512 : 1024;
  const regolithA = bakeTexture(gl, { size, srgb: true, fragment: `${REGOLITH}\nvec4 bake(vec2 uv) { return bakeAlbedo(uv); }` });
  const regolithN = bakeTexture(gl, { size, fragment: `${REGOLITH}\nvec4 bake(vec2 uv) { return bakeNormal(uv); }` });
  const rockA = bakeTexture(gl, { size, srgb: true, fragment: `${ROCK}\nvec4 bake(vec2 uv) { return bakeAlbedo(uv); }` });
  const rockN = bakeTexture(gl, { size, fragment: `${ROCK}\nvec4 bake(vec2 uv) { return bakeNormal(uv); }` });
  const macro = bakeTexture(gl, { size: 512, fragment: MACRO });
  const textures = { regolithA, regolithN, rockA, rockN, macro };
  // ~20 fetches per ground pixel: 16x anisotropy is wasteful, 8x is visually identical.
  setTerrainAnisotropy(gl, textures, quality === 'high' ? 8 : quality === 'medium' ? 4 : 2);
  return textures;
}

/**
 * Changes the anisotropy of the baked textures. They are render-target textures, whose sampler
 * parameters three sets only once, so this goes through the raw WebGL texture.
 */
export function setTerrainAnisotropy(gl: WebGLRenderer, textures: TerrainTextures, level: number): void {
  const ext = gl.extensions.get('EXT_texture_filter_anisotropic') as { TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
  if (!ext) return;
  const ctx = gl.getContext();
  const max = gl.capabilities.getMaxAnisotropy();
  for (const tex of Object.values(textures) as Texture[]) {
    const handle = (gl.properties.get(tex) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!handle) continue;
    tex.anisotropy = Math.max(1, Math.min(level, max));
    ctx.bindTexture(ctx.TEXTURE_2D, handle);
    ctx.texParameterf(ctx.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, tex.anisotropy);
  }
  ctx.bindTexture(ctx.TEXTURE_2D, null);
  gl.resetState();
}

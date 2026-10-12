// Materials for the props. One hard-surface shader (MeshStandardMaterial + patch) does all the
// realism work in world space, so procedural geometry needs no UVs:
//  - triplanar plating normals and grime from GPU-baked tileable textures,
//  - per-vertex paint colour / metalness / roughness / glow (see builder.ts),
//  - paint chips and bare-metal edge wear (from screen-space curvature of the bevels),
//  - grime and splashed regolith near the ground,
//  - dust settled on up-facing surfaces (world normal.y + noise), the key grounding trick.

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector3,
  type IUniform,
  type Side,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { bakeTexture } from '../bake';
import { DUST_COLOR } from '../layout';
import type { Quality } from '../types';

// ---- baked textures -----------------------------------------------------------------------------

/** Panel layout shared by the height (normal) and mask bakes. Tiles over the unit square. */
const PANEL_GLSL = /* glsl */ `
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// x: distance to the nearest panel edge, y: panel id, z: kind (0 plain, 1 hatch, 2 vent, 3 doubler)
vec4 panelCell(vec2 uv, out vec2 lp, out vec2 sz) {
  uv = fract(uv);
  // Rows of uneven height (tileable: cut points fixed in [0,1)).
  float r; float y0; float y1;
  if (uv.y < 0.17) { r = 0.0; y0 = 0.0; y1 = 0.17; }
  else if (uv.y < 0.41) { r = 1.0; y0 = 0.17; y1 = 0.41; }
  else if (uv.y < 0.55) { r = 2.0; y0 = 0.41; y1 = 0.55; }
  else if (uv.y < 0.8) { r = 3.0; y0 = 0.55; y1 = 0.8; }
  else { r = 4.0; y0 = 0.8; y1 = 1.0; }
  float hr = hash12(vec2(r, 13.7));
  float cols = hr < 0.45 ? 1.0 : (hr < 0.8 ? 2.0 : 3.0);
  float x = fract(uv.x + hash12(vec2(r, 3.3)));
  float c = floor(x * cols);
  vec2 lo = vec2(c / cols, y0);
  sz = vec2(1.0 / cols, y1 - y0);
  lp = vec2(x, uv.y) - lo;
  float id = hash12(vec2(r * 7.0 + c, 1.7));
  float h2 = hash12(vec2(r, c) + 5.3);
  if (h2 < 0.3) {
    float hh = sz.y * 0.5;
    if (lp.y > hh) { lp.y -= hh; id = fract(id + 0.37); }
    sz.y = hh;
  } else if (h2 > 0.72) {
    float hw = sz.x * (h2 > 0.86 ? 0.35 : 0.5);
    if (lp.x > hw) { lp.x -= hw; sz.x -= hw; id = fract(id + 0.61); } else { sz.x = hw; }
  }
  float d = min(min(lp.x, sz.x - lp.x), min(lp.y, sz.y - lp.y));
  float kind = id < 0.1 ? 1.0 : (id < 0.17 ? 2.0 : (id < 0.27 ? 3.0 : 0.0));
  return vec4(d, id, kind, 0.0);
}
float rivetDist(vec2 lp, vec2 sz) {
  float inset = 0.0075;
  float sp = 0.026;
  float px = (fract(lp.x / sp) - 0.5) * sp;
  float py = (fract(lp.y / sp) - 0.5) * sp;
  float d = 1.0;
  d = min(d, length(vec2(px, lp.y - inset)));
  d = min(d, length(vec2(px, lp.y - (sz.y - inset))));
  d = min(d, length(vec2(lp.x - inset, py)));
  d = min(d, length(vec2(lp.x - (sz.x - inset), py)));
  return d;
}
float panelHeight(vec2 uv) {
  vec2 lp, sz;
  vec4 c = panelCell(uv, lp, sz);
  float seamW = 0.0026;
  float h = smoothstep(0.0, seamW * 2.2, c.x) * 0.0024;
  h += (c.y - 0.5) * 0.00035;
  vec2 q = lp - sz * 0.5;
  if (c.y > 0.3) {
    float rd = rivetDist(lp, sz);
    float rv = 1.0 - smoothstep(0.0, 0.0024, rd);
    h += rv * rv * 0.0011;
  }
  if (c.z == 1.0) {
    float sd = sdRoundRect(q, sz * 0.5 - min(sz.x, sz.y) * 0.18, 0.012);
    h -= (1.0 - smoothstep(0.0, 0.0022, abs(sd))) * 0.0014;
    vec2 corner = abs(q) - (sz * 0.5 - min(sz.x, sz.y) * 0.24);
    h += (1.0 - smoothstep(0.0, 0.003, length(corner))) * 0.0009;
  } else if (c.z == 2.0) {
    float sd = sdRoundRect(q, sz * 0.5 - min(sz.x, sz.y) * 0.22, 0.006);
    if (sd < 0.0) {
      float slat = abs(fract(lp.y / 0.011) - 0.5) * 2.0;
      h -= smoothstep(0.25, 0.75, slat) * 0.0016;
    }
    h -= (1.0 - smoothstep(0.0, 0.002, abs(sd))) * 0.0008;
  } else if (c.z == 3.0) {
    float sd = sdRoundRect(q, sz * 0.5 - min(sz.x, sz.y) * 0.12, 0.02);
    h += (1.0 - smoothstep(-0.003, 0.0, sd)) * 0.0009;
  }
  h += fbmP(uv * 6.0, vec2(6.0), 3) * 0.0005;
  h += fbmP(uv * 96.0, vec2(96.0), 2) * 0.00005;
  return h;
}
`;

function bakePanelNormal(gl: WebGLRenderer, size: number): Texture {
  return bakeTexture(gl, {
    size,
    fragment: /* glsl */ `
      ${PANEL_GLSL}
      vec4 bake(vec2 uv) {
        float e = uTexel;
        float hl = panelHeight(uv - vec2(e, 0.0));
        float hr = panelHeight(uv + vec2(e, 0.0));
        float hd = panelHeight(uv - vec2(0.0, e));
        float hu = panelHeight(uv + vec2(0.0, e));
        vec3 n = normalize(vec3(-(hr - hl) / (2.0 * e), -(hu - hd) / (2.0 * e), 1.0));
        return vec4(n * 0.5 + 0.5, 1.0);
      }`,
  });
}

function bakePanelMask(gl: WebGLRenderer, size: number): Texture {
  return bakeTexture(gl, {
    size,
    fragment: /* glsl */ `
      ${PANEL_GLSL}
      vec4 bake(vec2 uv) {
        vec2 lp, sz;
        vec4 c = panelCell(uv, lp, sz);
        float seam = 1.0 - smoothstep(0.0, 0.006, c.x);
        float streakN = fbmP(vec2(uv.x * 64.0, uv.y * 4.0), vec2(64.0, 4.0), 3) * 0.5 + 0.5;
        float fromTop = exp(-(sz.y - lp.y) * 22.0);
        float rv = c.y > 0.3 ? 1.0 - smoothstep(0.0, 0.006, rivetDist(lp, sz)) : 0.0;
        float blot = smoothstep(0.55, 0.85, fbmP(uv * 8.0 + 3.1, vec2(8.0), 4) * 0.5 + 0.5);
        float grime = clamp(seam * 0.85 + streakN * fromTop * 0.55 + rv * 0.35 + blot * 0.25, 0.0, 1.0);
        float chipN = fbmP(uv * 48.0, vec2(48.0), 4) * 0.5 + 0.5;
        float nearEdge = 1.0 - smoothstep(0.0, 0.018, c.x);
        float chip = smoothstep(0.66, 0.72, chipN + nearEdge * 0.22 + rv * 0.2);
        float rough = clamp((fbmP(uv * 12.0, vec2(12.0), 4)) * 0.9 + 0.5, 0.0, 1.0);
        float tone = c.y;
        return vec4(grime, chip, rough, tone);
      }`,
  });
}

function bakeNoise(gl: WebGLRenderer, size: number): Texture {
  return bakeTexture(gl, {
    size,
    fragment: /* glsl */ `
      float stretch(float x) { return clamp((x - 0.5) * 1.9 + 0.5, 0.0, 1.0); }
      vec4 bake(vec2 uv) {
        float a = stretch(fbmP(uv * 4.0, vec2(4.0), 5) * 0.5 + 0.5);
        float b = stretch(fbmP(uv * 16.0 + 7.0, vec2(16.0), 4) * 0.5 + 0.5);
        vec3 v = voronoiP(uv * 10.0, vec2(10.0));
        float c = stretch(fbmP(uv * 8.0 + 2.0, vec2(8.0), 4) * 0.5 + 0.5) * smoothstep(0.0, 0.5, v.y - v.x + 0.15);
        float d = stretch(fbmP(uv * 64.0, vec2(64.0), 3) * 0.5 + 0.5);
        return vec4(a, b, c, d);
      }`,
  });
}

export interface SurfaceTextures {
  panelNormal: Texture;
  panelMask: Texture;
  noise: Texture;
}

const texCache = new WeakMap<WebGLRenderer, SurfaceTextures>();

export function getSurfaceTextures(gl: WebGLRenderer, quality: Quality): SurfaceTextures {
  const cached = texCache.get(gl);
  if (cached) return cached;
  const size = quality === 'low' ? 512 : 1024;
  const t = { panelNormal: bakePanelNormal(gl, size), panelMask: bakePanelMask(gl, size), noise: bakeNoise(gl, 512) };
  texCache.set(gl, t);
  return t;
}

// ---- hard-surface material ----------------------------------------------------------------------

export interface HardSurfaceOptions {
  /** Metres covered by one plating texture tile. */
  tile: number;
  /** Overall dust on up-facing surfaces, 0..1. */
  dust?: number;
  /** Paint chip / edge wear amount. */
  wear?: number;
  /** Ground height for low grime. */
  groundY?: number;
  /** Height of the grime band above the ground. */
  grimeHeight?: number;
  /** World scale of the dust noise (cycles per metre). */
  dustScale?: number;
  side?: Side;
  /** Back faces read as dark interior (open wreck shells). */
  darkBackFaces?: boolean;
  /** Standard albedo map (needs uv). */
  map?: Texture;
  /** Pad markings: RGB = white paint, yellow paint, scorch, in pad-plane coordinates. */
  pad?: { marks: Texture; centre: Vector3; radius: number };
  /** Decal (painted stencil) mode: alpha-tested map with world-space erosion. */
  decal?: boolean;
}

const VERT_PARS = /* glsl */ `
attribute vec4 aSurf;
attribute float aTile;
varying vec4 vSurf;
varying float vTile;
varying vec3 vHsPos;
varying vec3 vHsNrm;
`;
const VERT_MAIN = /* glsl */ `
{
  vec4 hsW = vec4(transformed, 1.0);
  vec3 hsN = objectNormal;
  #ifdef USE_INSTANCING
    hsW = instanceMatrix * hsW;
    hsN = mat3(instanceMatrix) * hsN;
  #endif
  hsW = modelMatrix * hsW;
  vHsPos = hsW.xyz;
  vHsNrm = normalize(mat3(modelMatrix) * hsN);
  vSurf = aSurf;
  vTile = aTile;
}
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uPanelN;
uniform sampler2D uPanelM;
uniform sampler2D uNoise;
uniform float uTile;
uniform float uDustAmt;
uniform float uWear;
uniform float uGroundY;
uniform float uGrimeH;
uniform float uDustScale;
uniform vec3 uDustCol;
#ifdef HS_PAD
uniform sampler2D uMarks;
uniform vec3 uPadC;
uniform float uPadR;
#endif
varying vec4 vSurf;
varying float vTile;
varying vec3 vHsPos;
varying vec3 vHsNrm;
vec3 hsWeights(vec3 n) { vec3 w = pow(abs(n), vec3(5.0)); return w / (w.x + w.y + w.z + 1e-5); }
// Triplanar fetch that skips projections with negligible weight (most flat faces need one).
// Explicit gradients keep mip selection valid inside the branches.
vec4 hsTri(sampler2D t, vec3 p, vec3 dx, vec3 dy, vec3 w) {
  vec4 r = vec4(0.0);
  if (w.x > 0.02) r += textureGrad(t, p.zy, dx.zy, dy.zy) * w.x;
  if (w.y > 0.02) r += textureGrad(t, p.xz, dx.xz, dy.xz) * w.y;
  if (w.z > 0.02) r += textureGrad(t, p.xy, dx.xy, dy.xy) * w.z;
  return r;
}
`;

const FRAG_COLOR = /* glsl */ `
vec3 hsN0 = normalize(vHsNrm);
#ifdef DOUBLE_SIDED
  hsN0 *= gl_FrontFacing ? 1.0 : -1.0;
#endif
vec3 hsWt = hsWeights(hsN0);
float hsInvTile = 1.0 / (uTile * max(vTile, 0.05));
vec3 hsDpx = dFdx(vHsPos);
vec3 hsDpy = dFdy(vHsPos);
vec3 hsP = vHsPos * hsInvTile;
vec4 hsM = hsTri(uPanelM, hsP, hsDpx * hsInvTile, hsDpy * hsInvTile, hsWt);
float hsPanel = vSurf.z;
float hsNs = 0.21 * uDustScale;
vec4 hsNz = hsTri(uNoise, vHsPos * hsNs, hsDpx * hsNs, hsDpy * hsNs, hsWt);
vec4 hsNzL = texture2D(uNoise, vHsPos.xz * 0.023 * uDustScale);
#ifdef HS_DARK_BACK
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.22;
#endif
#ifdef HS_PAD
  {
    vec2 pd = (vHsPos.xz - uPadC.xz) / (2.0 * uPadR);
    vec3 mk = texture2D(uMarks, vec2(pd.x + 0.5, 0.5 - pd.y)).rgb;
    float keep = smoothstep(0.32, 0.62, texture2D(uNoise, vHsPos.xz * 0.21).a * 0.6 + hsNz.r * 0.55 + 0.05);
    keep *= step(0.6, hsN0.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.565, 0.52), mk.r * keep);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.36, 0.02), mk.g * keep);
    diffuseColor.rgb *= 1.0 - 0.82 * mk.b * (0.75 + 0.25 * hsNz.g);
  }
#endif
// Plating tone and seam grime.
diffuseColor.rgb *= mix(1.0, (0.93 + 0.12 * hsM.a) * (1.0 - 0.32 * hsM.r), hsPanel);
// Broad discolouration.
diffuseColor.rgb *= 0.86 + 0.28 * hsNz.r;
// Paint chips and worn bevel edges show bare metal.
float hsCurv = length(fwidth(hsN0)) / max(length(abs(hsDpx) + abs(hsDpy)), 1e-4);
float hsEdge = smoothstep(4.0, 16.0, hsCurv) * smoothstep(0.4, 0.62, hsNz.a + 0.12);
float hsChip = clamp(hsM.g * 0.85 + hsEdge, 0.0, 1.0) * hsPanel * uWear;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.295, 0.285), hsChip);
// Grime and splashed regolith near the ground.
float hsLow = 1.0 - smoothstep(0.0, uGrimeH, vHsPos.y - uGroundY + (hsNz.g - 0.5) * 0.6 * uGrimeH);
diffuseColor.rgb = mix(diffuseColor.rgb, uDustCol * 0.78, clamp(hsLow, 0.0, 1.0) * 0.75);
// Dust on up-facing surfaces, broken up by noise.
float hsUp = smoothstep(0.3, 0.92, hsN0.y);
float hsDust = clamp(hsUp * uDustAmt * (0.35 + 1.2 * hsNz.b + 0.4 * (hsNzL.a - 0.5)) + hsM.r * hsUp * uDustAmt * 0.35, 0.0, 1.0);
#ifdef HS_PAD
  {
    float pr = length(vHsPos.xz - uPadC.xz);
    hsDust = clamp(hsDust * 0.6 + smoothstep(uPadR - 3.0, uPadR - 0.3, pr) * (0.25 + 0.75 * hsNz.b), 0.0, 1.0);
  }
#endif
diffuseColor.rgb = mix(diffuseColor.rgb, uDustCol * (0.92 + 0.16 * hsNz.a), hsDust);
#ifdef HS_DECAL
  diffuseColor.a *= smoothstep(0.1, 0.24, hsNz.a * 0.6 + hsNz.r * 0.4) * (1.0 - hsM.g * 0.8);
  diffuseColor.a *= 1.0 - hsDust * 0.6;
#endif
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = clamp(vSurf.y + ((hsM.b - 0.5) * 0.3 + hsM.r * 0.18) * hsPanel + (hsNz.g - 0.5) * 0.12, 0.03, 1.0);
roughnessFactor = mix(roughnessFactor, 0.42, hsChip * 0.7);
roughnessFactor = mix(roughnessFactor, 0.97, max(hsDust, clamp(hsLow, 0.0, 1.0) * 0.7));
`;

const FRAG_METAL = /* glsl */ `
metalnessFactor = mix(vSurf.x, 0.9, hsChip * 0.85) * (1.0 - hsDust) * (1.0 - clamp(hsLow, 0.0, 1.0) * 0.6);
`;

const FRAG_NORMAL = /* glsl */ `
{
  float k = hsPanel * (1.0 - hsDust * 0.75) * 1.25;
  if (k > 0.01) {
    vec3 dx = hsDpx * hsInvTile;
    vec3 dy = hsDpy * hsInvTile;
    vec3 acc = vec3(0.0);
    if (hsWt.x > 0.02) {
      vec3 tx = textureGrad(uPanelN, hsP.zy, dx.zy, dy.zy).xyz * 2.0 - 1.0;
      tx.xy *= k;
      acc += vec3(tx.xy + hsN0.zy, abs(tx.z) * hsN0.x).zyx * hsWt.x;
    }
    if (hsWt.y > 0.02) {
      vec3 ty = textureGrad(uPanelN, hsP.xz, dx.xz, dy.xz).xyz * 2.0 - 1.0;
      ty.xy *= k;
      acc += vec3(ty.xy + hsN0.xz, abs(ty.z) * hsN0.y).xzy * hsWt.y;
    }
    if (hsWt.z > 0.02) {
      vec3 tz = textureGrad(uPanelN, hsP.xy, dx.xy, dy.xy).xyz * 2.0 - 1.0;
      tz.xy *= k;
      acc += vec3(tz.xy + hsN0.xy, abs(tz.z) * hsN0.z) * hsWt.z;
    }
    normal = normalize((viewMatrix * vec4(normalize(acc), 0.0)).xyz);
  } else {
    normal = normalize((viewMatrix * vec4(hsN0, 0.0)).xyz);
  }
}
`;

const FRAG_EMIT = /* glsl */ `
totalEmissiveRadiance += vColor.rgb * vSurf.w;
`;

/** Shared uniforms so look-dev / gameplay can tweak dust globally. */
export const propUniforms = {
  uDustCol: { value: DUST_COLOR.clone() } as IUniform<Color>,
};

/**
 * Look-dev debugging. `leak`: every prop material renders both sides and paints back faces
 * bright magenta, so any place where the camera can see *into* an object (an open end, a slit
 * between panels, a missing face) lights up. Set before createProps().
 */
export const propsDebug = { leak: false };

const LEAK_GLSL = /* glsl */ `
#ifdef HS_LEAK
  if (!gl_FrontFacing) gl_FragColor = vec4(6.0, 0.0, 6.0, 1.0);
#endif
`;

/** Debug only: paint back faces of any material magenta (see propsDebug.leak). */
export function applyLeakDebug(mat: MeshStandardMaterial): void {
  if (!propsDebug.leak) return;
  mat.side = DoubleSide;
  mat.defines = { ...(mat.defines ?? {}), HS_LEAK: '' };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${LEAK_GLSL}`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}-leak`;
}

export function createHardSurfaceMaterial(tex: SurfaceTextures, o: HardSurfaceOptions): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0,
    vertexColors: true,
    side: o.side ?? FrontSide,
    map: o.map ?? null,
  });
  if (o.decal) {
    mat.alphaTest = 0.5;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -4;
  }
  const uniforms: Record<string, IUniform> = {
    uPanelN: { value: tex.panelNormal },
    uPanelM: { value: tex.panelMask },
    uNoise: { value: tex.noise },
    uTile: { value: o.tile },
    uDustAmt: { value: o.dust ?? 0.7 },
    uWear: { value: o.wear ?? 1 },
    uGroundY: { value: o.groundY ?? 0 },
    uGrimeH: { value: o.grimeHeight ?? 1.4 },
    uDustScale: { value: o.dustScale ?? 1 },
    uDustCol: propUniforms.uDustCol,
  };
  const defines: Record<string, string> = {};
  if (o.pad) {
    uniforms.uMarks = { value: o.pad.marks };
    uniforms.uPadC = { value: o.pad.centre };
    uniforms.uPadR = { value: o.pad.radius };
    defines.HS_PAD = '';
  }
  if (o.darkBackFaces) defines.HS_DARK_BACK = '';
  if (o.decal) defines.HS_DECAL = '';
  mat.defines = { ...(mat.defines ?? {}), ...defines };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_METAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMIT}`);
    if (!o.decal) frag = frag.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `hs-props-v2-${o.decal ? 'd' : ''}${o.pad ? 'p' : ''}${o.darkBackFaces ? 'b' : ''}`;
  // Decals are paint: single-sided by nature, so the leak check leaves them alone.
  if (!o.decal) applyLeakDebug(mat);
  return mat;
}

// ---- glass --------------------------------------------------------------------------------------

/** Reflective cockpit glass: dark tint, mirror-like clearcoat, faint instrument glow inside. */
export function createCanopyGlass(): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({
    color: new Color('#0d1217'),
    roughness: 0.05,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    ior: 1.52,
    specularIntensity: 1,
    envMapIntensity: 1.6,
    emissive: new Color('#0a2228'),
    emissiveIntensity: 0.35,
  });
  applyLeakDebug(mat);
  return mat;
}

// ---- light cones --------------------------------------------------------------------------------

/**
 * Additive cone of light for floodlights (no real light needed). uv.y: 1 at the lamp, 0 at the
 * far end. Steady: floodlights never flicker (a flickering outpost light read as a glitch).
 */
export function createLightConeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new Color('#cfe0ff') }, uIntensity: { value: 0.05 } },
    vertexShader: /* glsl */ `
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vT = 1.0 - uv.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        // Clamp everything that feeds pow(): interpolation can push varyings a hair out of range,
        // and pow() of a negative number is NaN on real GPUs.
        float t = clamp(vT, 0.0, 1.0);
        float facing = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
        float edge = pow(facing, 2.2);
        float along = pow(1.0 - t, 1.4) * smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.75, 1.0, t) * 0.6);
        gl_FragColor = vec4(uColor * uIntensity * edge * along, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

// ---- animated point lights (beacons, strobes, failing lamps) -------------------------------------

/**
 * Glow sprites: aParams = (size m, mode, phase, min px). Modes (see GlowMode in fx.ts):
 * 0 steady, 1 beacon (slow red pulse), 2 failing (subtle: a slow uneven shimmer between ~80 and
 * 100% with a brief soft dip every few seconds; never a hard on/off flicker), 3 strobe (double
 * flash, each flash long enough to survive 20-30 fps). All modulation is continuous in time, so
 * it looks the same at any frame rate.
 */
export function createGlowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute vec4 aParams;
      uniform float uTime;
      uniform float uScale;
      varying vec3 vCol;
      // Sin-free hash (stable for large inputs on every GPU).
      float h1(float n) { n = fract(n * 0.1031); n *= n + 33.33; n *= n + n; return fract(n); }
      float vnoise(float x) { float i = floor(x); float f = x - i; f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float t = uTime + aParams.z;
        float k = 1.0;
        int mode = int(aParams.y + 0.5);
        if (mode == 1) {
          float c = fract(t / 1.7);
          k = smoothstep(0.0, 0.02, c) * (1.0 - smoothstep(0.1, 0.32, c)) + 0.04;
        } else if (mode == 2) {
          float seed = aParams.z * 13.7;
          k = 0.8 + 0.2 * vnoise(t * 1.9 + seed);
          float c = fract(t / (5.5 + 3.0 * h1(seed)));
          k *= 1.0 - 0.4 * smoothstep(0.0, 0.015, c) * (1.0 - smoothstep(0.03, 0.07, c));
        } else if (mode == 3) {
          float c = fract(t / 1.3);
          k = (c < 0.055 || (c > 0.12 && c < 0.175)) ? 1.0 : 0.0;
        }
        vCol = aColor * k;
        float px = aParams.x * uScale / max(-mv.z, 0.1);
        float size = max(px, aParams.w);
        // Keep energy roughly constant when clamped to the minimum size.
        vCol *= min(1.0, pow(clamp(px / size, 0.0, 1.0), 0.6) + 0.35);
        gl_PointSize = size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        vec2 d = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(d, d);
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 9.0) * 0.35 + exp(-r2 * 45.0);
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

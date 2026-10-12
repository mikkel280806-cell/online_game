// Materials for the EVA suit.
//
// The whole suit is ONE skinned draw call: a MeshStandardMaterial extended with per-vertex
// surface data (roughness, metalness, surface type, edge wear, emissive, AO, dirt). Surface
// types pick a baked tileable detail texture (fabric weave + seams, painted shell, brushed
// metal) and get weathering: chipped paint on shell edges, dust on up-facing surfaces, grime
// on the boots and lower legs. The visor is a separate physical (clearcoat) material.
//
// Textures are baked on the GPU with bakeTexture() the first time a suit is rendered (the
// Avatar API has no renderer), or earlier via prewarmSuitTextures(renderer).

import {
  Color,
  DataTexture,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RGBAFormat,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { bakeTexture } from '../env/bake';
import { DUST_COLOR } from '../env/layout';

/** Surface types, stored per vertex. */
export const SURF = { fabric: 0, shell: 1, metal: 2, rubber: 3, hose: 4, glass: 5 } as const;
export type SurfType = (typeof SURF)[keyof typeof SURF];

/** Emissive channels, scaled per avatar by uEmitGain. */
export const EMIT = { strip: 0, lamp: 1, screen: 2 } as const;

const flat = () => {
  const t = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat);
  t.needsUpdate = true;
  return t;
};

/** Shared texture uniforms (all suits). Values are swapped for baked textures on first render. */
const shared = {
  uFabric: { value: flat() as Texture } as IUniform<Texture>,
  uHard: { value: flat() as Texture } as IUniform<Texture>,
  uMetal: { value: flat() as Texture } as IUniform<Texture>,
  uDust: { value: DUST_COLOR.clone() } as IUniform<Color>,
};
let baked = false;

// ---------------------------------------------------------------------------------------------
// Baked textures. RGB = tangent-space normal, A = a mask (see each).

const HEIGHT_TO_NORMAL = /* glsl */ `
vec4 bake(vec2 uv) {
  float h0 = height(uv);
  float hx = height(uv + vec2(uTexel, 0.0));
  float hy = height(uv + vec2(0.0, uTexel));
  vec3 n = normalize(vec3((h0 - hx) * STRENGTH, (h0 - hy) * STRENGTH, 1.0));
  return vec4(n * 0.5 + 0.5, mask(uv));
}`;

/** Fabric: plain weave with a ripstop grid, panel seams with welts and stitching, soft folds. A = cavity. */
const FABRIC_GLSL = /* glsl */ `
#define STRENGTH 260.0
const float N = 120.0;
float threadH(vec2 uv) {
  vec2 p = uv * N;
  vec2 f = fract(p) - 0.5;
  vec2 c = floor(p);
  float alt = mod(c.x + c.y, 2.0);
  float warp = 1.0 - 4.0 * f.x * f.x;
  float weft = 1.0 - 4.0 * f.y * f.y;
  float over = mix(warp * (0.55 + 0.45 * cos(f.y * 3.14159)), weft * (0.55 + 0.45 * cos(f.x * 3.14159)), alt);
  return over;
}
float ripstop(vec2 uv) {
  vec2 g = abs(fract(uv * N / 10.0 + 0.5) - 0.5) * 10.0; // distance in threads to the grid line
  float l = max(1.0 - smoothstep(0.3, 1.1, g.x), 1.0 - smoothstep(0.3, 1.1, g.y));
  return l;
}
float seamDist(float x) { return min(fract(x), 1.0 - fract(x)); }
float seam(vec2 uv, out float stitch, out float groove) {
  float dx = seamDist(uv.x);
  float dy = seamDist(uv.y);
  float d = min(dx, dy);
  float along = dx < dy ? uv.y : uv.x;
  groove = 1.0 - smoothstep(0.0, 0.009, d);
  float welt = smoothstep(0.005, 0.014, d) * (1.0 - smoothstep(0.02, 0.045, d));
  float sd = abs(d - 0.026);
  stitch = (1.0 - smoothstep(0.002, 0.0045, sd)) * step(0.45, fract(along * 70.0));
  return welt * 0.9 - groove * 1.2 - stitch * 0.35;
}
float folds(vec2 uv) {
  float a = fbmP(uv * vec2(3.0, 4.0), vec2(3.0, 4.0), 3);
  float b = gnoiseP(vec2(uv.x * 2.0, uv.y * 7.0), vec2(2.0, 7.0));
  return a * 0.7 + b * 0.5;
}
float height(vec2 uv) {
  float st, gr;
  float s = seam(uv, st, gr);
  return threadH(uv) * 0.007 + ripstop(uv) * 0.005 + s * 0.030 + folds(uv) * 0.3;
}
float mask(vec2 uv) {
  float st, gr;
  seam(uv, st, gr);
  float weaveGap = 1.0 - threadH(uv);
  float grime = fbmP(uv * 5.0, vec2(5.0), 4) * 0.5 + 0.5;
  return clamp(1.0 - gr * 0.55 - weaveGap * 0.12 - st * 0.15 - (1.0 - grime) * 0.25, 0.0, 1.0);
}
${HEIGHT_TO_NORMAL}`;

/** Painted hard shell: orange peel, soft dents, fine scratches. A = paint-chip mask noise. */
const HARD_GLSL = /* glsl */ `
#define STRENGTH 70.0
float scratches(vec2 uv) {
  float s1 = pow(max(1.0 - abs(gnoiseP(vec2(uv.x * 3.0, uv.y * 90.0), vec2(3.0, 90.0))), 0.0), 40.0);
  vec2 r = vec2(uv.x + uv.y, uv.x - uv.y);
  float s2 = pow(max(1.0 - abs(gnoiseP(vec2(r.x * 70.0, r.y * 2.0), vec2(70.0, 2.0))), 0.0), 50.0);
  float m = smoothstep(0.1, 0.5, fbmP(uv * 4.0, vec2(4.0), 3));
  return (s1 + s2) * m;
}
float height(vec2 uv) {
  float peel = gnoiseP(uv * 64.0, vec2(64.0)) * 0.004;
  float dents = fbmP(uv * 2.0, vec2(2.0), 3) * 0.12;
  return peel + dents - scratches(uv) * 0.02;
}
float mask(vec2 uv) {
  return clamp(fbmP(uv * 7.0, vec2(7.0), 5) * 0.7 + 0.5 + scratches(uv) * 0.3, 0.0, 1.0);
}
${HEIGHT_TO_NORMAL}`;

/** Brushed metal: fine lines along U. A = roughness variation. */
const METAL_GLSL = /* glsl */ `
#define STRENGTH 90.0
float height(vec2 uv) {
  float a = gnoiseP(vec2(uv.x * 4.0, uv.y * 128.0), vec2(4.0, 128.0));
  float b = gnoiseP(vec2(uv.x * 9.0, uv.y * 256.0), vec2(9.0, 256.0));
  return a * 0.012 + b * 0.006 + fbmP(uv * 6.0, vec2(6.0), 2) * 0.02;
}
float mask(vec2 uv) { return clamp(fbmP(uv * 5.0, vec2(5.0), 4) * 0.6 + 0.5, 0.0, 1.0); }
${HEIGHT_TO_NORMAL}`;

/** Bake the suit's detail textures now (otherwise it happens on the first render). */
export function prewarmSuitTextures(gl: WebGLRenderer): void {
  if (baked) return;
  baked = true;
  shared.uFabric.value = bakeTexture(gl, { size: 1024, fragment: FABRIC_GLSL });
  shared.uHard.value = bakeTexture(gl, { size: 512, fragment: HARD_GLSL });
  shared.uMetal.value = bakeTexture(gl, { size: 512, fragment: METAL_GLSL });
}

// ---------------------------------------------------------------------------------------------
// Suit shader.

const VERT_PARS = /* glsl */ `
attribute vec4 surf;
attribute vec4 emit;
attribute vec2 aux;
varying vec4 vSurf;
varying vec4 vEmit;
varying vec3 vBind;
varying vec2 vAux;
varying vec2 vUvM;
`;

const VERT_MAIN = /* glsl */ `
vSurf = surf;
vEmit = emit;
vBind = position;
vAux = aux;
vUvM = uv;
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uFabric;
uniform sampler2D uHard;
uniform sampler2D uMetal;
uniform vec3 uDust;
uniform vec3 uEmitGain;
varying vec4 vSurf;
varying vec4 vEmit;
varying vec3 vBind;
varying vec2 vAux;
varying vec2 vUvM;

float sHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float sNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
mat3 suitTBN(vec3 eye, vec3 N, vec2 uv) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * s, B * s, N);
}
`;

// Runs after <color_fragment>: decides albedo, roughness, metalness, detail normal and AO.
const FRAG_SURFACE = /* glsl */ `
float sType = vSurf.z;
float sRough = vSurf.x;
float sMetal = vSurf.y;
float sAO = vAux.x;
vec3 sN = vec3(0.0, 0.0, 1.0);
vec3 base = diffuseColor.rgb;
vec3 wN = inverseTransformDirection(normalize(vNormal), viewMatrix);
float nA = sNoise(vBind * 19.0);
float nB = sNoise(vBind * 5.0 + 3.1);
if (sType < 0.5) {
  // Fabric.
  vec4 t = texture2D(uFabric, vUvM);
  sN = t.xyz * 2.0 - 1.0;
  base *= mix(0.72, 1.0, t.a) * mix(0.94, 1.03, nB);
  sRough = clamp(sRough + (1.0 - t.a) * 0.1, 0.0, 1.0);
  sAO *= mix(0.55, 1.0, t.a);
} else if (sType < 1.5) {
  // Painted shell: sparse chips on edges show grey primer, faint grime in the scratches.
  vec4 t = texture2D(uHard, vUvM);
  sN = t.xyz * 2.0 - 1.0;
  sN.xy *= 0.55;
  float chipN = t.a * 0.8 + vSurf.w * 0.2 + nA * 0.07;
  float chip = smoothstep(0.87, 0.9, chipN);
  vec3 primer = vec3(0.3, 0.3, 0.31);
  base = mix(base * mix(0.95, 1.03, nB), primer, chip);
  sRough = mix(sRough + (t.a - 0.5) * 0.1, 0.62, chip);
  base *= 1.0 - 0.06 * vSurf.w;
} else if (sType < 2.5) {
  // Brushed metal.
  vec4 t = texture2D(uMetal, vUvM);
  sN = t.xyz * 2.0 - 1.0;
  sRough = clamp(sRough * mix(0.75, 1.25, t.a), 0.05, 1.0);
  base *= mix(0.9, 1.05, t.a);
} else if (sType < 3.5) {
  // Rubber / dark polymer.
  vec4 t = texture2D(uHard, vUvM * 2.3);
  sN = t.xyz * 2.0 - 1.0;
  sN.xy *= 0.5;
  sRough = clamp(sRough + (t.a - 0.5) * 0.15, 0.0, 1.0);
} else if (sType < 4.5) {
  // Corrugated hose: analytic ridges along U.
  float ph = vUvM.x * 6.2831853;
  sN = normalize(vec3(sin(ph) * 0.85, 0.0, 1.0));
  sAO *= 0.8 + 0.2 * cos(ph);
}
sN = normalize(sN);

// Weathering: grime rises from the boots, a little dust settles on up-facing surfaces.
float low = 1.0 - smoothstep(0.0, 0.46, vBind.y);
float grime = low * low * (0.45 + 0.55 * nB) * (0.8 + 0.4 * nA);
float up = smoothstep(0.8, 0.98, wN.y) * smoothstep(0.5, 0.85, nB) * 0.28;
float dirt = clamp(max(grime, up) * vAux.y, 0.0, 1.0);
base = mix(base, uDust * mix(0.75, 1.0, nA), dirt * 0.78);
sRough = mix(sRough, 0.95, dirt);
sMetal *= 1.0 - dirt;
diffuseColor.rgb = base;
`;

const FRAG_NORMAL = /* glsl */ `
{
  mat3 sT = suitTBN(-vViewPosition, normal, vUvM);
  normal = normalize(sT * sN);
}
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  float ch = vEmit.w;
  float gain = ch < 0.5 ? uEmitGain.x : (ch < 1.5 ? uEmitGain.y : uEmitGain.z);
  if (ch > 1.5) {
    // Display: dim backlight with brighter readout rows and a border.
    vec2 q = fract(vUvM);
    float rows = step(0.45, fract(q.y * 5.0)) * step(0.12, q.x) * step(q.x, 0.2 + 0.7 * fract(sin(floor(q.y * 5.0) * 12.9898) * 43758.5453));
    float frame = 1.0 - step(0.06, q.x) * step(q.x, 0.94) * step(0.06, q.y) * step(q.y, 0.94);
    gain *= 0.18 + 0.82 * max(rows, frame * 0.6);
  }
  totalEmissiveRadiance += vEmit.rgb * gain;
}
`;

const FRAG_AO = /* glsl */ `
reflectedLight.indirectDiffuse *= sAO;
reflectedLight.indirectSpecular *= mix(1.0, sAO, 0.7);
reflectedLight.directDiffuse *= mix(1.0, sAO, 0.35);
`;

export interface SuitMaterial extends MeshStandardMaterial {
  userData: { emitGain: IUniform<Color> };
}

/** The suit's uber-material. One per avatar so emissive channels can be driven independently. */
export function createSuitMaterial(): SuitMaterial {
  const emitGain: IUniform<Color> = { value: new Color(1, 1, 1) };
  const m = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0 }) as SuitMaterial;
  m.name = 'eva-suit';
  m.userData.emitGain = emitGain;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFabric = shared.uFabric;
    shader.uniforms.uHard = shared.uHard;
    shader.uniforms.uMetal = shared.uMetal;
    shader.uniforms.uDust = shared.uDust;
    shader.uniforms.uEmitGain = emitGain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(sRough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = clamp(sMetal, 0.0, 1.0);')
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_AO}`);
  };
  m.customProgramCacheKey = () => 'eva-suit-v1';
  // Bake the shared detail textures the first time any suit is drawn.
  m.onBeforeRender = (renderer) => {
    if (!baked) prewarmSuitTextures(renderer);
  };
  return m;
}

let visor: MeshPhysicalMaterial | null = null;

/** Gold-coated sun visor: mirror-like, tinted reflections, clear protective coat. */
export function visorMaterial(): MeshPhysicalMaterial {
  if (!visor) {
    visor = new MeshPhysicalMaterial({
      name: 'eva-visor',
      color: new Color(0.95, 0.66, 0.3),
      metalness: 1,
      roughness: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.5,
      emissive: new Color(0.02, 0.012, 0.004),
    });
  }
  return visor;
}

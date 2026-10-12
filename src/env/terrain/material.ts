// Ground and rock materials: MeshStandardMaterial with the map / roughness / normal stages
// replaced (via onBeforeCompile) by world-space projected, GPU-baked textures. Everything
// else (lights, shadows, fog, IBL, tone mapping) stays three's standard code.
//
// Ground: regolith (top projection, 3 scales mixed by distance and noise) blended with
// layered basalt (triplanar) by slope, per-vertex rock exposure and texture heights; macro
// albedo/roughness variation; frost in shadowed hollows. Rocks: triplanar basalt with dust
// settled on top and around the base.
//
// Both also take the baked terrain sun-occlusion (sunshadow.ts) on the key light, so long
// mountain and crater shadows exist at every distance, beyond the reach of shadow maps.

import { Color, MeshStandardMaterial, ShaderChunk, type IUniform, type WebGLProgramParametersWithUniforms } from 'three';
import { SUN_DIR } from '../layout';
import { MACRO_TILE, REGOLITH_TILE, ROCK_TILE, type TerrainTextures } from './textures';
import type { SunShadow } from './sunshadow';

const FROST = new Color('#b9c4cc');

/** Shared debug view switch: 0 off, 1 sun visibility, 2 rock blend, 3 albedo. */
const debugUniform: IUniform<number> = { value: 0 };
export function setTerrainDebug(mode: number): void {
  debugUniform.value = mode;
}

const PARS_FRAGMENT = /* glsl */ `
uniform sampler2D tRegA;
uniform sampler2D tRegN;
uniform sampler2D tRockA;
uniform sampler2D tRockN;
uniform sampler2D tMacro;
uniform sampler2D tSunA;
uniform sampler2D tSunB;
uniform vec4 uSunGrid;    // (halfA, halfB, sunHx, sunHz)
uniform vec3 uSunDirW;
uniform vec3 uFrost;
uniform float uTerrainDebug;
varying vec3 vTWorldPos;
varying vec3 vTWorldNormal;
#ifdef TERRAIN_GROUND
varying vec4 vTerrain;
#else
varying float vRockH;
#endif

float tSunVis = 1.0;

mat2 tRot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Visibility of the sun disc from the baked horizon heights (two elevations across the disc).
float terrainSunVisibility(vec3 wp) {
  vec2 q = vec2(dot(wp.xz, uSunGrid.zw), dot(wp.xz, vec2(-uSunGrid.w, uSunGrid.z)));
  vec2 uvA = q / (2.0 * uSunGrid.x) + 0.5;
  vec2 uvB = q / (2.0 * uSunGrid.y) + 0.5;
  vec2 hA = texture2D(tSunA, uvA).rg;
  vec2 hB = texture2D(tSunB, uvB).rg;
  vec2 ea = abs(uvA - 0.5);
  float inA = 1.0 - smoothstep(0.44, 0.495, max(ea.x, ea.y));
  vec2 H = mix(hB, hA, inA);
  float vis = clamp((wp.y + 0.2 - H.y) / max(H.x - H.y, 0.25), 0.0, 1.0);
  vec2 eb = abs(uvB - 0.5);
  return mix(vis, 1.0, smoothstep(0.47, 0.5, max(eb.x, eb.y)));
}

// Applied to directional/sun lights pointing along SUN_DIR only.
float terrainSunMask(vec3 dirView) {
  vec3 dW = normalize((vec4(dirView, 0.0) * viewMatrix).xyz);
  return mix(1.0, tSunVis, smoothstep(0.995, 0.9995, dot(dW, uSunDirW)));
}

// Top-down projection with rotation and offset; returns albedo+rough, normal xy (world xz) and height.
void tSampleTop(sampler2D tA, sampler2D tN, vec2 xz, float scale, float ang, vec2 off, float lod, out vec4 A, out vec3 N) {
  mat2 R = tRot(ang);
  vec2 uv = R * xz / scale + off;
  A = texture2D(tA, uv, lod);
  vec4 n = texture2D(tN, uv, lod);
  N = vec3(transpose(R) * (n.xy * 2.0 - 1.0), n.a);
}

// Triplanar basalt (whiteout normal blend, Ben Golus). Returns albedo+rough and world normal; height in H.
vec4 tRockTriplanar(vec3 wp, vec3 n, float scale, float strength, out vec3 N, out float H) {
  vec3 w = pow(abs(n), vec3(6.0));
  w /= (w.x + w.y + w.z);
  // Skip projections that barely contribute (most pixels need one or two).
  w *= step(vec3(0.03), w);
  w /= (w.x + w.y + w.z);
  vec3 s = sign(n);
  s = mix(vec3(1.0), s, step(vec3(0.0001), abs(s)));
  vec4 A = vec4(0.0);
  vec3 nsum = vec3(0.0);
  H = 0.0;
  if (w.x > 0.0) {
    vec2 uv = vec2(wp.z * s.x, wp.y) / scale;
    vec4 a = texture2D(tRockA, uv), t = texture2D(tRockN, uv);
    vec3 tn = vec3((t.xy * 2.0 - 1.0) * strength, t.z * 2.0 - 1.0);
    tn.x *= s.x;
    tn = vec3(tn.xy + n.zy, abs(tn.z) * n.x);
    A += a * w.x; nsum += tn.zyx * w.x; H += t.a * w.x;
  }
  if (w.y > 0.0) {
    vec2 uv = vec2(wp.x * s.y, wp.z) / scale + 0.31;
    vec4 a = texture2D(tRockA, uv), t = texture2D(tRockN, uv);
    vec3 tn = vec3((t.xy * 2.0 - 1.0) * strength, t.z * 2.0 - 1.0);
    tn.x *= s.y;
    tn = vec3(tn.xy + n.xz, abs(tn.z) * n.y);
    A += a * w.y; nsum += tn.xzy * w.y; H += t.a * w.y;
  }
  if (w.z > 0.0) {
    vec2 uv = vec2(-wp.x * s.z, wp.y) / scale + 0.57;
    vec4 a = texture2D(tRockA, uv), t = texture2D(tRockN, uv);
    vec3 tn = vec3((t.xy * 2.0 - 1.0) * strength, t.z * 2.0 - 1.0);
    tn.x *= -s.z;
    tn = vec3(tn.xy + n.xy, abs(tn.z) * n.z);
    A += a * w.z; nsum += tn.xyz * w.z; H += t.a * w.z;
  }
  N = normalize(nsum);
  return A;
}

vec3 tAlbedo;
float tRough;
vec3 tWorldN;
float tAO;

void terrainSurface() {
  vec3 wp = vTWorldPos;
  vec3 gN = normalize(vTWorldNormal);
  float dist = length(cameraPosition - wp);
  vec2 xz = wp.xz;

  vec4 mac = texture2D(tMacro, xz / ${MACRO_TILE.toFixed(1)});
  vec4 mac2 = texture2D(tMacro, tRot(0.9) * xz / ${(MACRO_TILE * 5.7).toFixed(1)} + 0.43);
  vec4 mac3 = texture2D(tMacro, tRot(2.1) * xz / ${(MACRO_TILE * 0.21).toFixed(1)} + 0.11);

  // ---- where does bare rock show? ----
  float slope = 1.0 - gN.y;
  float noiseB = (mac3.a - 0.5) * 0.35 + (mac.b - 0.5) * 0.25;
  #ifdef TERRAIN_GROUND
    float exposed = vTerrain.x;
    float rockMask = smoothstep(0.11, 0.3, slope + noiseB * 0.45);
    rockMask = max(rockMask, exposed * smoothstep(0.1, 0.45, exposed + noiseB) * smoothstep(0.0, 0.08, slope + noiseB * 0.2));
    // Dust settles on flat tops even of exposed rock.
    rockMask *= 1.0 - smoothstep(0.94, 0.995, gN.y) * 0.6;
  #else
    // Rocks: dust on upward faces and around the buried base.
    float topDust = smoothstep(0.55, 0.9, gN.y + noiseB * 0.6);
    float baseDust = 1.0 - smoothstep(0.1, 0.32, vRockH + noiseB * 0.25);
    float rockMask = 1.0 - max(topDust * 0.85, baseDust * 0.9);
  #endif

  // ---- rock (triplanar, up to three scales; skipped where there is none) ----
  vec4 rockA = vec4(0.0);
  vec3 rockN = gN;
  float rockH = 0.0;
  if (rockMask > 0.01) {
    vec3 rN1, rN2, rN3;
    float rH1, rH2, rH3;
    float fNear = 1.0 - smoothstep(40.0, 140.0, dist);
    float fFar = smoothstep(250.0, 1200.0, dist);
    #ifdef TERRAIN_ROCK
      fFar = 0.0;
    #endif
    rockA = tRockTriplanar(wp + 13.7, gN, ${(ROCK_TILE * 5.3).toFixed(1)}, 1.0, rockN, rH2);
    rockH = rH2;
    if (fNear > 0.0) {
      vec4 rA = tRockTriplanar(wp, gN, ${ROCK_TILE.toFixed(1)}, 1.0, rN1, rH1);
      float k = fNear * 0.6;
      rockA = mix(rockA, rA, k);
      rockN = normalize(mix(rockN, rN1, k));
      rockH = mix(rockH, rH1, k);
    }
    if (fFar > 0.0) {
      vec4 rA3 = tRockTriplanar(wp + 71.3, gN, ${(ROCK_TILE * 31.0).toFixed(1)}, 1.0, rN3, rH3);
      rockA = mix(rockA, rA3, fFar * 0.85);
      rockN = normalize(mix(rockN, rN3, fFar * 0.8));
    }
    rockA.rgb *= 0.85 + 0.3 * rH2;
  }

  // ---- regolith (top projection, three scales, interleaved by noise) ----
  vec4 regA = vec4(0.0);
  vec3 gNt = vec3(0.0);
  float il = smoothstep(0.3, 0.7, mac3.b);
  float w1 = (1.0 - smoothstep(18.0, 80.0, dist)) * mix(0.8, 0.45, il);
  float w3 = smoothstep(60.0, 400.0, dist);
  float w2 = (1.0 - w1) * (1.0 - w3);
  w1 *= 1.0 - w3;
  #ifdef TERRAIN_ROCK
    // Dust on rocks: one scale is plenty.
    w1 = 0.0; w2 = 1.0; w3 = 0.0;
  #endif
  vec4 sA;
  vec3 sN;
  float microVis = 1.0;
  if (w1 > 0.0) {
    tSampleTop(tRegA, tRegN, xz, ${REGOLITH_TILE.toFixed(1)}, 0.0, vec2(0.0), 0.0, sA, sN);
    regA += sA * w1; gNt += sN * w1;
    #ifdef TERRAIN_GROUND
      // Micro-shadows: is the texture surface a few cm toward the sun higher than the sun ray?
      // (height channel: 1 unit = 5 cm; the sun climbs ~1 cm per 5 cm at this elevation)
      float hs = texture2D(tRegN, (xz + uSunGrid.zw * 0.05) / ${REGOLITH_TILE.toFixed(1)}).a;
      microVis = 1.0 - smoothstep(0.12, 0.4, hs - sN.z) * 0.75 * w1 * (1.0 - smoothstep(10.0, 40.0, dist));
    #endif
  }
  if (w2 > 0.0) {
    // Blurred a little: its magnified pebbles would read as flat pancakes; real ones are geometry.
    tSampleTop(tRegA, tRegN, xz, ${(REGOLITH_TILE * 2.83).toFixed(2)}, 0.61, vec2(0.37, 0.11), 1.3, sA, sN);
    regA += sA * w2; gNt += sN * vec3(0.8, 0.8, 1.0) * w2;
  }
  if (w3 > 0.0) {
    tSampleTop(tRegA, tRegN, xz, ${(REGOLITH_TILE * 13.9).toFixed(2)}, 2.03, vec2(0.71, 0.53), 0.0, sA, sN);
    regA += sA * w3; gNt += sN * vec3(0.6, 0.6, 1.0) * w3;
  }
  float regH = gNt.z;
  #ifdef TERRAIN_GROUND
    // Drifted dust is smoother and slightly paler.
    float drift = vTerrain.w;
    gNt.xy *= 1.0 - 0.35 * drift;
    regA.rgb *= 1.0 + 0.05 * drift;
    // Broad, soft undulation (metres): the ground is never billiard-table flat, and the
    // grazing sun shows it.
    float fu = 1.0 - smoothstep(80.0, 300.0, dist);
    if (fu > 0.0) {
      vec4 und = texture2D(tRegN, tRot(2.6) * xz / 53.0 + 0.19, 3.5);
      gNt.xy += transpose(tRot(2.6)) * (und.xy * 2.0 - 1.0) * 1.3 * fu;
    }
  #endif
  vec3 regN = normalize(vec3(gNt.x + gN.x, abs(gN.y), gNt.y + gN.z));

  float t = rockMask > 0.01 ? clamp((rockMask - 0.5) * 4.0 + (rockH - regH) * 2.5 + 0.5, 0.0, 1.0) : 0.0;

  #ifdef TERRAIN_ROCK
    // A fine film of dust over every boulder ties it to the ground.
    rockA.rgb = mix(rockA.rgb, regA.rgb, 0.28);
  #endif
  vec3 albedo = mix(regA.rgb, rockA.rgb, t);
  float rough = mix(regA.a, rockA.a, t);
  vec3 n = normalize(mix(regN, rockN, t));

  // ---- macro variation: no two hectares look the same ----
  vec4 mac4 = texture2D(tMacro, tRot(1.3) * xz / 41.0 + 0.27);
  float tone = (mac.r - 0.5) * 0.32 + (mac2.r - 0.5) * 0.4 + (mac3.g - 0.5) * 0.14 + (mac4.r - 0.5) * 0.22;
  // Patches of darker, finer dust a few metres across.
  tone -= smoothstep(0.52, 0.66, mac4.g) * 0.07;
  albedo *= 1.0 + tone;
  albedo *= mix(vec3(1.035, 1.0, 0.95), vec3(0.96, 0.985, 1.03), smoothstep(0.3, 0.7, mac2.g));
  rough = clamp(rough + (mac.g - 0.5) * 0.12, 0.35, 1.0);
  #ifdef TERRAIN_GROUND
    albedo *= 1.0 + (vTerrain.y - 0.5) * 0.7;
  #endif

  // ---- frost in shadowed hollows (sparingly) ----
  float ao = 1.0;
  #ifdef TERRAIN_GROUND
    float conc = vTerrain.z;
    ao = 1.0 - smoothstep(0.52, 0.9, conc) * 0.35;
    float facing = dot(n, uSunDirW);
    float frost = smoothstep(0.6, 0.85, conc) * (1.0 - smoothstep(-0.05, 0.12, facing)) * smoothstep(0.55, 0.75, mac3.r + regH * 0.3);
    frost *= (1.0 - tSunVis * 0.8) * smoothstep(0.5, 0.85, n.y) * (1.0 - t * 0.6);
    frost = smoothstep(0.15, 0.9, frost);
    albedo = mix(albedo, uFrost * 0.8, frost * 0.55);
    rough = mix(rough, 0.6, frost);
  #endif
  // Crevice darkening from the texture heights.
  ao *= mix(1.0, 0.72 + 0.28 * smoothstep(0.1, 0.6, mix(regH, rockH, t)), 1.0 - smoothstep(30.0, 120.0, dist));

  tAlbedo = albedo;
  tRough = rough;
  tWorldN = n;
  tAO = ao;
  tSunVis *= mix(microVis, 1.0, t);
  if (uTerrainDebug > 0.5) {
    // 1: sun visibility, 2: rock blend, 3: albedo only (flat lit)
    tAlbedo = uTerrainDebug < 1.5 ? vec3(tSunVis) : uTerrainDebug < 2.5 ? vec3(t, rockMask, 0.0) : albedo;
    if (uTerrainDebug > 2.5) tWorldN = vec3(0.0, 1.0, 0.0);
  }
}
`;

const VERTEX_PARS = /* glsl */ `
varying vec3 vTWorldPos;
varying vec3 vTWorldNormal;
#ifdef TERRAIN_GROUND
attribute vec4 aTerrain;
varying vec4 vTerrain;
#else
attribute float aRockH;
varying float vRockH;
#endif
`;

const VERTEX_MAIN = /* glsl */ `
{
  vec4 tw = vec4(transformed, 1.0);
  vec3 tn = objectNormal;
  #ifdef USE_INSTANCING
    tw = instanceMatrix * tw;
    mat3 tim = mat3(instanceMatrix);
    tn /= vec3(dot(tim[0], tim[0]), dot(tim[1], tim[1]), dot(tim[2], tim[2]));
    tn = tim * tn;
  #endif
  tw = modelMatrix * tw;
  vTWorldPos = tw.xyz;
  vTWorldNormal = normalize(mat3(modelMatrix) * tn);
  #ifdef TERRAIN_GROUND
    vTerrain = aTerrain;
  #else
    vRockH = aRockH;
  #endif
}
`;

export interface TerrainMaterialOptions {
  textures: TerrainTextures;
  shadow: SunShadow;
  kind: 'ground' | 'rock';
}

export function createTerrainMaterial({ textures, shadow, kind }: TerrainMaterialOptions): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = kind === 'ground' ? 'terrain-ground' : 'terrain-rock';
  const uniforms: Record<string, IUniform> = {
    tRegA: { value: textures.regolithA },
    tRegN: { value: textures.regolithN },
    tRockA: { value: textures.rockA },
    tRockN: { value: textures.rockN },
    tMacro: { value: textures.macro },
    tSunA: { value: shadow.near },
    tSunB: { value: shadow.far },
    uSunGrid: { value: shadow.grid },
    uSunDirW: { value: SUN_DIR.clone() },
    uFrost: { value: new Color().copy(FROST) },
    uTerrainDebug: debugUniform,
  };
  mat.defines = { ...(mat.defines ?? {}), [kind === 'ground' ? 'TERRAIN_GROUND' : 'TERRAIN_ROCK']: '' };
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    const lights = ShaderChunk.lights_fragment_begin
      .replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= terrainSunMask( directLight.direction );',
      )
      .replace(
        'getSunLightInfo( sunLight, directLight );',
        'getSunLightInfo( sunLight, directLight );\n\t\tdirectLight.color *= terrainSunMask( directLight.direction );',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS_FRAGMENT}`)
      .replace('#include <map_fragment>', 'tSunVis = terrainSunVisibility(vTWorldPos);\nterrainSurface();\ndiffuseColor.rgb *= tAlbedo;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tWorldN, 0.0)).xyz);')
      .replace('#include <lights_fragment_begin>', lights)
      .replace(
        '#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= tAO;\nreflectedLight.indirectSpecular *= mix(1.0, tAO, 0.7);',
      );
  };
  mat.customProgramCacheKey = () => `terrain-${kind}-v1`;
  return mat;
}

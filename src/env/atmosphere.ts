import { Color, FogExp2, ShaderChunk } from 'three';
import { SUN_DIR } from './layout';

// One atmosphere model shared by the sky dome and by the fog on every material, so distant
// terrain fades into exactly the colour of the sky behind it (aerial perspective).

const v3 = (x: number, y: number, z: number) => `vec3(${x.toFixed(5)}, ${y.toFixed(5)}, ${z.toFixed(5)})`;

/** Linear HDR colours. Tuned with the AgX tone mapping in the renderer. */
export const ATMOSPHERE = {
  zenith: new Color(0.004, 0.006, 0.016),
  horizonSun: new Color(0.3, 0.115, 0.045),
  horizonAway: new Color(0.06, 0.055, 0.078),
  sunGlow: new Color(0.85, 0.3, 0.09),
  /** Ground colour seen in reflections and the lower half of the environment map. */
  ground: new Color(0.07, 0.058, 0.05),
  /** Base fog density (FogExp2 units, per metre) at height 0. */
  density: 0.00042,
  /** How fast the haze thins with altitude (1 / scale height in metres). */
  heightFalloff: 1 / 260,
};

/** GLSL: `atmHorizon(dir)`, `atmSky(dir)` and `atmGlow(dir)`. `dir` must be normalised. */
export const ATMOSPHERE_GLSL = /* glsl */ `
const vec3 ATM_SUN_DIR = ${v3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z)};
const vec3 ATM_ZENITH = ${v3(ATMOSPHERE.zenith.r, ATMOSPHERE.zenith.g, ATMOSPHERE.zenith.b)};
const vec3 ATM_HORIZON_SUN = ${v3(ATMOSPHERE.horizonSun.r, ATMOSPHERE.horizonSun.g, ATMOSPHERE.horizonSun.b)};
const vec3 ATM_HORIZON_AWAY = ${v3(ATMOSPHERE.horizonAway.r, ATMOSPHERE.horizonAway.g, ATMOSPHERE.horizonAway.b)};
const vec3 ATM_SUN_GLOW = ${v3(ATMOSPHERE.sunGlow.r, ATMOSPHERE.sunGlow.g, ATMOSPHERE.sunGlow.b)};
const vec3 ATM_GROUND = ${v3(ATMOSPHERE.ground.r, ATMOSPHERE.ground.g, ATMOSPHERE.ground.b)};

/** Haze colour along the horizon: warm toward the red giant, dusty violet away from it. */
vec3 atmHorizon(vec3 dir) {
  vec2 flat_ = dir.xz;
  float len = length(flat_);
  vec2 sunFlat = normalize(ATM_SUN_DIR.xz);
  float facing = len > 1e-4 ? dot(flat_ / len, sunFlat) : 0.0;
  float w = pow(clamp(facing * 0.5 + 0.5, 0.0, 1.0), 2.6);
  return mix(ATM_HORIZON_AWAY, ATM_HORIZON_SUN, w);
}

/** Forward scattering around the sun (Mie-like). */
vec3 atmGlow(vec3 dir) {
  float mu = max(dot(dir, ATM_SUN_DIR), 0.0);
  return ATM_SUN_GLOW * (pow(mu, 22.0) * 0.22 + pow(mu, 260.0) * 1.1);
}

/** Sky radiance looking along dir (no sun disc, planet or stars). */
vec3 atmSky(vec3 dir) {
  float h = dir.y;
  vec3 horizon = atmHorizon(dir);
  // Thin atmosphere: the haze band hugs the horizon and the zenith is nearly black.
  float t = pow(clamp(h, 0.0, 1.0), 0.24);
  vec3 col = mix(horizon, ATM_ZENITH, t);
  col += atmGlow(dir) * (1.0 - t * 0.6);
  // Below the horizon: dark ground with a little haze near the horizon line.
  if (h < 0.0) col = mix(horizon * 0.7, ATM_GROUND, clamp(-h * 6.0, 0.0, 1.0));
  return col;
}
`;

/**
 * Replace three's fog with exponential height fog plus sun in-scattering.
 * Call once at startup, before any material compiles. Uses `scene.fog` (FogExp2) for density.
 */
export function installAtmosphere(): FogExp2 {
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  // World position from the view-space position (works for instancing and batching too).
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${ATMOSPHERE_GLSL}
#endif`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 ray = vFogWorldPos - cameraPosition;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-4);
    #ifdef FOG_EXP2
      float k = ${(ATMOSPHERE.heightFalloff).toFixed(6)};
      float camH = max(cameraPosition.y, -50.0);
      float dy = ray.y;
      // Integral of density * exp(-k * height) along the ray.
      float heightTerm = abs(dy) > 0.05 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
      float optical = fogDensity * exp(-k * camH) * dist * heightTerm;
      float amount = 1.0 - exp(-optical);
    #else
      float amount = smoothstep(fogNear, fogFar, dist);
    #endif
    vec3 haze = atmHorizon(dir) + atmGlow(dir);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, clamp(amount, 0.0, 1.0));
  }
#endif`;
  return new FogExp2(0x000000, ATMOSPHERE.density);
}

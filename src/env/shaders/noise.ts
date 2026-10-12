// GLSL noise library. Paste `NOISE_GLSL` into a shader before code that uses it.
// Periodic (`...P`) variants tile seamlessly when `p` spans [0, period): use them for baked textures.

export const NOISE_GLSL = /* glsl */ `
// ---- hashes (Dave Hoskins, "hash without sine") ----
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// ---- 2D gradient noise, range about [-1, 1] ----
vec2 _grad2(vec2 cell) { float a = hash12(cell) * 6.2831853; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(_grad2(i), f);
  float b = dot(_grad2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(_grad2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(_grad2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.414;
}
/** Tileable gradient noise: repeats every 'period' units (period must be whole numbers). */
float gnoiseP(vec2 p, vec2 period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(_grad2(mod(i, period)), f);
  float b = dot(_grad2(mod(i + vec2(1.0, 0.0), period)), f - vec2(1.0, 0.0));
  float c = dot(_grad2(mod(i + vec2(0.0, 1.0), period)), f - vec2(0.0, 1.0));
  float d = dot(_grad2(mod(i + vec2(1.0, 1.0), period)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.414;
}

// ---- fractal sums ----
float fbm(vec2 p, int octaves) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 10; i++) {
    if (i >= octaves) break;
    s += a * gnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return s;
}
/** Tileable fbm: each octave doubles frequency and period, so the sum still tiles. */
float fbmP(vec2 p, vec2 period, int octaves) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 10; i++) {
    if (i >= octaves) break;
    s += a * gnoiseP(p, period);
    p *= 2.0;
    period *= 2.0;
    a *= 0.5;
  }
  return s;
}
/** Ridged tileable fbm in [0, ~1]: sharp crests, good for cracks and rock strata. */
float ridgedP(vec2 p, vec2 period, int octaves) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 10; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(gnoiseP(p, period));
    s += a * n * n;
    p *= 2.0;
    period *= 2.0;
    a *= 0.5;
  }
  return s;
}

// ---- 3D gradient noise (for world-space variation) ----
vec3 _grad3(vec3 c) { return normalize(hash33(c) * 2.0 - 1.0); }
float gnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(_grad3(i), f);
  float n100 = dot(_grad3(i + vec3(1, 0, 0)), f - vec3(1, 0, 0));
  float n010 = dot(_grad3(i + vec3(0, 1, 0)), f - vec3(0, 1, 0));
  float n110 = dot(_grad3(i + vec3(1, 1, 0)), f - vec3(1, 1, 0));
  float n001 = dot(_grad3(i + vec3(0, 0, 1)), f - vec3(0, 0, 1));
  float n101 = dot(_grad3(i + vec3(1, 0, 1)), f - vec3(1, 0, 1));
  float n011 = dot(_grad3(i + vec3(0, 1, 1)), f - vec3(0, 1, 1));
  float n111 = dot(_grad3(i + vec3(1, 1, 1)), f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 1.6;
}
float fbm3(vec3 p, int octaves) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    s += a * gnoise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}

// ---- cellular ----
/** Tileable Voronoi. Returns (F1 distance, F2 distance, random id of the nearest cell). */
vec3 voronoiP(vec2 p, vec2 period) {
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cell = mod(n + g, period);
      vec2 r = g + hash22(cell) - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = hash12(cell + 0.37); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
`;

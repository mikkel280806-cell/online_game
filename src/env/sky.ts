import {
  BackSide,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { ATMOSPHERE_GLSL } from './atmosphere';
import { PLANET_DIR, SUN_DIR } from './layout';
import { NOISE_GLSL } from './shaders/noise';

/** Angular radius of the red giant (radians): huge and close. */
export const SUN_ANGULAR_RADIUS = 0.068;
/** Angular radius of the gas giant Orrin (radians). */
export const PLANET_ANGULAR_RADIUS = 0.2;
/** Orrin's spin axis, tilted so its bands and rings sit at an angle. */
const PLANET_AXIS = new Vector3(0.28, 0.93, 0.24).normalize();

const SKY_RADIUS = 9000;

function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR.clone() },
      uSunRadius: { value: SUN_ANGULAR_RADIUS },
      uPlanetDir: { value: PLANET_DIR.clone() },
      uPlanetRadius: { value: PLANET_ANGULAR_RADIUS },
      uPlanetAxis: { value: PLANET_AXIS.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform float uSunRadius;
      uniform vec3 uPlanetDir;
      uniform float uPlanetRadius;
      uniform vec3 uPlanetAxis;
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${ATMOSPHERE_GLSL}

      // ---- Orrin, the gas giant (unit-distance model: centre at uPlanetDir, radius R) ----
      float planetR() { return sin(uPlanetRadius); }

      bool hitSphere(vec3 ro, vec3 rd, vec3 c, float r, out float t) {
        vec3 oc = ro - c;
        float b = dot(oc, rd);
        float h = b * b - (dot(oc, oc) - r * r);
        if (h < 0.0) return false;
        t = -b - sqrt(h);
        return t > 0.0;
      }

      // Ring opacity at a point on the ring plane, by distance from the centre in planet radii.
      float ringDensity(float r) {
        if (r < 1.32 || r > 2.35) return 0.0;
        float bands = 0.55 + 0.45 * gnoise(vec2(r * 38.0, 0.5));
        bands *= 0.6 + 0.4 * gnoise(vec2(r * 140.0, 3.1));
        float gap = smoothstep(0.012, 0.0, abs(r - 1.86)) ; // a Cassini-like gap
        float edge = smoothstep(1.32, 1.4, r) * smoothstep(2.35, 2.2, r);
        return clamp(bands * edge * (1.0 - gap), 0.0, 1.0) * 0.85;
      }

      vec3 planetAlbedo(vec3 n) {
        // Planet frame: latitude along the spin axis, longitude around it.
        vec3 a = uPlanetAxis;
        vec3 t1 = normalize(cross(a, vec3(0.0, 0.0, 1.0)));
        vec3 t2 = cross(a, t1);
        float lat = dot(n, a);
        float lon = atan(dot(n, t2), dot(n, t1));
        float turb = fbm(vec2(lon * 3.0 + uTime * 0.004, lat * 9.0), 5);
        float warp = lat * 14.0 + turb * 1.6;
        float bands = 0.5 + 0.5 * sin(warp) * 0.8 + 0.2 * sin(warp * 2.7 + 1.0);
        vec3 cream = vec3(0.72, 0.58, 0.42);
        vec3 tan_ = vec3(0.55, 0.36, 0.22);
        vec3 rust = vec3(0.42, 0.2, 0.11);
        vec3 col = mix(rust, tan_, smoothstep(0.2, 0.6, bands));
        col = mix(col, cream, smoothstep(0.65, 0.95, bands));
        // A great storm in the southern belt.
        vec2 sp = vec2(lon - 0.6, (lat + 0.32) * 2.6);
        float storm = smoothstep(0.32, 0.0, length(sp * vec2(1.0, 1.9)) + turb * 0.06);
        col = mix(col, vec3(0.62, 0.26, 0.12), storm * 0.85);
        // Fine cloud texture.
        col *= 0.85 + 0.3 * fbm(vec2(lon * 24.0, lat * 60.0), 4);
        return col;
      }

      vec4 shadePlanet(vec3 d) {
        float R = planetR();
        vec3 C = uPlanetDir;
        vec3 A = uPlanetAxis;
        float tP;
        bool hitP = hitSphere(vec3(0.0), d, C, R, tP);

        // Ring plane through the centre, normal = spin axis.
        float denom = dot(d, A);
        float tR = abs(denom) > 1e-5 ? dot(C, A) / denom : -1.0;
        float ringA = 0.0;
        vec3 ringCol = vec3(0.0);
        if (tR > 0.0) {
          vec3 p = d * tR;
          float r = length(p - C) / R;
          ringA = ringDensity(r);
          if (ringA > 0.0) {
            // Planet shadow on the rings.
            vec3 v = C - p;
            float proj = dot(v, uSunDir);
            float shadow = (proj > 0.0 && length(v - uSunDir * proj) < R) ? 0.12 : 1.0;
            // Rings are lit from the side; forward scattering brightens them toward the sun.
            float lit = 0.35 + 0.65 * abs(dot(A, uSunDir));
            ringCol = vec3(0.62, 0.52, 0.42) * lit * shadow * 0.9;
          }
          if (hitP && tR > tP) ringA = 0.0; // ring is behind the planet
        }

        vec3 col = vec3(0.0);
        float alpha = 0.0;
        if (hitP) {
          vec3 pos = d * tP;
          vec3 n = normalize(pos - C);
          float ndl = dot(n, uSunDir);
          float diffuse = smoothstep(-0.08, 0.5, ndl);
          vec3 albedo = planetAlbedo(n);
          // Ring shadow on the planet.
          float sd = dot(uSunDir, A);
          float s = abs(sd) > 1e-4 ? dot(C - pos, A) / sd : -1.0;
          float ringShadow = 1.0;
          if (s > 0.0) ringShadow = 1.0 - ringDensity(length(pos + uSunDir * s - C) / R) * 0.8;
          // Terminator reddening and a hazy limb.
          float limb = 1.0 - max(dot(n, -d), 0.0);
          vec3 term = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.4, ndl));
          col = albedo * diffuse * term * ringShadow * 1.1;
          col += vec3(0.9, 0.5, 0.25) * pow(limb, 3.0) * smoothstep(-0.2, 0.3, ndl) * 0.5;
          col += albedo * 0.004; // faint night side
          alpha = 1.0;
        }
        col = mix(col, ringCol, ringA);
        alpha = max(alpha, ringA);
        return vec4(col, alpha);
      }

      // ---- The Hollow: the red giant ----
      vec3 shadeSun(vec3 d, out float cover) {
        float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        float r = ang / uSunRadius;
        cover = smoothstep(1.0, 0.985, r);
        if (r > 1.0) return vec3(0.0);
        float mu = sqrt(max(1.0 - r * r, 0.0));
        float limb = 0.25 + 0.75 * pow(mu, 0.7);
        // Granulation and sunspots on the surface.
        vec3 t1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
        vec3 t2 = cross(uSunDir, t1);
        vec2 q = vec2(dot(d, t1), dot(d, t2)) / uSunRadius;
        float gran = fbm(q * 9.0 + uTime * 0.03, 4);
        float spots = smoothstep(0.55, 0.75, fbm(q * 2.2 + 7.0, 3) + 0.5);
        // Deep orange core, redder toward the limb.
        vec3 hot = mix(vec3(0.9, 0.17, 0.025), vec3(1.6, 0.42, 0.07), mu);
        vec3 col = hot * limb * (0.8 + 0.4 * gran) * (1.0 - spots * 0.55);
        return col;
      }

      // ---- stars ----
      vec3 stars(vec3 d) {
        vec3 p = d * 260.0;
        vec3 cell = floor(p);
        vec3 h = hash33(cell);
        if (h.x > 0.12) return vec3(0.0);
        vec3 starPos = (cell + 0.25 + h * 0.5) / 260.0;
        float dist = length(d - normalize(starPos)) * 260.0;
        float mag = pow(hash13(cell + 7.0), 6.0);
        float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + h.y * 3.0) + h.z * 40.0);
        float core = exp(-dist * dist * 90.0);
        vec3 tint = mix(vec3(1.0, 0.82, 0.7), vec3(0.75, 0.85, 1.0), h.y);
        return tint * core * (0.25 + mag * 9.0) * twinkle;
      }

      void main() {
        vec3 d = normalize(vDir);
        vec3 col = atmSky(d);

        // Stars show through the thin air, fading into the horizon haze and the sun's glare.
        float clear = smoothstep(0.02, 0.35, d.y) * (1.0 - smoothstep(0.75, 0.97, dot(d, uSunDir)));
        vec3 starLight = stars(d) * clear;

        vec4 planet = shadePlanet(d);
        // The atmosphere in front of the planet: a little extinction and haze near the horizon.
        float haze = 1.0 - smoothstep(0.0, 0.45, d.y);
        vec3 planetSeen = mix(planet.rgb, atmHorizon(d), haze * 0.55);
        col = mix(col + starLight, col * 0.25 + planetSeen, planet.a);

        float sunCover;
        vec3 sun = shadeSun(d, sunCover);
        col = mix(col, sun * mix(1.0, 0.6, haze), sunCover * (1.0 - planet.a));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export interface Sky {
  group: Group;
  /** Bright disc at the sun's position: the god-rays light source. */
  sunMesh: Mesh;
  /** A second dome for baking the environment map (not added to the main scene). */
  createEnvDome(): Mesh;
  update(time: number, cameraPosition: Vector3): void;
}

export function createSky(): Sky {
  const group = new Group();
  const material = skyMaterial();
  const dome = new Mesh(new SphereGeometry(SKY_RADIUS, 64, 32), material);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  group.add(dome);

  // The god-rays source sits just inside the dome, matching the sky's sun disc.
  const sunDistance = SKY_RADIUS * 0.92;
  const sunMesh = new Mesh(
    new SphereGeometry(Math.tan(SUN_ANGULAR_RADIUS) * sunDistance * 0.98, 32, 16),
    new MeshBasicMaterial({ color: new Color(1.25, 0.32, 0.05), transparent: true, depthWrite: false, fog: false }),
  );
  sunMesh.frustumCulled = false;
  group.add(sunMesh);

  return {
    group,
    sunMesh,
    createEnvDome() {
      const d = new Mesh(new SphereGeometry(SKY_RADIUS, 64, 32), material);
      d.frustumCulled = false;
      return d;
    },
    update(time, cameraPosition) {
      material.uniforms.uTime.value = time;
      dome.position.copy(cameraPosition);
      sunMesh.position.copy(cameraPosition).addScaledVector(SUN_DIR, sunDistance);
    },
  };
}

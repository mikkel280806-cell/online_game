import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Vector3,
} from 'three';
import { mulberry32 } from './random';

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
`;

/** Procedural nebula dome. Follows the camera so it reads as infinitely far away. */
function createNebula(starDir: Vector3): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uStarDir: { value: starDir.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // pin to the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uStarDir;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 drift = vec3(0.0, uTime * 0.003, 0.0);
        float n1 = fbm(d * 2.1 + drift);
        float n2 = fbm(d * 4.3 + n1 * 1.7);
        float dust = smoothstep(0.42, 0.68, fbm(d * 7.5 + n2));

        // A broad galactic band, tilted.
        float plane = dot(d, normalize(vec3(0.25, 1.0, 0.4)));
        float band = exp(-plane * plane * 5.0);

        vec3 deep = vec3(0.004, 0.006, 0.016);
        vec3 teal = vec3(0.03, 0.20, 0.30);
        vec3 violet = vec3(0.30, 0.05, 0.40);
        vec3 ember = vec3(1.0, 0.36, 0.08);

        float density = pow(n2, 2.6) * band;
        vec3 neb = mix(teal, violet, smoothstep(0.35, 0.75, n1)) * density * 2.4;
        neb *= 1.0 - dust * 0.75;

        // The dying star lights the gas around it.
        float sd = max(dot(d, uStarDir), 0.0);
        vec3 glow = ember * (pow(sd, 48.0) * 4.0 + pow(sd, 7.0) * 0.35 + pow(sd, 2.0) * 0.05);
        neb += ember * pow(sd, 3.0) * density * 1.8;

        gl_FragColor = vec4(deep + neb + glow, 1.0);
      }
    `,
  });
  const mesh = new Mesh(new SphereGeometry(1000, 64, 32), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/** Point stars with per-star size and brightness; bright ones are HDR so they bloom. */
function createStars(count: number, seed: number): Points<BufferGeometry, ShaderMaterial> {
  const rand = mulberry32(seed);
  const positions: number[] = [];
  const sizes: number[] = [];
  const colors: number[] = [];
  const c = new Color();
  for (let i = 0; i < count; i++) {
    // Uniform direction on the sphere.
    const u = rand() * 2 - 1;
    const t = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    positions.push(r * Math.cos(t) * 900, u * 900, r * Math.sin(t) * 900);
    const bright = Math.pow(rand(), 8);
    sizes.push(1.0 + bright * 3.5);
    c.setHSL(0.55 + (rand() - 0.5) * 0.25, 0.5, 0.75).multiplyScalar(0.6 + bright * 6);
    colors.push(c.r, c.g, c.b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('size', new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute vec3 color;
      uniform float uPixelRatio;
      uniform float uTime;
      varying vec3 vColor;
      void main() {
        float twinkle = 0.75 + 0.25 * sin(uTime * 2.0 + position.x * 0.37 + position.z * 0.11);
        vColor = color * twinkle;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
        gl_PointSize = size * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(q));
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  });
  const points = new Points(geometry, material);
  points.renderOrder = -9;
  points.frustumCulled = false;
  return points;
}

function radialTexture(stops: [number, string][]): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/** The dying star: an over-bright disc plus a soft corona sprite. */
function createSun(starDir: Vector3): Group {
  const group = new Group();
  const pos = starDir.clone().multiplyScalar(800);
  const disc = new Mesh(
    new SphereGeometry(28, 32, 16),
    new MeshBasicMaterial({ color: new Color(9, 3.6, 1.2), fog: false }),
  );
  disc.position.copy(pos);
  const corona = new Sprite(
    new SpriteMaterial({
      map: radialTexture([
        [0, 'rgba(255,220,180,1)'],
        [0.12, 'rgba(255,150,70,0.85)'],
        [0.35, 'rgba(220,70,20,0.25)'],
        [1, 'rgba(120,20,0,0)'],
      ]),
      color: new Color(3, 1.6, 0.9),
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
      transparent: true,
    }),
  );
  corona.position.copy(pos);
  corona.scale.setScalar(420);
  group.add(disc, corona);
  group.renderOrder = -8;
  return group;
}

/** Banded gas giant hanging below the deck, lit by the star with an atmospheric rim. */
function createGasGiant(starDir: Vector3): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    fog: false,
    uniforms: { uStarDir: { value: starDir.clone() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vView;
      void main() {
        vLocal = normalize(position);
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uStarDir;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vLocal;
      varying vec3 vView;
      ${NOISE_GLSL}
      void main() {
        float lat = vLocal.y;
        float swirl = fbm(vLocal * vec3(3.0, 14.0, 3.0) + vec3(uTime * 0.002, 0.0, 0.0));
        float bands = sin(lat * 26.0 + swirl * 4.0) * 0.5 + 0.5;
        vec3 a = vec3(0.32, 0.17, 0.10);
        vec3 b = vec3(0.70, 0.48, 0.30);
        vec3 c = vec3(0.12, 0.08, 0.10);
        vec3 albedo = mix(mix(c, a, bands), b, smoothstep(0.55, 0.8, swirl));
        float ndl = dot(normalize(vNormal), uStarDir);
        float diffuse = smoothstep(-0.15, 0.6, ndl);
        float rim = pow(1.0 - max(dot(normalize(vNormal), vView), 0.0), 3.0);
        vec3 atmo = vec3(1.0, 0.45, 0.18) * rim * smoothstep(-0.3, 0.4, ndl) * 2.5;
        gl_FragColor = vec4(albedo * diffuse * 1.4 + atmo, 1.0);
      }
    `,
  });
  const mesh = new Mesh(new SphereGeometry(380, 96, 48), material);
  mesh.position.set(160, -560, -620);
  mesh.rotation.z = 0.35;
  return mesh;
}

export interface Sky {
  group: Group;
  /** Objects pinned to the camera position each frame. */
  camLocked: Group;
  update(time: number, cameraPos: Vector3, pixelRatio: number): void;
}

export function createSky(starDir: Vector3): Sky {
  const group = new Group();
  const camLocked = new Group();
  const nebula = createNebula(starDir);
  const stars = createStars(5000, 7);
  const sun = createSun(starDir);
  camLocked.add(nebula, stars, sun);
  const planet = createGasGiant(starDir);
  group.add(camLocked, planet);
  return {
    group,
    camLocked,
    update(time, cameraPos, pixelRatio) {
      camLocked.position.copy(cameraPos);
      nebula.material.uniforms.uTime.value = time;
      stars.material.uniforms.uTime.value = time;
      stars.material.uniforms.uPixelRatio.value = pixelRatio;
      planet.material.uniforms.uTime.value = time;
      planet.rotation.y = time * 0.004;
    },
  };
}

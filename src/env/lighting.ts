import {
  Color,
  DirectionalLight,
  ShaderChunk,
  HemisphereLight,
  InstancedMesh,
  Material,
  Mesh,
  PMREMGenerator,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  type Camera,
  type Frustum,
  type IUniform,
  type Object3D,
  type PerspectiveCamera,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { PLANET_DIR, SUN_COLOR, SUN_DIR } from './layout';
import type { Sky } from './sky';
import type { Quality } from './types';

export interface ShadowSettings {
  /** Number of shadow cascades (1-4). */
  cascades: number;
  /** Shadow map size per cascade (px). */
  size: number;
  /** Distance covered by the cascades (m); the baked terrain sun-occlusion covers the rest. */
  maxFar: number;
}

export const CSM_SETTINGS: Record<Quality, ShadowSettings> = {
  low: { cascades: 2, size: 1024, maxFar: 160 },
  medium: { cascades: 3, size: 2048, maxFar: 260 },
  high: { cascades: 3, size: 2048, maxFar: 300 },
};

/**
 * Optional hints on a shadow-casting mesh (`mesh.userData.shadow`), for cascade culling:
 * - `reach`: how far (m) its shadow can extend beyond its bounding sphere. Default: from the
 *   sphere's size and the sun's elevation. Instanced meshes should give the reach of one
 *   instance (a field of pebbles has a huge bounding sphere but tiny shadows).
 * - `cascades`: only the first N cascades draw it (e.g. 1 for stones: only the sharpest
 *   cascade resolves their shadows).
 */
export interface ShadowHint {
  reach?: number;
  cascades?: number;
}

/**
 * three evaluates the full BRDF for every punctual light on every pixel, even far outside the
 * light's range (where its colour is zero). The outpost's three small lights would cost every
 * terrain pixel to the horizon three GGX evaluations: skip lights that can't reach the pixel.
 * (Applied to CSM's light loop, which CSM installs globally; re-applied after every rebuild.)
 */
function skipUnlitPunctualLights(): void {
  const call = 'RE_Direct( directLight, geometryPosition,';
  const chunk = ShaderChunk.lights_fragment_begin;
  if (chunk.includes(`if ( directLight.visible ) ${call}`)) return;
  ShaderChunk.lights_fragment_begin = chunk.split(call).join(`if ( directLight.visible ) ${call}`);
}

/** Shadow length per metre of caster height: the Hollow is ~11.5° above the horizon. */
const SHADOW_PER_HEIGHT = Math.sqrt(1 - SUN_DIR.y * SUN_DIR.y) / SUN_DIR.y;

export interface Lighting {
  /**
   * Every lit material must be registered: cascaded shadows replace three's lighting code,
   * and an unregistered material would be lit once per cascade. Safe to call repeatedly.
   */
  register(object: Object3D): void;
  setCamera(camera: PerspectiveCamera): void;
  update(): void;
  /** Call after the camera's projection changes (fov, aspect, near/far). */
  updateFrustums(): void;
  /** Rebuild the cascades for a quality tier (e.g. when the renderer steps quality down). */
  setQuality(quality: Quality): void;
  /** Override the cascade layout (profiling and tests). Rebuilds the shadow lights. */
  configureShadows(settings: Partial<ShadowSettings>): void;
  /** Turn sun shadows on or off (profiling). */
  setShadowsEnabled(on: boolean): void;
  readonly shadowSettings: ShadowSettings;
}

/**
 * Key light from the red giant with cascaded shadow maps, image-based lighting from the sky,
 * and a faint amber bounce from the gas giant.
 *
 * Shadow casters are culled per cascade, not just against the cascade's box: with a low sun
 * each box reaches 400 m toward the light, so every caster near the camera used to be drawn
 * into all three maps. A caster is drawn into a cascade only if its shadow can land in that
 * cascade's slice of view depth.
 */
export function createLighting(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, sky: Sky, quality: Quality): Lighting {
  let settings: ShadowSettings = { ...CSM_SETTINGS[quality] };
  let shadowsOn = true;
  let cam = camera;

  /** Shadow frustum (one per cascade light) -> cascade index. */
  const cascadeOf = new Map<Frustum, number>();
  /** View-depth slice (m) each cascade shades, fade margins included. */
  const slices: [number, number][] = [];

  const makeCsm = (s: ShadowSettings): CSM => {
    const c = new CSM({
      camera: cam,
      parent: scene,
      cascades: s.cascades,
      maxFar: s.maxFar,
      mode: 'practical',
      shadowMapSize: s.size,
      lightDirection: SUN_DIR.clone().negate(),
      lightIntensity: 7.5,
      lightNear: 1,
      lightFar: 3000,
      lightMargin: 400,
      shadowBias: -0.00012,
    });
    c.fade = true;
    skipUnlitPunctualLights();
    cascadeOf.clear();
    c.lights.forEach((light: DirectionalLight, i: number) => {
      light.color.copy(SUN_COLOR);
      // Wider cascades have bigger texels: push the lookup further along the normal.
      // Scaled by texel size so a smaller map (lower tier) keeps the same acne margin.
      light.shadow.normalBias = 0.025 * (i + 1) * (i + 1) * (2048 / s.size);
      light.castShadow = shadowsOn;
      cascadeOf.set(light.shadow.getFrustum(), i);
    });
    return c;
  };
  let csm = makeCsm(settings);

  // Fill: cool skylight from above, warm dust bounce from below. Keeps shadows readable.
  scene.add(new HemisphereLight(new Color('#7f90b4'), new Color('#6a5040'), 1.1));

  // Faint warm bounce from Orrin. No shadows.
  const bounce = new DirectionalLight(new Color('#c98a55'), 0.6);
  bounce.position.copy(PLANET_DIR).multiplyScalar(100);
  scene.add(bounce, bounce.target);

  // Image-based lighting: the sky dome baked into a prefiltered environment map.
  const pmrem = new PMREMGenerator(gl);
  const envScene = new Scene();
  envScene.add(sky.createEnvDome());
  scene.environment = pmrem.fromScene(envScene, 0.02, 1, 20000).texture;
  scene.environmentIntensity = 1.2;
  pmrem.dispose();

  // CSM gives every material its own copies of the cascade uniforms, set when the program is
  // built. three keeps one program per (material, defines) and reuses it without calling
  // onBeforeCompile again, so after the cascades are rebuilt (quality change) a reused program
  // would keep the old, detached uniforms. Instead every material shares these, and they are
  // refreshed from whichever CSM is current.
  const shared = {
    CSM_cascades: { value: [] as Vector2[] } as IUniform<Vector2[]>,
    cameraNear: { value: camera.near } as IUniform<number>,
    shadowFar: { value: settings.maxFar } as IUniform<number>,
  };
  const syncShared = () => {
    const arr = shared.CSM_cascades.value;
    const far = Math.min(cam.far, csm.maxFar);
    arr.length = csm.breaks.length;
    slices.length = csm.breaks.length;
    for (let i = 0; i < csm.breaks.length; i++) {
      const a = csm.breaks[i - 1] ?? 0;
      const b = csm.breaks[i];
      arr[i] = arr[i] ?? new Vector2();
      arr[i].set(a, b);
      // Same fade margins as the CSM shader, plus a little slack.
      const ma = 0.25 * a * a * far + 2;
      const mb = 0.25 * b * b * far + 2;
      slices[i] = [i === 0 ? -Infinity : a * far - ma, i === csm.breaks.length - 1 ? Infinity : b * far + mb];
    }
    shared.cameraNear.value = cam.near;
    shared.shadowFar.value = far;
  };
  syncShared();

  const _sphere = new Sphere();
  const _v = new Vector3();
  /** Replaces Mesh.intersectsFrustum on shadow casters (three calls it for every shadow pass). */
  function cascadeCull(this: Mesh, frustum: Frustum): boolean {
    const i = cascadeOf.get(frustum);
    if (i !== undefined) {
      const hint = this.userData.shadow as ShadowHint | undefined;
      if (hint?.cascades !== undefined && i >= hint.cascades) return false;
      // InstancedMesh and SkinnedMesh keep their own bounds; plain meshes use the geometry's.
      const own = this as Mesh as InstancedMesh;
      if (own.boundingSphere !== undefined) {
        if (own.boundingSphere === null) own.computeBoundingSphere();
        _sphere.copy(own.boundingSphere!);
      } else {
        if (this.geometry.boundingSphere === null) this.geometry.computeBoundingSphere();
        _sphere.copy(this.geometry.boundingSphere!);
      }
      _sphere.applyMatrix4(this.matrixWorld);
      const depth = -_v.copy(_sphere.center).applyMatrix4(cam.matrixWorldInverse).z;
      const reach = _sphere.radius + (hint?.reach ?? 2 * _sphere.radius * SHADOW_PER_HEIGHT);
      const [a, b] = slices[i];
      if (depth + reach < a || depth - reach > b) return false;
    }
    return frustum.intersectsObject(this);
  }

  /** Each registered material with its own onBeforeCompile (before CSM wrapped it). */
  const materials = new Map<Material, Material['onBeforeCompile'] | null>();
  const setup = (m: Material) => {
    let own = materials.get(m);
    if (own === undefined) {
      if (!('isMeshStandardMaterial' in m || 'isMeshPhongMaterial' in m || 'isMeshLambertMaterial' in m)) return;
      own = m.onBeforeCompile !== Material.prototype.onBeforeCompile ? m.onBeforeCompile : null;
      materials.set(m, own);
    }
    // CSM.setupMaterial overwrites onBeforeCompile; keep any customisation the material already has.
    csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
      own?.call(m, shader, renderer);
      csmHook.call(m, shader, renderer);
      Object.assign(shader.uniforms, shared);
    };
    m.needsUpdate = true;
  };

  const rebuild = (next: ShadowSettings) => {
    if (next.cascades === settings.cascades && next.size === settings.size && next.maxFar === settings.maxFar) return;
    settings = next;
    csm.remove();
    for (const l of csm.lights) l.shadow.map?.dispose();
    csm = makeCsm(settings);
    syncShared();
    // New defines (cascade count) where needed; programs with unchanged defines are reused.
    for (const m of materials.keys()) setup(m);
  };

  return {
    get shadowSettings() {
      return settings;
    },
    register(object) {
      object.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (!materials.has(m)) setup(m);
        if (o.intersectsFrustum === Mesh.prototype.intersectsFrustum) o.intersectsFrustum = cascadeCull;
      });
    },
    setCamera(c: Camera) {
      cam = c as PerspectiveCamera;
      csm.camera = cam;
      csm.updateFrustums();
      syncShared();
    },
    update() {
      csm.update();
    },
    updateFrustums() {
      csm.updateFrustums();
      syncShared();
    },
    setQuality(q) {
      rebuild({ ...CSM_SETTINGS[q] });
    },
    configureShadows(s) {
      rebuild({ ...settings, ...s });
    },
    setShadowsEnabled(on) {
      shadowsOn = on;
      for (const l of csm.lights) l.castShadow = on;
    },
  };
}

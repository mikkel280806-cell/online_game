import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Material,
  Mesh,
  PMREMGenerator,
  Scene,
  type Camera,
  type Object3D,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { PLANET_DIR, SUN_COLOR, SUN_DIR } from './layout';
import type { Sky } from './sky';
import type { Quality } from './types';

const CSM_SETTINGS: Record<Quality, { cascades: number; size: number; maxFar: number }> = {
  low: { cascades: 2, size: 1024, maxFar: 160 },
  medium: { cascades: 3, size: 2048, maxFar: 260 },
  high: { cascades: 4, size: 2048, maxFar: 360 },
};

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
}

/**
 * Key light from the red giant with cascaded shadow maps, image-based lighting from the sky,
 * and a faint amber bounce from the gas giant.
 */
export function createLighting(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, sky: Sky, quality: Quality): Lighting {
  const settings = CSM_SETTINGS[quality];
  const csm = new CSM({
    camera,
    parent: scene,
    cascades: settings.cascades,
    maxFar: settings.maxFar,
    mode: 'practical',
    shadowMapSize: settings.size,
    lightDirection: SUN_DIR.clone().negate(),
    lightIntensity: 7.5,
    lightNear: 1,
    lightFar: 3000,
    lightMargin: 400,
    shadowBias: -0.00012,
  });
  csm.fade = true;
  csm.lights.forEach((light: DirectionalLight, i: number) => {
    light.color.copy(SUN_COLOR);
    // Wider cascades have bigger texels: push the lookup further along the normal.
    light.shadow.normalBias = 0.025 * (i + 1) * (i + 1);
  });

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

  const done = new WeakSet<Material>();
  const setup = (m: Material) => {
    if (done.has(m) || !('isMeshStandardMaterial' in m || 'isMeshPhongMaterial' in m || 'isMeshLambertMaterial' in m)) return;
    done.add(m);
    // CSM.setupMaterial overwrites onBeforeCompile; keep any customisation the material already has.
    const own = m.onBeforeCompile;
    csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    if (own !== Material.prototype.onBeforeCompile) {
      m.onBeforeCompile = (shader, renderer) => {
        own.call(m, shader, renderer);
        csmHook.call(m, shader, renderer);
      };
    }
    m.needsUpdate = true;
  };

  return {
    register(object) {
      object.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(setup);
      });
    },
    setCamera(cam: Camera) {
      csm.camera = cam as PerspectiveCamera;
      csm.updateFrustums();
    },
    update() {
      csm.update();
    },
    updateFrustums() {
      csm.updateFrustums();
    },
  };
}

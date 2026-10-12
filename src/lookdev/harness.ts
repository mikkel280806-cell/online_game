// Look-development harness: render one module on its own, from fixed cameras, so an agent
// (or a person) can screenshot it and iterate. See scripts/lookdev.mjs.
//
// A page `lookdev/<name>.html` loads `/src/lookdev/<name>.ts`, which calls `runLookdev()`.
// URL: /lookdev/<name>.html?view=<viewName>   (default: the first view)

import {
  BackSide,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { Renderer } from '../engine/renderer';
import { DUST_COLOR, SUN_COLOR, SUN_DIR } from '../env/layout';

export interface LookdevView {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface LookdevContext {
  gl: WebGLRenderer;
  renderer: Renderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** The temporary key light (from SUN_DIR). Its shadow box is centred on the origin. */
  sun: DirectionalLight;
  params: URLSearchParams;
}

export interface LookdevOptions {
  views: Record<string, LookdevView>;
  setup(ctx: LookdevContext): void | Promise<void>;
  /** Called before each rendered frame with a fixed time. */
  update?(time: number, ctx: LookdevContext): void;
  /** Add a flat dusty ground plane at y=0 (for props and characters). Default false. */
  ground?: boolean;
  /** Half-size of the sun's shadow box in metres. Default 40. */
  shadowExtent?: number;
  /** Animation time used for the shot. Default 2.5 s. */
  time?: number;
}

declare global {
  interface Window {
    __shotReady?: boolean;
  }
}

/** Simple sky for look-dev only: dark zenith, warm hazy horizon toward the sun. */
function lookdevSky(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: SUN_DIR.clone() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        vec3 zenith = vec3(0.012, 0.014, 0.03);
        vec3 horizon = vec3(0.32, 0.2, 0.16);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.45));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.45, 0.2) * (pow(s, 8.0) * 0.6 + pow(s, 600.0) * 20.0);
        if (h < 0.0) col = horizon * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new Mesh(new SphereGeometry(900, 48, 24), material);
}

export async function runLookdev(opts: LookdevOptions): Promise<void> {
  const params = new URLSearchParams(location.search);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
  document.body.style.margin = '0';
  document.body.style.background = '#000';
  document.body.append(canvas);

  const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 5000);
  const renderer = new Renderer(canvas, camera);
  renderer.setDynamicResolution(false);
  renderer.onResize = (w, h) => {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  renderer.resize();
  const gl = renderer.gl;

  const scene = new Scene();
  renderer.setScene(scene);
  const sky = lookdevSky();
  scene.add(sky);
  const pmrem = new PMREMGenerator(gl);
  const envScene = new Scene();
  envScene.add(lookdevSky());
  scene.environment = pmrem.fromScene(envScene, 0.04, 0.1, 2000).texture;
  scene.environmentIntensity = 0.6;

  const extent = opts.shadowExtent ?? 40;
  const sun = new DirectionalLight(SUN_COLOR, 3.4);
  sun.position.copy(SUN_DIR).multiplyScalar(extent * 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: extent * 4 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new HemisphereLight(new Color(0.35, 0.4, 0.6), new Color(0.12, 0.09, 0.07), 0.6));

  if (opts.ground) {
    const ground = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: DUST_COLOR, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  const ctx: LookdevContext = { gl, renderer, scene, camera, sun, params };
  await opts.setup(ctx);

  const names = Object.keys(opts.views);
  const view = opts.views[params.get('view') ?? names[0]] ?? opts.views[names[0]];
  camera.fov = view.fov ?? 40;
  camera.position.set(...view.position);
  camera.lookAt(new Vector3(...view.target));
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);

  const time = opts.time ?? 2.5;
  for (let i = 0; i < 5; i++) {
    opts.update?.(time + i / 60, ctx);
    renderer.render(1 / 60, 16);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const info = gl.info.render;
  console.info(`[lookdev] view=${params.get('view') ?? names[0]} draws=${info.calls} triangles=${info.triangles}`);
  window.__shotReady = true;
}

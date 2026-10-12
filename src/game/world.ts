import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PMREMGenerator,
  Scene,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { createDeck, type Deck } from './deck';
import { createSky, type Sky } from './sky';

/** Direction toward the dying star (light comes from here). */
export const STAR_DIR = new Vector3(-0.55, 0.62, -0.56).normalize();

export interface World {
  scene: Scene;
  deck: Deck;
  sky: Sky;
  update(time: number, cameraPos: Vector3, pixelRatio: number): void;
}

export function createWorld(gl: WebGLRenderer): World {
  const scene = new Scene();
  scene.background = new Color(0x000000);
  scene.fog = new FogExp2(0x06070d, 0.0085);

  const sky = createSky(STAR_DIR);
  scene.add(sky.group);

  // Image-based lighting from the sky alone, so metal reflects the nebula and star.
  const pmrem = new PMREMGenerator(gl);
  const envScene = new Scene();
  const envSky = createSky(STAR_DIR);
  envSky.update(0, new Vector3(), 1);
  envScene.add(envSky.group);
  scene.environment = pmrem.fromScene(envScene, 0.02, 0.1, 2000).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  // Key light from the star: warm, low-ish, long shadows.
  const sun = new DirectionalLight(new Color(1.0, 0.62, 0.38), 3.2);
  sun.position.copy(STAR_DIR).multiplyScalar(60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Cool fill from the nebula side so shadows aren't dead black.
  const fill = new DirectionalLight(new Color(0.35, 0.5, 1.0), 0.55);
  fill.position.set(30, 20, 40);
  scene.add(fill);
  scene.add(new HemisphereLight(new Color(0.25, 0.32, 0.55), new Color(0.06, 0.04, 0.03), 0.4));

  const deck = createDeck(gl.capabilities.getMaxAnisotropy());
  scene.add(deck.group);

  return {
    scene,
    deck,
    sky,
    update(time, cameraPos, pixelRatio) {
      sky.update(time, cameraPos, pixelRatio);
      deck.update(time);
    },
  };
}

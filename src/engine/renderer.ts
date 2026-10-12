import {
  HalfFloatType,
  NoToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  Scene,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Mesh,
} from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  KernelSize,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type Quality = 'low' | 'medium' | 'high';

const QUALITY_MAX_PIXEL_RATIO: Record<Quality, number> = { low: 1, medium: 1.25, high: 1.5 };
const TARGET_FRAME_MS = 1000 / 60;

/** Exposure in linear HDR, before tone mapping. */
class ExposureEffect extends Effect {
  constructor(exposure: number) {
    super(
      'ExposureEffect',
      /* glsl */ `
      uniform float uExposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
      }`,
      { uniforms: new Map([['uExposure', new Uniform(exposure)]]) },
    );
  }
}

/** Film-style grade after tone mapping: saturation, contrast around mid-grey, split toning. */
class GradeEffect extends Effect {
  constructor() {
    super(
      'GradeEffect',
      /* glsl */ `
      uniform float uSaturation;
      uniform float uContrast;
      uniform vec3 uShadows;
      uniform vec3 uHighlights;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = max(inputColor.rgb, 0.0);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation);
        // Contrast as a power curve pivoting on mid-grey keeps blacks and whites in range.
        c = 0.18 * pow(c / 0.18 + 1e-5, vec3(uContrast));
        float w = smoothstep(0.02, 0.5, l);
        c *= mix(uShadows, uHighlights, w);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`,
      {
        uniforms: new Map<string, Uniform>([
          ['uSaturation', new Uniform(1.08)],
          ['uContrast', new Uniform(1.07)],
          ['uShadows', new Uniform(new Vector3(0.92, 0.97, 1.08))],
          ['uHighlights', new Uniform(new Vector3(1.04, 1.0, 0.95))],
        ]),
      },
    );
  }
}

export type ToneMap = 'agx' | 'aces' | 'neutral';
const TONE_MAPS: Record<ToneMap, ToneMappingMode> = {
  agx: ToneMappingMode.AGX,
  aces: ToneMappingMode.ACES_FILMIC,
  neutral: ToneMappingMode.NEUTRAL,
};

export interface PostOptions {
  quality: Quality;
  toneMap?: ToneMap;
  /** Bright mesh at the sun's position; enables god rays on high quality. */
  sunMesh?: Mesh | null;
  exposure?: number;
}

/**
 * WebGL renderer + HDR post-processing: ambient occlusion (N8AO), god rays, bloom, exposure,
 * AgX tone mapping, grade, vignette, grain and SMAA. Dynamic resolution keeps a laptop near
 * 60 fps: the pixel ratio steps down when frames run long and slowly back up with headroom.
 */
export class Renderer {
  readonly gl: WebGLRenderer;
  private composer: EffectComposer;
  private scene: Scene = new Scene();
  private camera: Camera;
  private post: PostOptions = { quality: 'high' };
  private quality: Quality = 'high';
  /** Optional hard cap on the pixel ratio (e.g. ?scale=0.5 for slow machines and tests). */
  private scaleCap = Infinity;
  private pixelRatio: number;
  private dynamicResolution = true;
  private frameAccum = 0;
  private frameCount = 0;
  private headroomSeconds = 0;
  private cooldown = 0;
  bloom: BloomEffect | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    camera: Camera,
  ) {
    this.camera = camera;
    this.gl = new WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = NoToneMapping; // done in post
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFShadowMap;
    this.gl.info.autoReset = false;

    this.pixelRatio = this.maxPixelRatio();
    this.gl.setPixelRatio(this.pixelRatio);
    this.composer = new EffectComposer(this.gl, { frameBufferType: HalfFloatType });
    this.buildPasses();
    window.addEventListener('resize', () => this.resize());
  }

  setScene(scene: Scene): void {
    this.scene = scene;
    this.buildPasses();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.buildPasses();
  }

  /** Rebuild the post chain, e.g. after the sun mesh exists. */
  configurePost(post: Partial<PostOptions>): void {
    this.post = { ...this.post, ...post };
    this.buildPasses();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.post.quality = q;
    this.pixelRatio = this.maxPixelRatio();
    this.buildPasses();
  }

  getQuality(): Quality {
    return this.quality;
  }

  setScaleCap(cap: number): void {
    this.scaleCap = cap;
    this.setPixelRatio(this.maxPixelRatio());
  }

  /** Disable for deterministic screenshots. */
  setDynamicResolution(on: boolean): void {
    this.dynamicResolution = on;
  }

  getPixelRatio(): number {
    return this.pixelRatio;
  }

  render(deltaSeconds: number, frameMs: number): void {
    this.gl.info.reset();
    this.composer.render(deltaSeconds);
    if (this.dynamicResolution) this.adaptResolution(frameMs);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h, false);
    this.onResize?.(w, h);
  }

  onResize?: (width: number, height: number) => void;

  private buildPasses(): void {
    this.composer.removeAllPasses();
    const q = this.post.quality;
    const camera = this.camera;
    this.composer.addPass(new RenderPass(this.scene, camera));

    if (q !== 'low') {
      const size = this.gl.getDrawingBufferSize(new Vector2());
      const ao = new N8AOPostPass(this.scene, camera, size.x || 512, size.y || 512);
      Object.assign(ao.configuration, {
        aoRadius: 2.2,
        distanceFalloff: 1.2,
        intensity: q === 'high' ? 3.2 : 2.6,
        aoSamples: q === 'high' ? 16 : 8,
        denoiseSamples: q === 'high' ? 8 : 4,
        halfRes: q !== 'high',
        gammaCorrection: false,
      });
      this.composer.addPass(ao);
    }

    const effects: Effect[] = [];
    if (q === 'high' && this.post.sunMesh) {
      effects.push(
        new GodRaysEffect(camera, this.post.sunMesh, {
          resolutionScale: 0.5,
          kernelSize: KernelSize.SMALL,
          density: 0.97,
          decay: 0.93,
          weight: 0.32,
          exposure: 0.42,
          samples: 48,
          clampMax: 1,
        }),
      );
    }
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.3,
      intensity: 0.85,
      radius: 0.75,
    });
    effects.push(
      this.bloom,
      new ExposureEffect(this.post.exposure ?? 1.0),
      new ToneMappingEffect({ mode: TONE_MAPS[this.post.toneMap ?? 'aces'] }),
      new GradeEffect(),
      new VignetteEffect({ offset: 0.28, darkness: 0.55 }),
    );
    if (q !== 'low') {
      const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
      grain.blendMode.opacity.value = 0.05;
      effects.push(grain);
    }
    effects.push(new SMAAEffect({ preset: q === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }));
    this.composer.addPass(new EffectPass(camera, ...effects));
    this.resize();
  }

  private maxPixelRatio(): number {
    return Math.min(window.devicePixelRatio, QUALITY_MAX_PIXEL_RATIO[this.quality], this.scaleCap);
  }

  /** Average frame time over ~0.5 s windows; step down fast, step up slowly, never thrash. */
  private adaptResolution(frameMs: number): void {
    this.frameAccum += frameMs;
    this.frameCount++;
    if (this.frameAccum < 500) return;
    const avg = this.frameAccum / this.frameCount;
    const seconds = this.frameAccum / 1000;
    this.frameAccum = 0;
    this.frameCount = 0;
    if (this.cooldown > 0) {
      this.cooldown -= seconds;
      return;
    }
    const max = this.maxPixelRatio();
    const floor = Math.min(0.6, max);
    if (avg > TARGET_FRAME_MS * 1.18 && this.pixelRatio > floor) {
      this.setPixelRatio(Math.max(floor, this.pixelRatio - 0.1));
      this.headroomSeconds = 0;
      this.cooldown = 2;
    } else if (avg < TARGET_FRAME_MS * 0.78 && this.pixelRatio < max) {
      this.headroomSeconds += seconds;
      if (this.headroomSeconds > 5) {
        this.setPixelRatio(Math.min(max, this.pixelRatio + 0.05));
        this.headroomSeconds = 0;
        this.cooldown = 3;
      }
    } else {
      this.headroomSeconds = 0;
    }
  }

  private setPixelRatio(ratio: number): void {
    const next = Math.round(ratio * 100) / 100;
    if (next === this.pixelRatio) return;
    this.pixelRatio = next;
    this.resize();
  }
}

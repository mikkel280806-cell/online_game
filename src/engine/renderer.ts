import {
  HalfFloatType,
  NoToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  Uniform,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Mesh,
  type WebGLRenderTarget,
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
  ShaderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { SANITIZE_GLSL } from '../env/safety';
import { ResolutionController } from './resolution';

/** Copies the frame, replacing NaN/Infinity with black (see env/safety.ts for why). */
function sanitizePass(): ShaderPass {
  const material = new ShaderMaterial({
    uniforms: { inputBuffer: { value: null } },
    vertexShader: `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D inputBuffer;
      varying vec2 vUv;
      ${SANITIZE_GLSL}
      void main() {
        vec4 c = texture2D(inputBuffer, vUv);
        gl_FragColor = vec4(hsSanitize(c.rgb), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  return new ShaderPass(material, 'inputBuffer');
}

export type Quality = 'low' | 'medium' | 'high';
/** Cheapest first. */
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** What each quality tier renders. Scales are pixel ratios (1 = one pixel per CSS pixel). */
interface Tier {
  /** Highest pixel ratio (also limited by the screen's devicePixelRatio). */
  maxScale: number;
  /** Lowest pixel ratio dynamic resolution may use before stepping down a tier. */
  minScale: number;
  /** Ambient occlusion at half resolution with depth-aware upsampling (null = off). */
  ao: { samples: number; denoiseSamples: number; intensity: number } | null;
  godRays: { resolutionScale: number; samples: number } | null;
  smaa: SMAAPreset;
  grain: boolean;
}

export const TIERS: Record<Quality, Tier> = {
  high: {
    maxScale: 1.5,
    minScale: 0.8,
    ao: { samples: 16, denoiseSamples: 8, intensity: 3.2 },
    godRays: { resolutionScale: 0.5, samples: 48 },
    smaa: SMAAPreset.HIGH,
    grain: true,
  },
  medium: {
    maxScale: 1.25,
    minScale: 0.7,
    ao: { samples: 8, denoiseSamples: 4, intensity: 2.8 },
    godRays: { resolutionScale: 0.4, samples: 32 },
    smaa: SMAAPreset.MEDIUM,
    grain: true,
  },
  low: {
    maxScale: 1,
    minScale: 0.55,
    ao: null,
    godRays: null,
    smaa: SMAAPreset.MEDIUM,
    grain: false,
  },
};

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
  /** Only tone mapping + anti-aliasing (for diagnosing rendering problems). */
  minimal?: boolean;
  ao?: boolean;
  godRays?: boolean;
  bloom?: boolean;
  grain?: boolean;
  smaa?: boolean;
  toneMap?: ToneMap;
  /** Bright mesh at the sun's position; enables god rays. */
  sunMesh?: Mesh | null;
  exposure?: number;
}

const _sun = new Vector3();

/**
 * God rays come only from the sun disc's pixels on screen. When the whole disc is off screen
 * (most of the time in play) its four internal passes would produce black: skip them and clear
 * the rays texture once instead.
 */
function onlyWhenSunInView(effect: GodRaysEffect, camera: Camera, sun: Mesh): GodRaysEffect {
  const update = effect.update.bind(effect);
  const target = (effect as unknown as { renderTargetB: WebGLRenderTarget }).renderTargetB;
  let cleared = false;
  effect.update = (renderer, inputBuffer, dt) => {
    sun.updateWorldMatrix(true, false);
    _sun.setFromMatrixPosition(sun.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    let inView = false;
    if (_sun.z < 0) {
      // In front of the camera: is the disc's centre within ~its radius (0.1-0.2 NDC) of the screen?
      _sun.applyMatrix4(camera.projectionMatrix);
      inView = Math.abs(_sun.x) < 1.3 && Math.abs(_sun.y) < 1.3;
    }
    if (inView) {
      cleared = false;
      update(renderer, inputBuffer, dt);
    } else if (!cleared) {
      cleared = true;
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
    }
  };
  return effect;
}

const STORAGE_KEY = 'hs.renderScale.v1';

function loadScaleHint(q: Quality): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')[q];
    return typeof v === 'number' && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function saveScaleHint(q: Quality, scale: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    all[q] = scale;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* private mode etc. */
  }
}

/**
 * WebGL renderer + HDR post-processing: ambient occlusion (N8AO), god rays, bloom, exposure,
 * tone mapping, grade, vignette, grain and SMAA.
 *
 * Dynamic resolution (see resolution.ts) keeps a laptop at 60 fps: it lowers the pixel ratio
 * when frames run long, probes back up when they have been steady, and steps the quality tier
 * down when even the tier's lowest scale is too slow. Size and quality changes are applied at
 * the start of a frame, right before it is drawn: resizing a canvas clears it, and a cleared
 * canvas that reaches the screen is a black flash.
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
  private drs: ResolutionController;
  /** Canvas size or pixel ratio changed: resize before the next frame is drawn. */
  private sizeDirty = false;
  private lastChange = 0;
  private hintSaved = true;
  bloom: BloomEffect | null = null;
  /** Called after dynamic resolution stepped the quality tier down (rebuild quality-dependent parts). */
  onQualityChange?: (quality: Quality) => void;
  onResize?: (width: number, height: number) => void;

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

    this.drs = new ResolutionController(this.drsLimits(), this.initialScale());
    this.pixelRatio = this.drs.scale;
    this.gl.setPixelRatio(this.pixelRatio);
    this.composer = new EffectComposer(this.gl, { frameBufferType: HalfFloatType });
    this.buildPasses();
    window.addEventListener('resize', () => (this.sizeDirty = true));
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
    // Keeps the current scale if it is inside the new tier's limits; fresh warm-up (new shaders).
    this.drs.retarget(this.drsLimits());
    this.setPixelRatio(this.dynamicResolution ? this.drs.scale : this.maxScale());
    this.buildPasses();
  }

  getQuality(): Quality {
    return this.quality;
  }

  setScaleCap(cap: number): void {
    this.scaleCap = cap;
    this.drs.retarget(this.drsLimits(), 1000);
    this.setPixelRatio(this.dynamicResolution ? this.drs.scale : this.maxScale());
  }

  /** Disable for deterministic screenshots. */
  setDynamicResolution(on: boolean): void {
    this.dynamicResolution = on;
    if (!on) this.setPixelRatio(this.maxScale());
    else this.drs.restart(1000);
  }

  getPixelRatio(): number {
    return this.pixelRatio;
  }

  /** Dynamic-resolution state for the perf overlay. */
  resolutionInfo(): { reason: string; medianMs: number | null; min: number; max: number } {
    const c = this.drs.config;
    return { reason: this.drs.lastReason, medianMs: this.drs.last?.median ?? null, min: c.minScale, max: c.maxScale };
  }

  /**
   * Draw one frame. `frameMs` is the time since the previous frame; `cpuMs` (optional) is how long
   * the main thread spent on the previous frame, so CPU-bound frames don't lower the resolution.
   */
  render(deltaSeconds: number, frameMs: number, cpuMs?: number): void {
    if (this.dynamicResolution) this.adapt(frameMs, cpuMs);
    if (this.sizeDirty) this.resize();
    this.gl.info.reset();
    this.composer.render(deltaSeconds);
  }

  resize(): void {
    this.sizeDirty = false;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    // The window may have moved to a screen with another pixel density.
    const limits = this.drsLimits();
    if (limits.maxScale !== this.drs.config.maxScale) {
      this.drs.retarget(limits, 1000);
      this.pixelRatio = this.dynamicResolution ? this.drs.scale : this.maxScale();
    }
    this.gl.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h, false);
    this.onResize?.(w, h);
  }

  private adapt(frameMs: number, cpuMs?: number): void {
    const d = this.drs.frame({ dtMs: frameMs, cpuMs });
    const now = performance.now();
    if (d.type === 'scale') {
      this.lastChange = now;
      this.hintSaved = false;
      this.setPixelRatio(d.scale);
    } else if (d.type === 'quality-down') {
      const lower = QUALITIES[Math.max(0, QUALITIES.indexOf(this.quality) - 1)];
      if (lower !== this.quality) {
        console.info(`[renderer] quality ${this.quality} -> ${lower}: ${d.reason}`);
        this.lastChange = now;
        this.hintSaved = false;
        this.setQuality(lower);
        this.onQualityChange?.(lower);
      }
    } else if (!this.hintSaved && now - this.lastChange > 15_000) {
      // Settled: start here next time instead of searching again.
      this.hintSaved = true;
      saveScaleHint(this.quality, this.pixelRatio);
    }
  }

  private drsLimits() {
    const tier = TIERS[this.quality];
    const maxScale = this.maxScale();
    return {
      maxScale,
      minScale: Math.min(tier.minScale, maxScale),
      canLowerQuality: this.quality !== 'low',
    };
  }

  /** Start where the last visit settled, or at 1.0 and let the controller find the headroom. */
  private initialScale(): number {
    return loadScaleHint(this.quality) ?? Math.min(1, this.maxScale());
  }

  private buildPasses(): void {
    this.composer.removeAllPasses();
    const q = this.post.quality;
    const tier = TIERS[q];
    const camera = this.camera;
    const minimal = !!this.post.minimal;
    this.composer.addPass(new RenderPass(this.scene, camera));

    const aoOn = !!tier.ao && !minimal && this.post.ao !== false;
    if (aoOn && tier.ao) {
      const size = this.gl.getDrawingBufferSize(new Vector2());
      const ao = new N8AOPostPass(this.scene, camera, size.x || 512, size.y || 512);
      Object.assign(ao.configuration, {
        aoRadius: 2.2,
        distanceFalloff: 1.2,
        intensity: tier.ao.intensity,
        aoSamples: tier.ao.samples,
        denoiseSamples: tier.ao.denoiseSamples,
        denoiseRadius: 12,
        // AO is low-frequency: compute it at half resolution and upsample it along depth edges.
        halfRes: true,
        depthAwareUpsampling: true,
        // N8AO otherwise auto-detects transparent materials (the sun disc, glows, glass) and then
        // re-renders the whole scene twice per frame, shadow maps included.
        transparencyAware: false,
        gammaCorrection: false,
      });
      this.composer.addPass(ao);
    }
    // After AO (which multiplies into the colour), before anything that blurs or spreads it.
    this.composer.addPass(sanitizePass());

    const effects: Effect[] = [];
    if (tier.godRays && this.post.sunMesh && !minimal && this.post.godRays !== false) {
      effects.push(
        onlyWhenSunInView(
          new GodRaysEffect(camera, this.post.sunMesh, {
            resolutionScale: tier.godRays.resolutionScale,
            kernelSize: KernelSize.SMALL,
            density: 0.97,
            decay: 0.93,
            weight: 0.32,
            exposure: 0.42,
            samples: tier.godRays.samples,
            clampMax: 1,
          }),
          camera,
          this.post.sunMesh,
        ),
      );
    }
    this.bloom =
      minimal || this.post.bloom === false
        ? null
        : new BloomEffect({
            mipmapBlur: true,
            luminanceThreshold: 0.9,
            luminanceSmoothing: 0.3,
            intensity: 0.85,
            radius: 0.75,
          });
    if (this.bloom) effects.push(this.bloom);
    effects.push(
      new ExposureEffect(this.post.exposure ?? 1.0),
      new ToneMappingEffect({ mode: TONE_MAPS[this.post.toneMap ?? 'aces'] }),
    );
    if (!minimal) {
      effects.push(new GradeEffect(), new VignetteEffect({ offset: 0.28, darkness: 0.55 }));
      if (tier.grain && this.post.grain !== false) {
        const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
        grain.blendMode.opacity.value = 0.05;
        effects.push(grain);
      }
    }
    if (this.post.smaa !== false) effects.push(new SMAAEffect({ preset: tier.smaa }));
    this.composer.addPass(new EffectPass(camera, ...effects));
    this.resize();
  }

  private maxScale(): number {
    return Math.min(window.devicePixelRatio || 1, TIERS[this.quality].maxScale, this.scaleCap);
  }

  private setPixelRatio(ratio: number): void {
    const next = Math.round(ratio * 100) / 100;
    if (next === this.pixelRatio) return;
    this.pixelRatio = next;
    this.sizeDirty = true;
  }
}

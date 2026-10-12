import {
  HalfFloatType,
  NoToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  type Camera,
} from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

export type Quality = 'low' | 'medium' | 'high';

const QUALITY_MAX_PIXEL_RATIO: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };
const TARGET_FRAME_MS = 1000 / 60;

/**
 * WebGL renderer + HDR post-processing chain (bloom, vignette, tone mapping, SMAA)
 * with dynamic resolution: the pixel ratio drifts down when frames run long and back
 * up when there is headroom, so a fanless laptop stays near 60 fps as it warms up.
 */
export class Renderer {
  readonly gl: WebGLRenderer;
  readonly bloom: BloomEffect;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private effectPass: EffectPass;
  private quality: Quality = 'high';
  private pixelRatio: number;
  private dynamicResolution = true;
  private slowFrames = 0;
  private fastFrames = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    camera: Camera,
  ) {
    this.gl = new WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = NoToneMapping; // done in post
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    this.gl.info.autoReset = false;

    this.pixelRatio = Math.min(window.devicePixelRatio, QUALITY_MAX_PIXEL_RATIO[this.quality]);
    this.gl.setPixelRatio(this.pixelRatio);

    this.composer = new EffectComposer(this.gl, { frameBufferType: HalfFloatType });
    this.renderPass = new RenderPass(new Scene(), camera);
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.85,
      luminanceSmoothing: 0.25,
      intensity: 1.15,
      radius: 0.72,
    });
    this.effectPass = new EffectPass(
      camera,
      this.bloom,
      new VignetteEffect({ offset: 0.32, darkness: 0.62 }),
      new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
      new SMAAEffect(),
    );
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.effectPass);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setScene(scene: Scene): void {
    this.renderPass.mainScene = scene;
  }

  setCamera(camera: Camera): void {
    this.renderPass.mainCamera = camera;
    this.effectPass.mainCamera = camera;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.gl.shadowMap.enabled = q !== 'low';
    this.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_MAX_PIXEL_RATIO[q]));
  }

  getQuality(): Quality {
    return this.quality;
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

  private adaptResolution(frameMs: number): void {
    const max = Math.min(window.devicePixelRatio, QUALITY_MAX_PIXEL_RATIO[this.quality]);
    if (frameMs > TARGET_FRAME_MS * 1.2) {
      this.fastFrames = 0;
      if (++this.slowFrames > 30 && this.pixelRatio > 0.6) {
        this.setPixelRatio(Math.max(0.6, this.pixelRatio - 0.1));
        this.slowFrames = 0;
      }
    } else if (frameMs < TARGET_FRAME_MS * 0.8) {
      this.slowFrames = 0;
      if (++this.fastFrames > 180 && this.pixelRatio < max) {
        this.setPixelRatio(Math.min(max, this.pixelRatio + 0.1));
        this.fastFrames = 0;
      }
    }
  }

  private setPixelRatio(ratio: number): void {
    this.pixelRatio = Math.round(ratio * 100) / 100;
    this.gl.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h, false);
    this.onResize?.(w, h);
  }

  onResize?: (width: number, height: number) => void;
}

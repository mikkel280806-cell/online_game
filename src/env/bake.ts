import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { NOISE_GLSL } from './shaders/noise';

export interface BakeOptions {
  /** Width and height in pixels (power of two recommended). */
  size: number;
  /**
   * GLSL that defines `vec4 bake(vec2 uv)`, with uv in [0,1). It can use everything in
   * NOISE_GLSL plus `uniform float uTexel` (= 1/size). Use the periodic noise variants with
   * whole-number periods so the result tiles.
   *
   * Normal maps: define a `float height(vec2 uv)` and sample it at uv ± uTexel to build the
   * normal, then return `vec4(n * 0.5 + 0.5, 1.0)`.
   */
  fragment: string;
  uniforms?: Record<string, IUniform>;
  /**
   * True for colour (albedo) textures: write LINEAR colour from bake(); it is stored as sRGB
   * (better precision in the darks) and decoded back to linear when sampled.
   * False (default) for data: normals, roughness, masks, heights.
   */
  srgb?: boolean;
}

/**
 * Renders a GLSL function into a tileable, mipmapped texture on the GPU, once.
 * Returns the texture; it stays valid for the lifetime of the page.
 */
export function bakeTexture(gl: WebGLRenderer, opts: BakeOptions): Texture {
  const target = new WebGLRenderTarget(opts.size, opts.size, {
    type: UnsignedByteType,
    format: RGBAFormat,
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
    colorSpace: opts.srgb ? SRGBColorSpace : NoColorSpace,
    anisotropy: gl.capabilities.getMaxAnisotropy(),
  });
  const material = new ShaderMaterial({
    uniforms: { ...opts.uniforms, uTexel: { value: 1 / opts.size } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTexel;
      ${NOISE_GLSL}
      ${opts.fragment}
      void main() { gl_FragColor = bake(vUv); }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const previous = gl.getRenderTarget();
  const autoClear = gl.autoClear;
  gl.autoClear = true;
  gl.setRenderTarget(target);
  gl.render(scene, camera);
  gl.setRenderTarget(previous);
  gl.autoClear = autoClear;

  material.dispose();
  quad.geometry.dispose();
  return target.texture;
}

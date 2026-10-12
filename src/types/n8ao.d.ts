// n8ao ships no type declarations; this covers the parts the renderer uses.
declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import { Pass } from 'postprocessing';

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoSamples: number;
      aoRadius: number;
      denoiseSamples: number;
      denoiseRadius: number;
      distanceFalloff: number;
      intensity: number;
      halfRes: boolean;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      [key: string]: unknown;
    };
    setSize(width: number, height: number): void;
  }
}

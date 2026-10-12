// Cheap light effects: glow sprites (beacons, strobes, flickering lamps) and additive light cones.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Matrix4,
  Mesh,
  Points,
  Quaternion,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGlowMaterial, createLightConeMaterial } from './materials';
import { PartBuilder, type Kit } from './builder';
import { quad } from './shapes';
import type { DecalAtlas } from './textures';

export const GlowMode = { Steady: 0, Beacon: 1, Flicker: 2, Strobe: 3 } as const;
export type GlowMode = (typeof GlowMode)[keyof typeof GlowMode];

export class GlowSet {
  private pos: number[] = [];
  private col: number[] = [];
  private par: number[] = [];

  /** colour is HDR (multiplied by intensity); size in metres; minPx keeps far lights visible. */
  add(p: Vector3, color: ColorRepresentation, intensity: number, size: number, mode: GlowMode, phase = 0, minPx = 2.5): void {
    const c = new Color(color).multiplyScalar(intensity);
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    this.par.push(size, mode, phase, minPx);
  }

  build(): Points | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aParams', new BufferAttribute(new Float32Array(this.par), 4));
    g.computeBoundingSphere();
    const mat = createGlowMaterial();
    const pts = new Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    const size = new Vector2();
    pts.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(size);
      mat.uniforms.uScale.value = size.y * camera.projectionMatrix.elements[5] * 0.5;
    };
    return pts;
  }
}

export class ConeSet {
  private parts: BufferGeometry[] = [];

  /** Cone from the lamp at `from` toward `to`; radius at the lamp and at the far end. */
  add(from: Vector3, to: Vector3, r0: number, r1: number, flicker = false): void {
    const dir = new Vector3().subVectors(to, from);
    const len = dir.length();
    const g = new CylinderGeometry(r0, r1, len, 28, 1, true);
    // CylinderGeometry: +Y top (uv.y = 1) → put the top at the lamp.
    g.translate(0, -len / 2, 0);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), dir.normalize());
    g.applyMatrix4(new Matrix4().compose(from, q, new Vector3(1, 1, 1)));
    const n = g.attributes.position.count;
    g.setAttribute('aFlicker', new BufferAttribute(new Float32Array(n).fill(flicker ? 1 : 0), 1));
    this.parts.push(g);
  }

  build(): Mesh | null {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false)!;
    const m = new Mesh(g, createLightConeMaterial());
    m.renderOrder = 9;
    return m;
  }
}

/** Stencil decal quad (facing +Z in `m`), width in metres, colour = paint. */
export function addDecal(b: PartBuilder | Kit, atlas: DecalAtlas, name: string, width: number, color: ColorRepresentation, m: Matrix4, rough = 0.62): void {
  const r = atlas.rect(name);
  const g = quad(width, width / r.aspect, r);
  const builder = b instanceof PartBuilder ? b : b.decal;
  builder.add(g, { color, rough, panel: 0, metal: 0 }, m);
}

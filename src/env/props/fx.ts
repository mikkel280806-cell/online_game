// Cheap light effects: glow sprites (beacons, strobes, failing lamps) and additive light cones.

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

/**
 * How a glow sprite animates. Outpost and ship lights are Steady (or Beacon/Strobe for warning
 * lights); Failing is a subtle shimmer reserved for the dead ship's emergency lights.
 */
export const GlowMode = { Steady: 0, Beacon: 1, Failing: 2, Strobe: 3 } as const;
export type GlowMode = (typeof GlowMode)[keyof typeof GlowMode];

export class GlowSet {
  private pos: number[] = [];
  private col: number[] = [];
  private par: number[] = [];
  private dir: number[] = [];

  /**
   * colour is HDR (multiplied by intensity); size in metres; minPx keeps far lights visible.
   * `facing` (world direction) makes it a lamp face: the glare fades out as the camera swings
   * behind it, instead of a sprite being sliced by the lamp's own housing.
   */
  add(p: Vector3, color: ColorRepresentation, intensity: number, size: number, mode: GlowMode, phase = 0, minPx = 2.5, facing?: Vector3): void {
    const c = new Color(color).multiplyScalar(intensity);
    this.pos.push(p.x, p.y, p.z);
    this.col.push(c.r, c.g, c.b);
    this.par.push(size, mode, phase, minPx);
    const d = facing ? facing.clone().normalize() : new Vector3();
    this.dir.push(d.x, d.y, d.z);
  }

  build(): Points | null {
    if (!this.pos.length) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aParams', new BufferAttribute(new Float32Array(this.par), 4));
    g.setAttribute('aDir', new BufferAttribute(new Float32Array(this.dir), 3));
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
  add(from: Vector3, to: Vector3, r0: number, r1: number): void {
    const dir = new Vector3().subVectors(to, from);
    const len = dir.length();
    const g = new CylinderGeometry(r0, r1, len, 28, 1, true);
    // CylinderGeometry: +Y top (uv.y = 1) → put the top at the lamp.
    g.translate(0, -len / 2, 0);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), dir.normalize());
    g.applyMatrix4(new Matrix4().compose(from, q, new Vector3(1, 1, 1)));
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

/**
 * Stencil wrapped around a cylinder whose axis is local X in `m` (radius R, centred on the
 * origin): text runs along the axis, centred at the given angle (0 = +Z, positive toward +Y).
 */
export function addCylinderDecal(b: PartBuilder, atlas: DecalAtlas, name: string, width: number, color: ColorRepresentation, m: Matrix4, R: number, angle: number, lift = 0.006): void {
  const r = atlas.rect(name);
  const h = width / r.aspect;
  const rr = R + lift;
  const da = h / rr;
  const nu = 2;
  const nv = Math.max(2, Math.ceil(da / 0.08));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const a = angle - da / 2 + (da * j) / nv;
      pos.push(-width / 2 + (width * i) / nu, Math.sin(a) * rr, Math.cos(a) * rr);
      nor.push(0, Math.sin(a), Math.cos(a));
      uv.push(r.u0 + ((r.u1 - r.u0) * i) / nu, r.v0 + ((r.v1 - r.v0) * j) / nv);
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const k = i * (nv + 1) + j;
      idx.push(k, k + nv + 1, k + 1, k + 1, k + nv + 1, k + nv + 2);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  b.add(g, { color, rough: 0.62, panel: 0, metal: 0 }, m);
}

// Builds the EVA suit as one skinned geometry (plus a separate visor), in bind pose.
// Every part carries per-vertex surface data for the suit uber-material (materials.ts).

import {
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Shape,
  TubeGeometry,
  Uint16BufferAttribute,
  Vector3,
  BoxGeometry,
  Euler,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROLES, type RoleId } from '../game/roles';
import {
  bearingRing,
  convolute,
  lathe,
  mergeSimple,
  ringPoint,
  ringTube,
  sampleRings,
  shellPlate,
  stencilText,
  type Ring,
} from './geometry';
import { EMIT, SURF, type SurfType } from './materials';
import { BONE, DIM, JOINTS } from './rig';

// ---------------------------------------------------------------------------------------------
// Part builder

export interface PartSpec {
  /** Linear albedo. */
  color: Color;
  type: SurfType;
  rough: number;
  metal?: number;
  /** Extra paint wear everywhere (0..1); geometry `edge` attributes add to it. */
  wear?: number;
  /** HDR emissive colour and channel (EMIT.*). */
  emit?: Color;
  emitCh?: number;
  /** Ambient occlusion multiplier (1 = none). */
  ao?: number;
  /** Grime/dust multiplier (1 = default, 0 = none). */
  dirt?: number;
  /** Multiplies the part's UVs. */
  uv?: number | [number, number];
}

/** A bone index, or a function giving two bones and their weights for a bind-pose point. */
export type Skin = number | ((p: Vector3) => [number, number, number, number]);

interface Part {
  geo: BufferGeometry;
  spec: PartSpec;
  skin: Skin;
}

export class SuitBuilder {
  private parts: Part[] = [];
  /** Label for the parts added next (for the triangle breakdown). */
  section = 'misc';
  /** Triangles per section. */
  readonly stats = new Map<string, number>();

  add(geo: BufferGeometry, spec: PartSpec, skin: Skin, matrix?: Matrix4): void {
    if (matrix) geo.applyMatrix4(matrix);
    this.parts.push({ geo, spec, skin });
    const tris = (geo.getIndex()?.count ?? geo.getAttribute('position').count) / 3;
    this.stats.set(this.section, (this.stats.get(this.section) ?? 0) + tris);
  }

  get triangleCount(): number {
    let n = 0;
    for (const p of this.parts) n += (p.geo.getIndex()?.count ?? p.geo.getAttribute('position').count) / 3;
    return n;
  }

  build(): BufferGeometry {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const surf: number[] = [];
    const emit: number[] = [];
    const aux: number[] = [];
    const si: number[] = [];
    const sw: number[] = [];
    const idx: number[] = [];
    const p = new Vector3();
    let base = 0;
    for (const { geo, spec, skin } of this.parts) {
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      const gp = geo.getAttribute('position');
      const gn = geo.getAttribute('normal');
      const gu = geo.getAttribute('uv');
      const ge = geo.getAttribute('edge');
      const us = typeof spec.uv === 'number' ? [spec.uv, spec.uv] : (spec.uv ?? [1, 1]);
      const e = spec.emit ?? new Color(0, 0, 0);
      for (let i = 0; i < gp.count; i++) {
        p.set(gp.getX(i), gp.getY(i), gp.getZ(i));
        pos.push(p.x, p.y, p.z);
        nor.push(gn.getX(i), gn.getY(i), gn.getZ(i));
        uv.push(gu ? gu.getX(i) * us[0] : 0, gu ? gu.getY(i) * us[1] : 0);
        col.push(spec.color.r, spec.color.g, spec.color.b);
        const wear = Math.min(1, (spec.wear ?? 0) + (ge ? ge.getX(i) : 0));
        surf.push(spec.rough, spec.metal ?? 0, spec.type, wear);
        emit.push(e.r, e.g, e.b, spec.emitCh ?? EMIT.strip);
        aux.push(spec.ao ?? 1, spec.dirt ?? 1);
        if (typeof skin === 'number') {
          si.push(skin, 0, 0, 0);
          sw.push(1, 0, 0, 0);
        } else {
          const [b0, w0, b1, w1] = skin(p);
          si.push(b0, b1, 0, 0);
          sw.push(w0, w1, 0, 0);
        }
      }
      const gi = geo.getIndex();
      if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + base);
      else for (let i = 0; i < gp.count; i++) idx.push(i + base);
      base += gp.count;
      geo.dispose();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('surf', new Float32BufferAttribute(surf, 4));
    g.setAttribute('emit', new Float32BufferAttribute(emit, 4));
    g.setAttribute('aux', new Float32BufferAttribute(aux, 2));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Blend between bones along Y: stops sorted by ascending y. */
function chain(stops: [number, number][]): Skin {
  return (p) => {
    if (p.y <= stops[0][0]) return [stops[0][1], 1, 0, 0];
    for (let i = 0; i < stops.length - 1; i++) {
      const [y0, b0] = stops[i];
      const [y1, b1] = stops[i + 1];
      if (p.y <= y1) {
        if (b0 === b1) return [b0, 1, 0, 0];
        const w = smooth(y0, y1, p.y);
        return [b0, 1 - w, b1, w];
      }
    }
    return [stops[stops.length - 1][1], 1, 0, 0];
  };
}

const T = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
const TR = (pos: Vector3 | [number, number, number], rot: [number, number, number], scale?: [number, number, number]) => {
  const v = Array.isArray(pos) ? new Vector3(...pos) : pos;
  return new Matrix4().compose(v, new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...(scale ?? [1, 1, 1])));
};

function rbox(w: number, h: number, d: number, r: number, seg = 2): BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
}

/** Plain box for parts too small to need a bevel. */
function box(w: number, h: number, d: number): BufferGeometry {
  return new BoxGeometry(w, h, d);
}

/** Capsule from a to b. */
function capsule(a: Vector3, b: Vector3, r: number, radial = 8, cap = 3): BufferGeometry {
  const len = a.distanceTo(b);
  const g = new CapsuleGeometry(r, len, cap, radial);
  const dir = b.clone().sub(a).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.applyMatrix4(new Matrix4().compose(mid, q, new Vector3(1, 1, 1)));
  return g;
}

/** Cylinder along an axis from a to b. */
function cylinder(a: Vector3, b: Vector3, r0: number, r1: number, radial = 12, open = false): BufferGeometry {
  const len = a.distanceTo(b);
  const g = new CylinderGeometry(r1, r0, len, radial, 1, open);
  const dir = b.clone().sub(a).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.applyMatrix4(new Matrix4().compose(mid, q, new Vector3(1, 1, 1)));
  return g;
}

/** Hose along points; uv.x counts corrugation ridges along the length. */
function hose(points: Vector3[], r: number, segs = 40, radial = 7): BufferGeometry {
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const g = new TubeGeometry(curve, segs, r, radial, false);
  const len = curve.getLength();
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / 0.011), uv.getY(i));
  return g;
}

/** Resample rings between two heights (inclusive), `n` rows. */
function band(rings: Ring[], y0: number, y1: number, n: number): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < n; i++) out.push(sampleRings(rings, y0 + ((y1 - y0) * i) / (n - 1)));
  return out;
}

function offsetRings(rings: Ring[], dx: number, dz = 0): Ring[] {
  return rings.map((r) => ({ ...r, cx: (r.cx ?? 0) + dx, cz: (r.cz ?? 0) + dz }));
}

/** Lathe UVs: u around (scaled to roughly `tile` m per unit), v along the profile. */
function scaleLatheUv(g: BufferGeometry, circumference: number, tile = 0.2): BufferGeometry {
  const uv = g.getAttribute('uv');
  const k = Math.max(1, Math.round(circumference / tile));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * 0.3);
  return g;
}

/** Point on an ellipsoid (centre c, radii r) in direction d, pushed out by `grow`. */
function ellipsoidPoint(c: Vector3, r: Vector3, d: Vector3, grow: number, out: Vector3): Vector3 {
  return out.set(c.x + d.x * (r.x + grow), c.y + d.y * (r.y + grow), c.z + d.z * (r.z + grow));
}

/** Direction from helmet-style spherical coordinates: lon 0 = back, PI = front; lat up from the equator. */
function sph(lon: number, lat: number, out: Vector3): Vector3 {
  return out.set(Math.sin(lon) * Math.cos(lat), Math.sin(lat), -Math.cos(lon) * Math.cos(lat));
}

/**
 * A thick plate on an ellipsoid, parametrised by dir(u, v) for u, v in [0, 1]. Rounded rim.
 */
function ellipsoidPlate(
  c: Vector3,
  r: Vector3,
  dir: (u: number, v: number, out: Vector3) => Vector3,
  nu: number,
  nv: number,
  offset: number,
  thick: number,
): BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  const d = new Vector3();
  const p = new Vector3();
  const bevel = Math.min(thick * 0.5, 0.004);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const b = Math.min(i, nu - i, j, nv - j);
      dir(i / nu, j / nv, d);
      ellipsoidPoint(c, r, d, offset - (b === 0 ? bevel : 0), p);
      pos.push(p.x, p.y, p.z);
      uvs.push((i / nu) * 0.6, (j / nv) * 1.2);
      edge.push(b === 0 ? 1 : b === 1 ? 0.5 : 0);
    }
  }
  const cols = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i;
      idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  const outer = new BufferGeometry();
  outer.setAttribute('position', new Float32BufferAttribute(pos, 3));
  outer.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  outer.setAttribute('edge', new Float32BufferAttribute(edge, 1));
  outer.setIndex(idx);
  outer.computeVertexNormals();
  // Make sure the outer surface faces away from the centre.
  const n0 = outer.getAttribute('normal');
  const mid = Math.floor(pos.length / 6);
  const pm = new Vector3(pos[mid * 3], pos[mid * 3 + 1], pos[mid * 3 + 2]).sub(c);
  const flipped = pm.dot(new Vector3(n0.getX(mid), n0.getY(mid), n0.getZ(mid))) < 0;
  if (flipped) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    outer.setIndex(idx);
    outer.computeVertexNormals();
  }
  // Rim.
  const loop: [number, number][] = [];
  for (let i = 0; i <= nu; i++) loop.push([i, 0]);
  for (let j = 1; j <= nv; j++) loop.push([nu, j]);
  for (let i = nu - 1; i >= 0; i--) loop.push([i, nv]);
  for (let j = nv - 1; j > 0; j--) loop.push([0, j]);
  const rp: number[] = [];
  const ri: number[] = [];
  for (let k = 0; k <= loop.length; k++) {
    const [i, j] = loop[k % loop.length];
    dir(i / nu, j / nv, d);
    ellipsoidPoint(c, r, d, offset - bevel, p);
    rp.push(p.x, p.y, p.z);
    ellipsoidPoint(c, r, d, offset - thick, p);
    rp.push(p.x, p.y, p.z);
  }
  for (let k = 0; k < loop.length; k++) {
    const a = k * 2;
    if (flipped) ri.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    else ri.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const rim = new BufferGeometry();
  rim.setAttribute('position', new Float32BufferAttribute(rp, 3));
  rim.setAttribute('uv', new Float32BufferAttribute(new Array((rp.length / 3) * 2).fill(0), 2));
  rim.setAttribute('edge', new Float32BufferAttribute(new Array(rp.length / 3).fill(1), 1));
  rim.setIndex(ri);
  rim.computeVertexNormals();
  return mergeSimple([outer, rim]);
}

// ---------------------------------------------------------------------------------------------
// Palette

const C = (hex: string) => new Color(hex);

function palette(role: RoleId) {
  const accent = ROLES[role].accent.clone();
  // Paint, not plastic: slightly desaturated and darker than the UI accent.
  const hsl = { h: 0, s: 0, l: 0 };
  accent.getHSL(hsl);
  const paint = new Color().setHSL(hsl.h, hsl.s * 0.78, hsl.l * 0.76);
  return {
    fabric: C('#bdbab2'),
    fabricShade: C('#a9a69e'),
    fabricDark: C('#55575a'),
    glove: C('#8f8d88'),
    shell: C('#c7c6c1'),
    shellGrey: C('#8d9095'),
    gunmetal: C('#2f3237'),
    metal: C('#b4b7bc'),
    darkMetal: C('#5a5e64'),
    rubber: C('#1e1f21'),
    bootCap: C('#62666c'),
    boot: C('#a7a6a0'),
    hazard: C('#c99a1f'),
    tank: C('#5c6067'),
    tape: C('#2e3236'),
    text: C('#c9c6bd'),
    accent: paint,
    glow: ROLES[role].color.clone().multiplyScalar(1.5),
    lamp: new Color(2.4, 2.65, 3.0),
    screen: ROLES[role].color.clone().multiplyScalar(0.55),
  };
}

// ---------------------------------------------------------------------------------------------
// Body profiles (bind pose, mesh space)

export const TORSO: Ring[] = [
  { y: 0.99, rx: 0.146, rz: 0.11, n: 2.5 },
  { y: 1.05, rx: 0.147, rz: 0.112, n: 2.5 },
  { y: 1.12, rx: 0.15, rz: 0.118, rzb: 0.113, cz: 0.004, n: 2.5 },
  { y: 1.18, rx: 0.157, rz: 0.125, rzb: 0.117, cz: 0.006, n: 2.6 },
  { y: 1.25, rx: 0.166, rz: 0.132, rzb: 0.123, cz: 0.008, n: 2.7 },
  { y: 1.32, rx: 0.174, rz: 0.136, rzb: 0.127, cz: 0.008, n: 2.8 },
  { y: 1.38, rx: 0.183, rz: 0.135, rzb: 0.129, cz: 0.006, n: 2.9 },
  { y: 1.43, rx: 0.188, rz: 0.128, rzb: 0.126, cz: 0.002, n: 3.0 },
  { y: 1.465, rx: 0.172, rz: 0.117, rzb: 0.117, n: 2.8 },
  { y: 1.493, rx: 0.135, rz: 0.104, n: 2.3 },
  { y: 1.515, rx: 0.104, rz: 0.092, n: 2.0 },
];

const PELVIS: Ring[] = [
  { y: 0.835, rx: 0.07, rz: 0.055, n: 2.0 },
  { y: 0.85, rx: 0.13, rz: 0.09, n: 2.1 },
  { y: 0.875, rx: 0.165, rz: 0.11, rzb: 0.116, n: 2.2 },
  { y: 0.92, rx: 0.183, rz: 0.12, rzb: 0.128, n: 2.3 },
  { y: 0.97, rx: 0.184, rz: 0.124, rzb: 0.13, n: 2.4 },
  { y: 1.02, rx: 0.17, rz: 0.12, rzb: 0.124, n: 2.5 },
  { y: 1.07, rx: 0.155, rz: 0.117, rzb: 0.117, n: 2.5 },
  { y: 1.1, rx: 0.151, rz: 0.115, n: 2.5 },
];

const LEG_BASE: Ring[] = [
  { y: 0.125, rx: 0.047, rz: 0.049 },
  { y: 0.18, rx: 0.051, rz: 0.053 },
  { y: 0.25, rx: 0.056, rz: 0.057, rzb: 0.061, cz: -0.003 },
  { y: 0.32, rx: 0.06, rz: 0.058, rzb: 0.07, cz: -0.004 },
  { y: 0.39, rx: 0.062, rz: 0.059, rzb: 0.071, cz: -0.004 },
  { y: 0.46, rx: 0.062, rz: 0.062, rzb: 0.063 },
  { y: 0.6, rx: 0.067, rz: 0.068 },
  { y: 0.68, rx: 0.073, rz: 0.075, cz: 0.004 },
  { y: 0.76, rx: 0.08, rz: 0.083, cz: 0.006 },
  { y: 0.84, rx: 0.087, rz: 0.089, rzb: 0.091, cz: 0.006 },
  { y: 0.91, rx: 0.09, rz: 0.091, rzb: 0.095, cz: 0.004 },
  { y: 0.97, rx: 0.085, rz: 0.088, rzb: 0.092 },
  { y: 1.01, rx: 0.076, rz: 0.082 },
];

const ARM_BASE: Ring[] = [
  { y: 0.872, rx: 0.042, rz: 0.042 },
  { y: 0.9, rx: 0.045, rz: 0.044 },
  { y: 0.95, rx: 0.049, rz: 0.049 },
  { y: 1.01, rx: 0.053, rz: 0.053 },
  { y: 1.08, rx: 0.056, rz: 0.056 },
  { y: 1.19, rx: 0.06, rz: 0.06 },
  { y: 1.26, rx: 0.064, rz: 0.064 },
  { y: 1.33, rx: 0.068, rz: 0.067 },
  { y: 1.39, rx: 0.071, rz: 0.07 },
  { y: 1.435, rx: 0.068, rz: 0.068 },
  { y: 1.46, rx: 0.058, rz: 0.058 },
];

const BOOT: Ring[] = [
  { y: -0.066, rx: 0.058, rz: 0.188, rzb: 0.082, n: 2.8 },
  { y: -0.05, rx: 0.06, rz: 0.19, rzb: 0.083, n: 2.8 },
  { y: -0.034, rx: 0.059, rz: 0.178, rzb: 0.081, n: 2.6 },
  { y: -0.017, rx: 0.057, rz: 0.148, rzb: 0.078, n: 2.4 },
  { y: 0.002, rx: 0.055, rz: 0.108, rzb: 0.073, n: 2.3 },
  { y: 0.028, rx: 0.053, rz: 0.074, rzb: 0.067, n: 2.2 },
  { y: 0.062, rx: 0.053, rz: 0.061, rzb: 0.062 },
  { y: 0.1, rx: 0.055, rz: 0.058, rzb: 0.06 },
  { y: 0.124, rx: 0.06, rz: 0.062, rzb: 0.064 },
  { y: 0.139, rx: 0.058, rz: 0.06, rzb: 0.062 },
  { y: 0.145, rx: 0.05, rz: 0.052 },
];

/** Helmet ellipsoid (mesh space). */
export const HELMET = { c: new Vector3(0, 1.66, 0.012), r: new Vector3(0.158, 0.152, 0.17) };
/** Visor window in helmet spherical coordinates (half-widths in radians, superellipse power). */
const VISOR = { lonHalf: 1.12, latC: 0.06, latHalf: 0.6, p: 3.6 };

// ---------------------------------------------------------------------------------------------

export interface SuitGeometry {
  body: BufferGeometry;
  /** Visor geometry in the head bone's local space. */
  visor: BufferGeometry;
  triangles: number;
  /** Triangles per body section. */
  stats: Map<string, number>;
}

export function buildSuit(role: RoleId): SuitGeometry {
  const pal = palette(role);
  const b = new SuitBuilder();
  const fabric = (color = pal.fabric, extra: Partial<PartSpec> = {}): PartSpec => ({ color, type: SURF.fabric, rough: 0.86, ...extra });
  const shell = (color = pal.shell, extra: Partial<PartSpec> = {}): PartSpec => ({ color, type: SURF.shell, rough: 0.42, ...extra });
  const metal = (color = pal.metal, extra: Partial<PartSpec> = {}): PartSpec => ({ color, type: SURF.metal, rough: 0.3, metal: 1, ...extra });
  const rubber = (color = pal.rubber, extra: Partial<PartSpec> = {}): PartSpec => ({ color, type: SURF.rubber, rough: 0.82, ...extra });
  const glow = (color: Color, ch: number = EMIT.strip): PartSpec => ({ color: C('#1a1c1e'), type: SURF.glass, rough: 0.2, emit: color, emitCh: ch, dirt: 0 });

  b.section = 'torso';
  buildTorso(b, pal, fabric, shell, metal, rubber, glow, role);
  for (const side of [1, -1] as const) {
    b.section = 'legs';
    buildLeg(b, side, pal, fabric, shell, metal, rubber);
    b.section = 'arms';
    buildArm(b, side, pal, fabric, shell, metal, rubber, glow);
  }
  b.section = 'helmet';
  buildHelmet(b, pal, shell, metal, rubber, glow);
  b.section = 'backpack';
  buildBackpack(b, pal, shell, metal, rubber, glow, role);

  const visor = buildVisor();
  const triangles = b.triangleCount + (visor.getIndex()?.count ?? 0) / 3;
  b.stats.set('visor', (visor.getIndex()?.count ?? 0) / 3);
  return { body: b.build(), visor, triangles, stats: b.stats };
}

type Mk = (color?: Color, extra?: Partial<PartSpec>) => PartSpec;
type Pal = ReturnType<typeof palette>;

// ---------------------------------------------------------------------------------------------
// Torso, pelvis, chest details

function buildTorso(b: SuitBuilder, pal: Pal, fabric: Mk, shell: Mk, metal: Mk, rubber: Mk, glow: (c: Color, ch?: number) => PartSpec, role: RoleId): void {
  // Soft upper body with bellows at the waist.
  const torso = convolute(TORSO, 1.085, 1.165, 2, 0.006);
  b.add(
    ringTube(torso, 24, { panelWidth: 0.19, panelLength: 0.2 }),
    fabric(),
    chain([
      [1.02, BONE.pelvis],
      [1.1, BONE.spine],
      [1.16, BONE.spine],
      [1.27, BONE.chest],
    ]),
  );
  // Lower torso assembly (briefs).
  b.add(ringTube(PELVIS, 26, { capStart: true, panelWidth: 0.2, panelLength: 0.16 }), fabric(pal.fabricShade), BONE.pelvis);

  // Waist bearing: two brushed rings with a dark gap.
  const waist = bearingRing(0.142, 0.158, 0.03, 28);
  waist.applyMatrix4(new Matrix4().makeScale(1, 1, 0.79));
  b.add(scaleLatheUv(waist, 0.9), metal(), BONE.pelvis, T(0, 1.075, 0.002));
  // Belt under it.
  b.add(
    ringTube(band(PELVIS, 1.0, 1.045, 3), 26, { grow: 0.007, panelWidth: 0.1 }),
    rubber(pal.fabricDark, { rough: 0.75 }),
    BONE.pelvis,
  );
  // Hip plates hide where the thighs leave the briefs.
  for (const side of [1, -1]) {
    const mid = side > 0 ? Math.PI / 2 : Math.PI * 1.5;
    b.add(shellPlate(band(PELVIS, 0.875, 0.995, 5), mid - 0.62, mid + 0.62, 10, { offset: 0.011, thick: 0.012 }), shell(pal.shell, { wear: 0.05 }), BONE.pelvis);
    // Buckle on the belt.
    const p = ringPoint(sampleRings(PELVIS, 1.022), mid + side * 0.45, new Vector3(), 0.012);
    b.add(box(0.03, 0.03, 0.012), metal(pal.darkMetal, { rough: 0.4 }), BONE.pelvis, TR(p, [0, mid, 0]));
  }
  // Utility pouch on the right hip, tether reel on the left (Tether) or a sample pouch (Vanguard).
  {
    const p = ringPoint(sampleRings(PELVIS, 0.96), Math.PI * 1.27, new Vector3(), 0.028);
    b.add(rbox(0.075, 0.07, 0.04, 0.012, 1), fabric(pal.fabricDark, { rough: 0.8 }), BONE.pelvis, TR(p, [0, Math.PI * 1.27 + Math.PI, 0]));
    const f = ringPoint(sampleRings(PELVIS, 0.985), Math.PI * 1.27, new Vector3(), 0.05);
    b.add(rbox(0.078, 0.028, 0.012, 0.005, 1), fabric(pal.fabricDark, { rough: 0.8 }), BONE.pelvis, TR(f, [0.2, Math.PI * 1.27 + Math.PI, 0]));
  }
  if (role === 'tether') {
    const p = ringPoint(sampleRings(PELVIS, 0.95), Math.PI * 0.6, new Vector3(), 0.03);
    const axis = new Vector3(Math.sin(Math.PI * 0.6), 0, -Math.cos(Math.PI * 0.6));
    b.add(cylinder(p.clone().addScaledVector(axis, -0.02), p.clone().addScaledVector(axis, 0.03), 0.052, 0.052, 16), shell(pal.accent), BONE.pelvis);
    b.add(cylinder(p.clone().addScaledVector(axis, 0.03), p.clone().addScaledVector(axis, 0.036), 0.04, 0.03, 16), metal(pal.darkMetal), BONE.pelvis);
    b.add(cylinder(p.clone().addScaledVector(axis, 0.0), p.clone().addScaledVector(axis, 0.006), 0.056, 0.056, 16, true), glow(pal.glow), BONE.pelvis);
  } else {
    const p = ringPoint(sampleRings(PELVIS, 0.955), Math.PI * 0.62, new Vector3(), 0.026);
    b.add(rbox(0.06, 0.08, 0.036, 0.01, 1), shell(pal.shellGrey), BONE.pelvis, TR(p, [0, Math.PI * 0.62 + Math.PI, 0]));
  }

  // Hard upper torso: chest plate with an accent band, back plate under the pack.
  const chestRings = band(TORSO, 1.19, 1.455, 8);
  b.add(shellPlate(chestRings, Math.PI - 1.42, Math.PI + 1.42, 20, { offset: 0.012, thick: 0.014 }), shell(), BONE.chest);
  b.add(shellPlate(band(TORSO, 1.392, 1.432, 3), Math.PI - 1.2, Math.PI + 1.2, 20, { offset: 0.027, thick: 0.008 }), shell(pal.accent), BONE.chest);
  // Centre rib where the two halves of the chest plate meet.
  b.add(shellPlate(band(TORSO, 1.215, 1.39, 4), Math.PI - 0.035, Math.PI + 0.035, 2, { offset: 0.017, thick: 0.007 }), shell(pal.shellGrey, { wear: 0.3 }), BONE.chest);
  b.add(shellPlate(band(TORSO, 1.2, 1.46, 6), -1.3, 1.3, 16, { offset: 0.01, thick: 0.012 }), shell(pal.shellGrey), BONE.chest);
  // Shoulder yoke: the plate between neck ring and shoulders.
  b.add(shellPlate(band(TORSO, 1.44, 1.497, 4), Math.PI * 0.5 - 1.1, Math.PI * 0.5 + 1.1, 10, { offset: 0.008, thick: 0.01 }), shell(), BONE.chest);
  b.add(shellPlate(band(TORSO, 1.44, 1.497, 4), Math.PI * 1.5 - 1.1, Math.PI * 1.5 + 1.1, 10, { offset: 0.008, thick: 0.01 }), shell(), BONE.chest);

  // Display and control module on the chest.
  const dcm = new Vector3(0, 1.205, 0.168);
  b.add(rbox(0.19, 0.082, 0.07, 0.014, 1), shell(pal.shellGrey), BONE.chest, T(dcm.x, dcm.y, dcm.z));
  b.add(rbox(0.172, 0.022, 0.06, 0.006, 1), shell(pal.gunmetal, { rough: 0.5 }), BONE.chest, T(dcm.x, dcm.y + 0.046, dcm.z + 0.002));
  b.add(rbox(0.07, 0.03, 0.004, 0.0015, 1), glow(pal.screen, EMIT.screen), BONE.chest, TR([dcm.x - 0.035, dcm.y + 0.004, dcm.z + 0.036], [0, 0, 0]));
  for (const k of [-0.065, 0.05, 0.075]) {
    b.add(cylinder(new Vector3(k, dcm.y + 0.055, dcm.z + 0.005), new Vector3(k, dcm.y + 0.072, dcm.z + 0.005), 0.009, 0.008, 10), metal(pal.darkMetal, { rough: 0.45 }), BONE.chest);
  }
  b.add(box(0.012, 0.018, 0.012), shell(pal.hazard), BONE.chest, T(0.04, dcm.y + 0.0, dcm.z + 0.036));
  // Hose connectors either side of the DCM.
  for (const s of [1, -1]) {
    b.add(cylinder(new Vector3(s * 0.088, dcm.y - 0.01, dcm.z - 0.005), new Vector3(s * 0.115, dcm.y - 0.012, dcm.z - 0.012), 0.019, 0.019, 14), metal(), BONE.chest);
    b.add(bearingRing(0.017, 0.022, 0.01, 12, false), metal(pal.accent, { metal: 0.3, rough: 0.4 }), BONE.chest, TR([s * 0.112, dcm.y - 0.012, dcm.z - 0.012], [0, 0, s * Math.PI / 2]));
  }

  // Name tape on the right chest.
  {
    const th = Math.PI + 0.62;
    const p = ringPoint(sampleRings(TORSO, 1.355), th, new Vector3(), 0.028);
    const yaw = Math.atan2(Math.sin(th), -Math.cos(th));
    const m = TR(p, [-0.12, yaw, 0]);
    b.add(rbox(0.105, 0.026, 0.006, 0.0025, 1), fabric(pal.tape, { rough: 0.9, uv: 0.4 }), BONE.chest, m);
    const text = stencilText(ROLES[role].name, 0.0024);
    text.applyMatrix4(new Matrix4().makeTranslation(0, 0, 0.0034));
    b.add(text, { color: pal.text, type: SURF.glass, rough: 0.8, dirt: 0.3 }, BONE.chest, m);
  }
  // Role light on the left chest.
  {
    const th = Math.PI - 0.62;
    const p = ringPoint(sampleRings(TORSO, 1.355), th, new Vector3(), 0.03);
    const yaw = Math.atan2(Math.sin(th), -Math.cos(th));
    const m = TR(p, [-0.12, yaw, 0]);
    b.add(rbox(0.05, 0.026, 0.008, 0.003, 1), shell(pal.gunmetal), BONE.chest, m);
    b.add(box(0.038, 0.007, 0.004), glow(pal.glow), BONE.chest, m.clone().multiply(T(0, 0.003, 0.004)));
  }

  // Neck ring: lower race on the torso.
  const neck = bearingRing(0.1, 0.136, 0.034, 32);
  neck.applyMatrix4(new Matrix4().makeScale(1, 1, 0.94));
  b.add(scaleLatheUv(neck, 0.8), metal(), BONE.chest, T(0, 1.507, 0.0));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const p = new Vector3(Math.sin(a) * 0.138, 1.507, -Math.cos(a) * 0.13);
    b.add(box(0.026, 0.022, 0.016), metal(pal.darkMetal, { rough: 0.4 }), BONE.chest, TR(p, [0, a, 0]));
  }
}

// ---------------------------------------------------------------------------------------------
// Legs and boots

function buildLeg(b: SuitBuilder, side: 1 | -1, pal: Pal, fabric: Mk, shell: Mk, metal: Mk, rubber: Mk): void {
  const L = side > 0;
  const thigh = L ? BONE.thighL : BONE.thighR;
  const shin = L ? BONE.shinL : BONE.shinR;
  const foot = L ? BONE.footL : BONE.footR;
  const x = side * DIM.hipX;
  const rings = offsetRings(convolute(LEG_BASE, 0.468, 0.585, 3, 0.0075), x);
  // Seam on the inside of the leg: start the tube's u on the inner side.
  const t0 = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  b.add(
    ringTube(rings, 16, { theta0: t0, theta1: t0 + Math.PI * 2, panelWidth: 0.16, panelLength: 0.26 }),
    fabric(),
    chain([
      [0.145, foot],
      [0.19, shin],
      [0.47, shin],
      [0.58, thigh],
      [0.9, thigh],
      [1.09, BONE.pelvis],
    ]),
  );
  const smoothLeg = offsetRings(LEG_BASE, x);
  // Thigh bearing ring.
  const tb = bearingRing(0.0855, 0.095, 0.022, 20, false);
  b.add(scaleLatheUv(tb, 0.6), metal(pal.metal), thigh, T(x, 0.82, 0.006));
  // Cargo pocket on the outer thigh.
  {
    const th = side > 0 ? Math.PI / 2 + 0.25 : Math.PI * 1.5 - 0.25;
    const p = ringPoint(sampleRings(smoothLeg, 0.69), th, new Vector3(), 0.016);
    const yaw = Math.atan2(Math.sin(th), -Math.cos(th));
    b.add(rbox(0.085, 0.11, 0.032, 0.012, 1), fabric(pal.fabricShade, { uv: 0.6 }), thigh, TR(p, [0, yaw, 0]));
    const f = ringPoint(sampleRings(smoothLeg, 0.735), th, new Vector3(), 0.034);
    b.add(rbox(0.09, 0.034, 0.012, 0.005, 1), fabric(pal.fabricShade, { uv: 0.6 }), thigh, TR(f, [0.15, yaw, 0]));
  }
  // Knee cap (rigid to the shin, wrapping the front of the knee).
  b.add(shellPlate(band(smoothLeg, 0.455, 0.6, 6), Math.PI - 0.95, Math.PI + 0.95, 12, { offset: 0.016, thick: 0.014 }), shell(pal.shell, { wear: 0.12 }), shin);
  b.add(shellPlate(band(smoothLeg, 0.505, 0.545, 3), Math.PI - 0.7, Math.PI + 0.7, 10, { offset: 0.029, thick: 0.006 }), shell(pal.accent, { wear: 0.15 }), shin);
  // Shin guard with a raised spine.
  b.add(shellPlate(band(smoothLeg, 0.2, 0.43, 7), Math.PI - 1.05, Math.PI + 1.05, 12, { offset: 0.011, thick: 0.012 }), shell(pal.shell, { wear: 0.1 }), shin);
  b.add(shellPlate(band(smoothLeg, 0.24, 0.415, 4), Math.PI - 0.16, Math.PI + 0.16, 3, { offset: 0.019, thick: 0.009 }), shell(pal.shellGrey, { wear: 0.3 }), shin);

  // Boot (ankle-relative rings, translated to the ankle).
  const ankle = new Vector3(x, DIM.ankleY, 0);
  const bootRings = BOOT.map((r) => ({ ...r, y: r.y + ankle.y, cx: x }));
  b.add(ringTube(bootRings, 22, { panelWidth: 0.14, panelLength: 0.12, capEnd: false }), fabric(pal.boot, { rough: 0.85, dirt: 0.65 }), foot);
  // Toe cap and heel counter.
  b.add(shellPlate(band(bootRings, ankle.y - 0.066, ankle.y - 0.022, 4), Math.PI - 1.45, Math.PI + 1.45, 14, { offset: 0.004, thick: 0.007 }), shell(pal.bootCap, { rough: 0.55, wear: 0.25, dirt: 0.8 }), foot);
  b.add(shellPlate(band(bootRings, ankle.y - 0.066, ankle.y + 0.07, 6), -1.05, 1.05, 10, { offset: 0.004, thick: 0.007 }), shell(pal.bootCap, { rough: 0.55, wear: 0.25, dirt: 0.8 }), foot);
  // Instep straps with buckles on the outside, pull tab at the back of the collar.
  for (const [y0, y1] of [
    [0.012, 0.026],
    [0.036, 0.05],
  ]) {
    b.add(shellPlate(band(bootRings, ankle.y + y0, ankle.y + y1, 2), Math.PI - 1.5, Math.PI + 1.5, 12, { offset: 0.006, thick: 0.006 }), rubber(pal.fabricDark, { rough: 0.7, dirt: 0.7 }), foot);
    const th = side > 0 ? Math.PI / 2 + 0.55 : Math.PI * 1.5 - 0.55;
    const p = ringPoint(sampleRings(bootRings, ankle.y + (y0 + y1) / 2), th, new Vector3(), 0.01);
    b.add(box(0.018, 0.02, 0.008), metal(pal.darkMetal, { rough: 0.45 }), foot, TR(p, [0, Math.atan2(Math.sin(th), -Math.cos(th)), 0]));
  }
  b.add(box(0.03, 0.04, 0.008), rubber(pal.fabricDark, { rough: 0.7 }), foot, TR([x, ankle.y + 0.13, -0.066], [-0.15, 0, 0]));
  // Ankle strap and buckle.
  b.add(ringTube(band(bootRings, ankle.y + 0.075, ankle.y + 0.097, 2), 22, { grow: 0.005, panelWidth: 0.06 }), rubber(pal.fabricDark), foot);
  {
    const th = side > 0 ? Math.PI / 2 + 0.3 : Math.PI * 1.5 - 0.3;
    const p = ringPoint(sampleRings(bootRings, ankle.y + 0.086), th, new Vector3(), 0.01);
    b.add(box(0.03, 0.026, 0.01), metal(pal.darkMetal, { rough: 0.45 }), foot, TR(p, [0, Math.atan2(Math.sin(th), -Math.cos(th)), 0]));
  }
  // Sole: extruded footprint with a bevel, and tread lugs.
  {
    const shape = new Shape();
    const q = new Vector3();
    const n = 28;
    for (let i = 0; i < n; i++) {
      ringPoint({ ...BOOT[0], cx: 0 }, (i / n) * Math.PI * 2, q, 0.007);
      if (i === 0) shape.moveTo(q.x, q.z);
      else shape.lineTo(q.x, q.z);
    }
    shape.closePath();
    const sole = new ExtrudeGeometry(shape, { depth: 0.017, bevelEnabled: true, bevelThickness: 0.0055, bevelSize: 0.005, bevelSegments: 1, curveSegments: 4 });
    // Shape XY -> XZ plane; extrude downward.
    sole.applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2));
    sole.applyMatrix4(T(x, ankle.y - 0.07, 0));
    sole.computeVertexNormals();
    const uv = sole.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
    b.add(sole, rubber(pal.rubber, { dirt: 0.9 }), foot);
    // Lugs: chevrons under the forefoot, blocks under the heel.
    const lug = (lx: number, lz: number, rot: number, w: number, d: number) => {
      b.add(new BoxGeometry(w, 0.009, d), rubber(pal.rubber, { dirt: 1.0 }), foot, TR([x + lx, ankle.y - 0.1 + 0.0045 + 0.0005, lz], [0, rot, 0]));
    };
    for (let i = 0; i < 5; i++) {
      const z = 0.02 + i * 0.038;
      const wTaper = i === 4 ? 0.7 : 1;
      lug(0.024 * wTaper, z, 0.5, 0.042 * wTaper, 0.014);
      lug(-0.024 * wTaper, z, -0.5, 0.042 * wTaper, 0.014);
    }
    lug(0, -0.045, 0, 0.09, 0.02);
    lug(0, -0.075, 0, 0.07, 0.014);
  }
}

// ---------------------------------------------------------------------------------------------
// Arms and gloves

function buildArm(b: SuitBuilder, side: 1 | -1, pal: Pal, fabric: Mk, shell: Mk, metal: Mk, rubber: Mk, glow: (c: Color, ch?: number) => PartSpec): void {
  const L = side > 0;
  const clav = L ? BONE.clavL : BONE.clavR;
  const arm = L ? BONE.armL : BONE.armR;
  const fore = L ? BONE.foreL : BONE.foreR;
  const hand = L ? BONE.handL : BONE.handR;
  const j = L ? JOINTS.armL : JOINTS.armR;
  const x = j.x;
  const z = j.z;
  const out = side > 0 ? Math.PI / 2 : Math.PI * 1.5; // outward-facing theta
  const rings = offsetRings(convolute(ARM_BASE, 1.095, 1.18, 3, 0.0055), x, z);
  const smoothArm = offsetRings(ARM_BASE, x, z);
  const t0 = out + Math.PI; // seam on the inside of the arm
  b.add(
    ringTube(rings, 16, { theta0: t0, theta1: t0 + Math.PI * 2, panelWidth: 0.12, panelLength: 0.22 }),
    fabric(),
    chain([
      [0.875, hand],
      [0.9, fore],
      [1.095, fore],
      [1.175, arm],
      [1.39, arm],
      [1.56, clav],
    ]),
  );
  // Shoulder bearing and cap (pauldron), centred on the joint so it pivots in place.
  b.add(scaleLatheUv(bearingRing(0.071, 0.081, 0.02, 20, false), 0.5), metal(), arm, T(x, j.y - 0.032, z));
  const cap = lathe(
    [
      [0.0, 0.09],
      [0.034, 0.086],
      [0.062, 0.073],
      [0.083, 0.052],
      [0.096, 0.026],
      [0.101, 0.0],
      [0.1, -0.02],
      [0.096, -0.026],
      [0.086, -0.026],
      [0.084, -0.018],
    ],
    22,
  );
  cap.applyMatrix4(new Matrix4().makeScale(0.93, 0.72, 0.93));
  b.add(scaleLatheUv(cap, 0.6), shell(pal.accent, { wear: 0.08 }), arm, TR([x + side * 0.006, j.y + 0.018, z], [0, 0, -side * 0.12]));
  // Light strip around the cap's lower edge, on the outside only.
  {
    const strip = lathe(
      [
        [0.1012, -0.002],
        [0.1012, -0.011],
      ],
      20,
      out - 0.9 + Math.PI,
      1.8,
    );
    strip.applyMatrix4(new Matrix4().makeScale(0.93, 0.72, 0.93));
    b.add(strip, glow(pal.glow), arm, TR([x + side * 0.006, j.y + 0.018, z], [0, 0, -side * 0.12]));
  }
  // Rivets around the cap, just above the light strip.
  {
    const capM = TR([x + side * 0.006, j.y + 0.018, z], [0, 0, -side * 0.12]).multiply(new Matrix4().makeScale(0.93, 0.72, 0.93));
    const n = new Vector3();
    for (let k = 0; k < 8; k++) {
      const th = (k / 8) * Math.PI * 2 + Math.PI / 8;
      n.set(Math.sin(th), 0, Math.cos(th));
      const a = n.clone().multiplyScalar(0.095).setY(0.014);
      const c = n.clone().multiplyScalar(0.104).setY(0.014);
      b.add(cylinder(a, c, 0.005, 0.0042, 6), metal(), arm, capM);
    }
  }
  // Stepped plates (lames) under the cap: the shoulder reads as layered armour, not a ball.
  b.add(shellPlate(band(smoothArm, 1.372, 1.422, 4), out - 1.35, out + 1.35, 10, { offset: 0.017, thick: 0.009 }), shell(pal.shell, { wear: 0.14 }), arm);
  b.add(shellPlate(band(smoothArm, 1.33, 1.376, 4), out - 1.2, out + 1.2, 8, { offset: 0.011, thick: 0.008 }), shell(pal.shellGrey, { wear: 0.18 }), arm);
  // Patch on the upper arm.
  {
    const p = ringPoint(sampleRings(smoothArm, 1.29), out + side * 0.25, new Vector3(), 0.003);
    const yaw = out + side * 0.25;
    const m = TR(p, [0, Math.atan2(Math.sin(yaw), -Math.cos(yaw)), 0]);
    if (L) {
      // Round mission patch: accent border, dark field, light emblem.
      b.add(cylinder(new Vector3(0, 0, -0.002), new Vector3(0, 0, 0.003), 0.033, 0.033, 14), fabric(pal.accent, { uv: 0.3 }), arm, m.clone().multiply(new Matrix4().makeRotationX(0)));
      b.add(cylinder(new Vector3(0, 0, 0.003), new Vector3(0, 0, 0.0042), 0.026, 0.026, 14), fabric(pal.tape, { uv: 0.3 }), arm, m);
      b.add(cylinder(new Vector3(0, 0, 0.0042), new Vector3(0, 0, 0.005), 0.012, 0.012, 4), { color: pal.text, type: SURF.glass, rough: 0.7 }, arm, m);
    } else {
      b.add(rbox(0.06, 0.04, 0.005, 0.003, 1), fabric(pal.tape, { uv: 0.3 }), arm, m);
      for (let i = 0; i < 3; i++) {
        b.add(new BoxGeometry(0.05, 0.0055, 0.002), { color: i === 1 ? pal.accent : pal.text, type: SURF.glass, rough: 0.7 }, arm, m.clone().multiply(T(0, 0.011 - i * 0.011, 0.0032)));
      }
    }
  }
  // Elbow cap, rigid to the forearm.
  b.add(shellPlate(band(smoothArm, 1.095, 1.175, 4), -0.95, 0.95, 10, { offset: 0.012, thick: 0.01 }), shell(pal.shellGrey, { wear: 0.15 }), fore);
  // Forearm guard on the outer/back side.
  const g0 = L ? out - 1.15 : out - 1.3;
  const g1 = L ? out + 1.3 : out + 1.15;
  b.add(shellPlate(band(smoothArm, 0.925, 1.07, 6), g0, g1, 14, { offset: 0.009, thick: 0.011 }), shell(pal.shell, { wear: 0.12 }), fore);
  // Wrist bearing.
  b.add(scaleLatheUv(bearingRing(0.043, 0.056, 0.024, 18, false), 0.35), metal(), fore, T(x, 0.893, z));

  if (L) {
    // Wrist computer on the outer-front of the left forearm.
    const th = out + 0.55;
    const p = ringPoint(sampleRings(smoothArm, 0.985), th, new Vector3(), 0.032);
    const yaw = Math.atan2(Math.sin(th), -Math.cos(th));
    const m = TR(p, [0, yaw, 0]);
    b.add(rbox(0.058, 0.085, 0.026, 0.008, 1), shell(pal.gunmetal, { rough: 0.5, wear: 0.2 }), fore, m);
    b.add(rbox(0.044, 0.056, 0.003, 0.002, 1), glow(pal.screen, EMIT.screen), fore, m.clone().multiply(T(0, 0.006, 0.0125)));
    for (let i = 0; i < 3; i++) {
      b.add(box(0.009, 0.007, 0.006), rubber(pal.rubber), fore, m.clone().multiply(T(-0.015 + i * 0.015, -0.033, 0.012)));
    }
  } else {
    // Small checklist pad on the right forearm.
    const th = out - 0.4;
    const p = ringPoint(sampleRings(smoothArm, 1.0), th, new Vector3(), 0.016);
    const yaw = Math.atan2(Math.sin(th), -Math.cos(th));
    b.add(rbox(0.05, 0.07, 0.014, 0.005, 1), fabric(pal.fabricDark, { uv: 0.4 }), fore, TR(p, [0, yaw, 0]));
  }

  // Glove.
  const hj = L ? JOINTS.handL : JOINTS.handR;
  b.add(
    ringTube(
      [
        { y: hj.y - 0.05, rx: 0.036, rz: 0.044, cx: hj.x, cz: hj.z },
        { y: hj.y - 0.02, rx: 0.042, rz: 0.048, cx: hj.x, cz: hj.z },
        { y: hj.y + 0.01, rx: 0.049, rz: 0.051, cx: hj.x, cz: hj.z },
        { y: hj.y + 0.022, rx: 0.05, rz: 0.052, cx: hj.x, cz: hj.z },
      ],
      14,
      { panelWidth: 0.08, panelLength: 0.1 },
    ),
    fabric(pal.glove),
    hand,
  );
  const palmC = new Vector3(hj.x + side * 0.004, hj.y - 0.078, hj.z + 0.004);
  b.add(rbox(0.04, 0.09, 0.088, 0.016, 1), fabric(pal.glove, { uv: 0.5 }), hand, TR(palmC, [0, 0, side * 0.05]));
  // Knuckle guard on the back of the hand.
  b.add(rbox(0.012, 0.055, 0.074, 0.005, 1), shell(pal.gunmetal, { rough: 0.5, wear: 0.3 }), hand, TR([palmC.x + side * 0.021, palmC.y - 0.012, palmC.z], [0, 0, side * 0.05]));
  // Fingers: relaxed curl toward the palm (inward = -side on X).
  const curl = (len: number, base: Vector3, a0: number, a1: number, r: number) => {
    const d0 = new Vector3(-side * Math.sin(a0), -Math.cos(a0), 0);
    const k = base.clone().addScaledVector(d0, len * 0.55);
    const d1 = new Vector3(-side * Math.sin(a1), -Math.cos(a1), 0);
    const tip = k.clone().addScaledVector(d1, len * 0.45);
    b.add(capsule(base, k, r, 5, 1), fabric(pal.glove, { uv: 0.3 }), hand);
    b.add(capsule(k, tip, r * 0.95, 5, 1), rubber(pal.fabricDark, { rough: 0.75 }), hand);
  };
  const fz = [0.0305, 0.0105, -0.0095, -0.028];
  const fl = [0.07, 0.075, 0.071, 0.058];
  for (let i = 0; i < 4; i++) {
    curl(fl[i], new Vector3(palmC.x - side * 0.002, palmC.y - 0.034, palmC.z + fz[i]), 0.42 + i * 0.06, 1.35 + i * 0.1, 0.0128);
  }
  // Thumb from the front of the palm, angled forward and inward.
  {
    const base = new Vector3(palmC.x - side * 0.012, palmC.y + 0.012, palmC.z + 0.04);
    const mid = base.clone().add(new Vector3(-side * 0.014, -0.03, 0.016));
    const tip = mid.clone().add(new Vector3(-side * 0.02, -0.02, -0.006));
    b.add(capsule(base, mid, 0.0135, 6, 1), fabric(pal.glove, { uv: 0.3 }), hand);
    b.add(capsule(mid, tip, 0.012, 6, 1), rubber(pal.fabricDark, { rough: 0.75 }), hand);
  }
}

// ---------------------------------------------------------------------------------------------
// Helmet

function inWindow(lon: number, lat: number, grow = 0): number {
  const dl = (lon - Math.PI) / (VISOR.lonHalf + grow);
  const dt = (lat - VISOR.latC) / (VISOR.latHalf + grow);
  return Math.pow(Math.abs(dl), VISOR.p) + Math.pow(Math.abs(dt), VISOR.p);
}

/** Point on the visor window boundary, angle a around it, scaled by s. */
function visorBoundary(a: number, s: number): [number, number] {
  const e = 2 / VISOR.p;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return [Math.PI + VISOR.lonHalf * s * Math.sign(c) * Math.pow(Math.abs(c), e), VISOR.latC + VISOR.latHalf * s * Math.sign(sn) * Math.pow(Math.abs(sn), e)];
}

function buildHelmet(b: SuitBuilder, pal: Pal, shell: Mk, metal: Mk, rubber: Mk, glow: (c: Color, ch?: number) => PartSpec): void {
  const { c, r } = HELMET;
  const head = BONE.head;
  // Shell: lon/lat grid with the visor window removed (its jagged edge sits under the frame).
  {
    const nLon = 36;
    const latMin = -0.86;
    const nLat = 15;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const d = new Vector3();
    const p = new Vector3();
    for (let j = 0; j <= nLat; j++) {
      const lat = latMin + ((Math.PI / 2 - latMin) * j) / nLat;
      for (let i = 0; i <= nLon; i++) {
        const lon = (i / nLon) * Math.PI * 2;
        ellipsoidPoint(c, r, sph(lon, lat, d), 0, p);
        pos.push(p.x, p.y, p.z);
        uv.push((i / nLon) * 4, j / nLat * 1.6);
      }
    }
    const cols = nLon + 1;
    for (let j = 0; j < nLat; j++) {
      for (let i = 0; i < nLon; i++) {
        const lon = ((i + 0.5) / nLon) * Math.PI * 2;
        const lat = latMin + ((Math.PI / 2 - latMin) * (j + 0.5)) / nLat;
        if (inWindow(lon, lat, -0.02) < 1) continue;
        const a = j * cols + i;
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Smooth normals across the seam and pole: use the ellipsoid's analytic normal.
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      p.set(pos[i * 3] - c.x, pos[i * 3 + 1] - c.y, pos[i * 3 + 2] - c.z);
      p.set(p.x / (r.x * r.x), p.y / (r.y * r.y), p.z / (r.z * r.z)).normalize();
      n.setXYZ(i, p.x, p.y, p.z);
    }
    b.add(g, shell(pal.shell, { rough: 0.36, wear: 0.03 }), head);
  }
  // Visor frame: a tube around the window.
  {
    const pts: Vector3[] = [];
    const d = new Vector3();
    for (let k = 0; k < 48; k++) {
      const [lon, lat] = visorBoundary((k / 48) * Math.PI * 2, 1.0);
      pts.push(ellipsoidPoint(c, r, sph(lon, lat, d), 0.004, new Vector3()));
    }
    const curve = new CatmullRomCurve3(pts, true, 'centripetal');
    b.add(new TubeGeometry(curve, 40, 0.0095, 5, true), shell(pal.gunmetal, { rough: 0.45, wear: 0.4 }), head);
  }
  // Crest along the top, front to back (accent).
  b.add(
    ellipsoidPlate(
      c,
      r,
      (u, v, out) => {
        const a = 1.02 + u * 1.75; // from above the visor over the top to the back
        const w = (v - 0.5) * 0.36;
        return out.set(Math.sin(w), Math.cos(w) * Math.sin(a), Math.cos(w) * Math.cos(a)).normalize();
      },
      16,
      3,
      0.008,
      0.01,
    ),
    shell(pal.accent, { wear: 0.12 }),
    head,
  );
  // Side pods: lamps (both sides) and a camera on the left pod.
  for (const s of [1, -1]) {
    // Comms disc on the side of the helmet, the lamp pod sits on it.
    const d = sph(s > 0 ? Math.PI / 2 + 0.3 : Math.PI * 1.5 - 0.3, 0.08, new Vector3());
    const p = ellipsoidPoint(c, r, d, 0.0, new Vector3());
    b.add(cylinder(p.clone().addScaledVector(d, -0.004), p.clone().addScaledVector(d, 0.014), 0.042, 0.037, 20), shell(pal.shellGrey, { wear: 0.2 }), head);
    // Lamp housing pointing forward (slightly down).
    const pitch = 0.08;
    const fwd = new Vector3(0, -Math.sin(pitch), Math.cos(pitch));
    const hp = p.clone().addScaledVector(d, 0.03).add(new Vector3(0, 0.012, 0.012));
    b.add(rbox(0.036, 0.034, 0.08, 0.009, 1), shell(pal.gunmetal, { rough: 0.5, wear: 0.25 }), head, TR(hp, [pitch, 0, 0]));
    b.add(cylinder(hp.clone().addScaledVector(fwd, 0.038), hp.clone().addScaledVector(fwd, 0.0415), 0.0125, 0.0125, 14), glow(pal.lamp, EMIT.lamp), head);
    b.add(cylinder(hp.clone().addScaledVector(fwd, 0.036), hp.clone().addScaledVector(fwd, 0.043), 0.0155, 0.0155, 14, true), metal(pal.darkMetal), head);
    if (s > 0) {
      // Camera on top of the left lamp.
      const cp = hp.clone().add(new Vector3(0, 0.03, -0.004));
      b.add(rbox(0.026, 0.024, 0.04, 0.005, 1), shell(pal.gunmetal, { rough: 0.5 }), head, T(cp.x, cp.y, cp.z));
      b.add(cylinder(new Vector3(cp.x, cp.y, cp.z + 0.018), new Vector3(cp.x, cp.y, cp.z + 0.028), 0.008, 0.007, 12), glow(new Color(0.05, 0.02, 0.02), EMIT.strip), head);
    } else {
      // Small whip antenna base on the right pod.
      b.add(cylinder(hp.clone().add(new Vector3(-0.006, 0.016, -0.025)), hp.clone().add(new Vector3(-0.02, 0.1, -0.06)), 0.0028, 0.0018, 6), metal(pal.darkMetal), head);
    }
  }
  // Rear ID light bar.
  {
    const d = sph(0, 0.12, new Vector3());
    const p = ellipsoidPoint(c, r, d, 0.004, new Vector3());
    b.add(rbox(0.09, 0.02, 0.012, 0.004, 1), shell(pal.gunmetal), head, T(p.x, p.y, p.z));
    b.add(box(0.074, 0.006, 0.004), glow(pal.glow), head, T(p.x, p.y, p.z - 0.0065));
  }
  // Helmet collar: the upper race that turns on the neck ring.
  const collar = bearingRing(0.112, 0.138, 0.024, 32);
  collar.applyMatrix4(new Matrix4().makeScale(1, 1, 0.94));
  b.add(scaleLatheUv(collar, 0.8), metal(pal.darkMetal, { rough: 0.38 }), head, T(0, 1.536, 0.004));
  // Dark liner at the base so the helmet never looks hollow.
  b.add(lathe([[0.126, 1.548 - 1.548], [0.11, 0.012], [0.06, 0.03]], 24), rubber(pal.rubber), head, T(0, 1.548, 0.01));
}

function buildVisor(): BufferGeometry {
  const { c, r } = HELMET;
  const nr = 7;
  const na = 56;
  const pos: number[] = [];
  const idx: number[] = [];
  const d = new Vector3();
  const p = new Vector3();
  for (let k = 0; k <= nr; k++) {
    const s = (k / nr) * 1.02;
    for (let i = 0; i < na; i++) {
      const [lon, lat] = visorBoundary((i / na) * Math.PI * 2, s);
      // Bulge: the visor stands proud of the shell, most in the middle.
      const grow = 0.004 + 0.012 * (1 - s * s);
      ellipsoidPoint(c, r, sph(lon, lat, d), grow, p);
      pos.push(p.x - JOINTS.head.x, p.y - JOINTS.head.y, p.z - JOINTS.head.z);
    }
  }
  for (let k = 0; k < nr; k++) {
    for (let i = 0; i < na; i++) {
      const a = k * na + i;
      const b = k * na + ((i + 1) % na);
      const cc = a + na;
      const dd = b + na;
      idx.push(a, b, cc, b, dd, cc);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Orient outward.
  const n = g.getAttribute('normal');
  const mid = na * 3;
  const pm = new Vector3(pos[mid * 3], pos[mid * 3 + 1], pos[mid * 3 + 2]).add(JOINTS.head).sub(c);
  if (pm.dot(new Vector3(n.getX(mid), n.getY(mid), n.getZ(mid))) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Life-support backpack

function buildBackpack(b: SuitBuilder, pal: Pal, shell: Mk, metal: Mk, rubber: Mk, glow: (c: Color, ch?: number) => PartSpec, role: RoleId): void {
  const pack = BONE.pack;
  const c = new Vector3(0, 1.24, -0.248);
  const W = 0.42;
  const H = 0.56;
  const D = 0.19;
  const back = c.z - D / 2;
  b.add(rbox(W, H, D, 0.04, 2), shell(pal.shell, { uv: 1.6, wear: 0.05 }), pack, T(c.x, c.y, c.z));
  // Upper back panel (accent) with a raised frame.
  b.add(rbox(0.34, 0.21, 0.016, 0.01, 1), shell(pal.accent, { uv: 1.2, wear: 0.15 }), pack, T(0, c.y + 0.12, back - 0.004));
  b.add(box(0.3, 0.012, 0.006), shell(pal.gunmetal), pack, T(0, c.y + 0.06, back - 0.012));
  // Panel seams and bolts on the back face, stencilled unit ID on the accent panel.
  for (const sy of [c.y - 0.03, c.y - 0.235]) b.add(box(W - 0.05, 0.004, 0.004), rubber(pal.gunmetal, { rough: 0.6 }), pack, T(0, sy, back - 0.001));
  for (const sx of [-1, 1]) {
    b.add(box(0.004, H - 0.08, 0.004), rubber(pal.gunmetal, { rough: 0.6 }), pack, T(sx * 0.183, c.y, back - 0.001));
    for (const sy of [c.y + 0.23, c.y + 0.012, c.y - 0.25]) {
      b.add(cylinder(new Vector3(sx * 0.196, sy, back + 0.001), new Vector3(sx * 0.196, sy, back - 0.004), 0.006, 0.006, 6), metal(pal.darkMetal), pack);
    }
  }
  {
    const id = stencilText(role === 'vanguard' ? 'V-01' : 'T-02', 0.008);
    id.applyMatrix4(TR([0.08, c.y + 0.165, back - 0.0125], [0, Math.PI, 0]));
    b.add(id, { color: pal.gunmetal, type: SURF.glass, rough: 0.7, dirt: 0.5 }, pack);
    // Hazard label: three stacked stripes.
    for (let k = 0; k < 3; k++) {
      b.add(box(0.07, 0.014, 0.002), { color: k % 2 ? pal.gunmetal : pal.hazard, type: SURF.shell, rough: 0.5 }, pack, T(-0.1, c.y + 0.056 + k * 0.014, back - 0.013));
    }
  }
  // Lower vent: recess + slats.
  b.add(rbox(0.3, 0.16, 0.012, 0.006, 1), rubber(pal.rubber, { rough: 0.6 }), pack, T(0, c.y - 0.13, back + 0.001));
  for (let i = 0; i < 6; i++) {
    b.add(box(0.29, 0.013, 0.02), metal(pal.darkMetal, { rough: 0.45 }), pack, TR([0, c.y - 0.195 + i * 0.026, back - 0.004], [0.35, 0, 0]));
  }
  // Bottom cap and top lid.
  b.add(rbox(W - 0.03, 0.04, D - 0.02, 0.015, 1), shell(pal.gunmetal, { rough: 0.5, wear: 0.3 }), pack, T(0, c.y - H / 2 - 0.008, c.z));
  b.add(rbox(W - 0.05, 0.03, D - 0.04, 0.012, 1), shell(pal.accent, { wear: 0.2 }), pack, T(0, c.y + H / 2 + 0.006, c.z - 0.005));
  // Top light bars (seen from the follow camera).
  for (const s of [1, -1]) {
    b.add(box(0.13, 0.012, 0.014), glow(pal.glow), pack, T(s * 0.115, c.y + H / 2 + 0.017, back + 0.022));
  }
  // Carry handle across the top.
  b.add(
    hose(
      [
        new Vector3(-0.1, c.y + H / 2 + 0.018, c.z - 0.04),
        new Vector3(-0.085, c.y + H / 2 + 0.06, c.z - 0.045),
        new Vector3(0.085, c.y + H / 2 + 0.06, c.z - 0.045),
        new Vector3(0.1, c.y + H / 2 + 0.018, c.z - 0.04),
      ],
      0.009,
      20,
      6,
    ),
    metal(pal.darkMetal, { type: SURF.metal, rough: 0.4 }),
    pack,
  );
  // Side tanks with straps and a hazard band.
  for (const s of [1, -1]) {
    const tx = s * (W / 2 + 0.03);
    const tz = c.z - 0.01;
    const tank = lathe(
      [
        [0.0, -0.2],
        [0.022, -0.196],
        [0.036, -0.184],
        [0.042, -0.165],
        [0.042, 0.165],
        [0.036, 0.184],
        [0.022, 0.196],
        [0.008, 0.2],
        [0.008, 0.215],
        [0.0, 0.215],
      ],
      16,
    );
    b.add(scaleLatheUv(tank, 0.26, 0.13), shell(pal.tank, { rough: 0.36, wear: 0.35 }), pack, T(tx, c.y - 0.02, tz));
    b.add(scaleLatheUv(bearingRing(0.04, 0.0445, 0.03, 12, false), 0.27), shell(pal.hazard, { rough: 0.45, wear: 0.3 }), pack, T(tx, c.y + 0.11, tz));
    for (const yy of [-0.1, 0.05]) b.add(bearingRing(0.041, 0.0465, 0.014, 12, false), metal(pal.darkMetal), pack, T(tx, c.y + yy, tz));
    // Valve on top.
    b.add(cylinder(new Vector3(tx, c.y + 0.195, tz), new Vector3(tx, c.y + 0.225, tz), 0.012, 0.012, 10), metal(), pack);
    b.add(cylinder(new Vector3(tx - 0.015, c.y + 0.222, tz), new Vector3(tx + 0.015, c.y + 0.222, tz), 0.006, 0.006, 8), metal(pal.hazard, { metal: 0.2 }), pack);
    // Bracket to the pack.
    b.add(box(0.03, 0.05, 0.03), metal(pal.darkMetal), pack, T(s * (W / 2 + 0.008), c.y + 0.05, tz));
    b.add(box(0.03, 0.05, 0.03), metal(pal.darkMetal), pack, T(s * (W / 2 + 0.008), c.y - 0.1, tz));
  }
  // Umbilical hoses from the pack around the waist to the chest connectors (on the chest bone).
  for (const s of [1, -1]) {
    const pts = [
      new Vector3(s * 0.2, 1.045, -0.2),
      new Vector3(s * 0.205, 1.045, -0.11),
      new Vector3(s * 0.2, 1.065, -0.01),
      new Vector3(s * 0.175, 1.1, 0.085),
      new Vector3(s * 0.135, 1.168, 0.142),
      new Vector3(s * 0.116, 1.193, 0.156),
    ];
    b.add(hose(pts, 0.0145, 26, 5), { color: pal.fabricDark, type: SURF.hose, rough: 0.6, dirt: 0.8 }, BONE.chest);
    b.add(cylinder(new Vector3(s * 0.2, 1.045, -0.215), new Vector3(s * 0.2, 1.045, -0.185), 0.02, 0.02, 14), metal(), pack);
  }

  // Antenna: whip on the right shoulder of the pack, bending with the antenna bone.
  const base = JOINTS.antenna;
  const len = role === 'vanguard' ? 0.5 : 0.24;
  b.add(cylinder(base.clone().add(new Vector3(0, -0.02, 0)), base.clone().add(new Vector3(0, 0.03, 0)), 0.016, 0.018, 12), metal(pal.darkMetal), pack);
  b.add(bearingRing(0.016, 0.02, 0.008, 10, false), metal(), pack, T(base.x, base.y + 0.032, base.z));
  const rod = new CylinderGeometry(0.0022, 0.004, len, 6, 12, false);
  rod.applyMatrix4(T(base.x, base.y + 0.035 + len / 2, base.z));
  b.add(rod, metal(pal.darkMetal, { rough: 0.5 }), (p) => {
    const t = Math.min(1, Math.max(0, (p.y - base.y - 0.035) / len));
    const w = Math.pow(t, 1.4);
    return [BONE.pack, 1 - w, BONE.antenna, w];
  });
  // Tip marker light.
  const tip = new Vector3(base.x, base.y + 0.035 + len, base.z);
  b.add(capsule(tip.clone().add(new Vector3(0, -0.006, 0)), tip.clone().add(new Vector3(0, 0.006, 0)), 0.0055, 8, 2), glow(pal.glow), BONE.antenna);
  if (role === 'tether') {
    // Short stub plus a small dish antenna on the left.
    const dp = new Vector3(0.14, 1.555, -0.3);
    b.add(cylinder(dp.clone().add(new Vector3(0, -0.03, 0)), dp.clone(), 0.008, 0.008, 8), metal(pal.darkMetal), pack);
    const dish = lathe([[0.0, 0.0], [0.03, 0.006], [0.048, 0.018], [0.05, 0.022], [0.046, 0.022], [0.028, 0.012], [0.0, 0.006]], 14);
    b.add(dish, shell(pal.shell, { wear: 0.2 }), pack, TR(dp, [-0.7, 0.4, 0]));
  }
}

// The Meridian: a 420 m colony ship, broken in two and sunk into its crater. Built like a real
// deep-space hauler: an armoured prow, a structural spine carrying a train of big cargo/cryo
// modules with open truss between them, a habitation ring on spokes (one arc still arching over
// the hull, other segments lying apart), and an engineering block with radiators and bells.
// Seen from 450-700 m: silhouette, rhythm (module / gap), value structure and lights matter most.

import { Color, Matrix4, Vector2, Vector3 } from 'three';
import { mulberry32 } from '../../game/random';
import { TRENCH, WRECK } from '../layout';
import type { HeightFn, Quality } from '../types';
import { PartBuilder, T, type ColorFn, type Surf } from './builder';
import { addDecal, GlowMode, type GlowSet } from './fx';
import { cyl, fbm2, lathe, paramSurface, rbox, stationAt, strut, superPoint, tube, type Station } from './shapes';
import type { DecalAtlas } from './textures';

const HULL = '#8f8b83';
const HULL2 = '#787470';
const DARK = '#3e3b38';
const TRUSS = '#5b5853';

const tmpSt: Station = { z: 0, w: 0, ht: 0, hb: 0, y: 0, nt: 2, nb: 2 };
const tmpV2 = new Vector2();

/** Basis that maps local +Z onto the segment A→B, local +Y close to world up, then rolled. */
function sectionMatrix(A: Vector3, B: Vector3, roll: number): Matrix4 {
  const ez = new Vector3().subVectors(B, A).normalize();
  const ex = new Vector3().crossVectors(new Vector3(0, 1, 0), ez).normalize();
  const ey = new Vector3().crossVectors(ez, ex);
  const m = new Matrix4().makeBasis(ex, ey, ez).setPosition(A);
  return m.multiply(new Matrix4().makeRotationZ(roll));
}

export interface WreckBuild {
  /** Hull, ring, debris and dust berms (one material). */
  builder: PartBuilder;
  groundY: number;
}

interface ModuleSpec {
  z0: number;
  z1: number;
  w: number;
  ht: number;
  hb: number;
  n: number;
  /** Ragged/torn end: 0 none, 1 at z1, -1 at z0. */
  torn?: number;
  color?: string;
}

export function buildWreck(heightAt: HeightFn, glows: GlowSet, decals: PartBuilder, atlas: DecalAtlas, quality: Quality): WreckBuild {
  const b = new PartBuilder();
  const rnd = mulberry32(1123);
  const yaw = WRECK.yaw;
  const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); // bow direction
  const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const C = new Vector3(WRECK.x, 0, WRECK.z);
  /** Point on the ship's axis line: s from the centre toward the stern (+) / bow (-). */
  const along = (s: number, lateral = 0) => C.clone().addScaledVector(fwd, -s).addScaledVector(right, lateral);
  const ground = (p: Vector3) => heightAt(p.x, p.z);
  const groundC = ground(C);

  const hb = 21;
  const bowS = -WRECK.length / 2;
  const breakS = 18;
  const aftS0 = 46;
  const sternS = WRECK.length / 2;

  // Forward section: keel buried `burial` at the break end, bow riding up out of the regolith.
  const fA = along(bowS);
  const fB = along(breakS);
  fA.y = ground(fA) + 5 + hb;
  fB.y = ground(fB) - WRECK.burial - 1 + hb;
  const fLen = fA.distanceTo(fB);
  const fwdM = sectionMatrix(fA, fB, 0.14);
  // Aft section: kinked ~11°, rolled the other way, stern lifted on the trench lip.
  const aftDir = fwd.clone().negate().applyAxisAngle(new Vector3(0, 1, 0), 0.19);
  const aA = along(aftS0, -3);
  const aB = aA.clone().addScaledVector(aftDir, sternS - aftS0);
  aA.y = ground(aA) - WRECK.burial - 2 + hb;
  aB.y = ground(aB) + 4 + hb;
  const aftM = sectionMatrix(aA, aB, -0.22);
  const breakPt = fB.clone().lerp(aA, 0.5);

  /** World-space weathering for hull vertex colours. */
  const weather = (seed: number, sootNear?: Vector3): ColorFn => {
    const dark = new Color(DARK);
    const rust = new Color('#6b5847');
    return (p, n, c) => {
      const big = fbm2(p.x * 0.014 + seed, p.z * 0.014 + p.y * 0.02, 4, 11);
      const plate = fbm2(p.x * 0.07 + p.y * 0.05, p.z * 0.07, 2, 12 + seed);
      c.multiplyScalar(0.74 + 0.4 * big + (plate > 0.64 ? -0.14 : 0) + (plate < 0.3 ? 0.07 : 0));
      c.lerp(dark, Math.min(1, Math.max(0, -n.y) * 0.75));
      if (big > 0.63) c.lerp(rust, (big - 0.63) * 1.6);
      if (sootNear) c.lerp(dark, Math.max(0, 1 - p.distanceTo(sootNear) / 50) * 0.9);
    };
  };
  const hullSurf = (color = HULL, panel = 1): Surf => ({ color, metal: 0.35, rough: 0.6, panel });

  /** A lofted hull piece between z0 and z1 with chamfered ends; `keep` drops torn quads. */
  const module = (m: Matrix4, spec: ModuleSpec, seed: number) => {
    const { z0, z1, w, ht, hb: hbm, n } = spec;
    const ch = Math.min(4, (z1 - z0) * 0.12);
    const st: Station[] = [
      { z: z0, w: w - 7, ht: ht - 3.5, hb: hbm - 3.5, y: 0, nt: n, nb: n },
      { z: z0 + ch, w, ht, hb: hbm, y: 0, nt: n, nb: n },
      { z: z1 - ch, w, ht, hb: hbm, y: 0, nt: n, nb: n },
      { z: z1, w: w - 7, ht: ht - 3.5, hb: hbm - 3.5, y: 0, nt: n, nb: n },
    ];
    const torn = spec.torn ?? 0;
    const keep = (u0: number, u1: number, v0: number, v1: number) => {
      const z = stationAt(st, (u0 + u1) / 2, tmpSt).z;
      const v = (v0 + v1) / 2;
      const rag = 6 + 14 * fbm2(v * 9, seed, 3, 4) + (Math.sin(v * 41 + seed) > 0.55 ? 6 : 0);
      if (torn > 0 && z > z1 - rag) return false;
      if (torn < 0 && z < z0 + rag) return false;
      const hole = fbm2(z * 0.07, v * 12 + seed, 3, 5 + seed);
      if (torn !== 0 && hole > 0.6) return false;
      return true;
    };
    const nu = Math.max(6, Math.round((z1 - z0) / 2.2));
    const g = paramSurface(
      (u, v, out) => {
        const s = stationAt(st, u, tmpSt);
        superPoint(v * Math.PI * 2, s.w / 2, s.ht, s.hb, s.nt, s.nb, tmpV2);
        out.set(tmpV2.x, tmpV2.y, s.z);
      },
      nu,
      n > 4 ? 72 : 56,
      { flip: true, keep: torn ? keep : undefined },
    );
    b.add(g, hullSurf(spec.color ?? HULL), m, weather(seed, torn ? breakPt : undefined));
    // End collars (darker), unless torn there.
    for (const [z, end] of [
      [z0 + ch + 1.2, -1],
      [z1 - ch - 1.2, 1],
    ] as [number, number][]) {
      if (end === torn) continue;
      const cg = paramSurface(
        (u, v, out) => {
          superPoint(v * Math.PI * 2, w / 2 + 0.7, ht + 0.7, hbm + 0.7, n, n, tmpV2);
          out.set(tmpV2.x, tmpV2.y, z - 1.4 + u * 2.8);
        },
        1,
        n > 4 ? 72 : 56,
        { flip: true },
      );
      b.add(cg, hullSurf('#6c6862', 0.5), m, weather(seed + 3));
    }
    // Window rows: dark bands with a few lit ports (scale cue).
    for (const side of [-1, 1]) {
      for (const [ang, lit] of [
        [0.32, true],
        [0.12, false],
      ] as [number, boolean][]) {
        const a = side > 0 ? ang : Math.PI - ang;
        superPoint(a, w / 2 + 0.15, ht + 0.15, hbm + 0.15, n, n, tmpV2);
        const zA = z0 + ch + 3;
        const zB = z1 - ch - 3 - (torn > 0 ? 16 : 0);
        if (zB - zA < 4) continue;
        const nrm = new Vector3(Math.cos(a), Math.sin(a), 0);
        b.add(rbox(1.0, 1.4, zB - zA, 0.2), { color: '#1d1e1f', metal: 0.4, rough: 0.25, panel: 0 }, m.clone().multiply(T(tmpV2.x, tmpV2.y, (zA + zB) / 2, 0, 0, Math.atan2(nrm.y, nrm.x))));
        if (lit && rnd() < 0.7) {
          const k = 1 + Math.floor(rnd() * 2);
          for (let i = 0; i < k; i++) {
            const z = zA + rnd() * (zB - zA);
            glows.add(new Vector3(tmpV2.x + nrm.x * 0.8, tmpV2.y + nrm.y * 0.8, z).applyMatrix4(m), rnd() < 0.5 ? '#ffcf96' : '#d6e8ff', 10, 2.2, rnd() < 0.6 ? GlowMode.Failing : GlowMode.Steady, rnd() * 9, 2);
          }
        }
      }
    }
    // Surface greebles across the upper hull: conduits, hatches, service blocks (scale cues).
    const gr = mulberry32(seed * 7 + 1);
    for (let i = 0; i < 26; i++) {
      const z = z0 + ch + 2 + gr() * (z1 - z0 - 2 * ch - 4 - (torn > 0 ? 18 : 0));
      const a = (0.08 + gr() * 0.84) * Math.PI;
      superPoint(a, w / 2, ht, hbm, n, n, tmpV2);
      const nrm = new Vector3(Math.cos(a), Math.sin(a), 0);
      const sx = 1.5 + gr() * 4;
      const sz = 2 + gr() * 7;
      const sy = 0.5 + gr() * 1.4;
      b.add(rbox(sx, sy, sz, 0.25), hullSurf(gr() < 0.5 ? '#7d7972' : '#9a968e', 0.8), m.clone().multiply(T(tmpV2.x + nrm.x * sy * 0.4, tmpV2.y + nrm.y * sy * 0.4, z, 0, 0, a - Math.PI / 2)));
    }
    for (const a of [0.55, Math.PI - 0.55]) {
      superPoint(a, w / 2 + 0.6, ht + 0.6, hbm + 0.6, n, n, tmpV2);
      b.add(rbox(1.2, 1.2, z1 - z0 - 2 * ch - (torn > 0 ? 18 : 2), 0.3), { color: '#5d5a55', metal: 0.5, rough: 0.5, panel: 0 }, m.clone().multiply(T(tmpV2.x, tmpV2.y, (z0 + z1) / 2 - (torn > 0 ? 9 : 0))));
    }
    // Top greebles: tank clusters, service boxes, small masts.
    const topY = ht;
    const zs = [z0 + ch + 5, (z0 + z1) / 2, z1 - ch - 6];
    for (const z of zs) {
      if (torn > 0 && z > z1 - 20) continue;
      const k = rnd();
      if (k < 0.4) {
        for (const x of [-4.5, 0, 4.5]) b.add(cyl(2.0, 2.0, 11, 14), hullSurf('#9a968d', 0.6), m.clone().multiply(T(x, topY + 1.2, z, Math.PI / 2, 0, 0)));
      } else if (k < 0.75) {
        b.add(rbox(10, 3.5 + rnd() * 3, 7, 0.6), hullSurf('#86827a', 1), m.clone().multiply(T((rnd() - 0.5) * 10, topY + 1.5, z)));
      } else {
        b.add(strut(new Vector3(0, topY, z), new Vector3(1 + rnd() * 3, topY + 10 + rnd() * 12, z + rnd() * 4), 0.35, 5), { color: TRUSS, metal: 0.5, rough: 0.5, panel: 0 }, m);
      }
    }
  };

  /** Spine truss between z0 and z1: four longerons and X-bracing. */
  const spine = (m: Matrix4, z0: number, z1: number, seed: number, jagged = 0) => {
    const r = mulberry32(seed);
    const corners: [number, number][] = [
      [-7, -6],
      [7, -6],
      [7, 6],
      [-7, 6],
    ];
    for (const [x, y] of corners) {
      const extra = jagged ? jagged * (0.2 + r() * 0.8) : 0;
      b.add(strut(new Vector3(x, y, z0), new Vector3(x + (jagged ? (r() - 0.5) * 4 : 0), y + (jagged ? (r() - 0.6) * 4 : 0), z1 + extra), 1.1, 6), { color: TRUSS, metal: 0.5, rough: 0.55, panel: 0.3 }, m);
    }
    const step = 7;
    for (let z = z0; z < z1 - 1; z += step) {
      for (let k = 0; k < 4; k++) {
        const [xa, ya] = corners[k];
        const [xb, yb] = corners[(k + 1) % 4];
        if (r() < 0.12) continue;
        b.add(strut(new Vector3(xa, ya, z), new Vector3(xb, yb, Math.min(z + step, z1)), 0.4, 4), { color: TRUSS, metal: 0.5, rough: 0.55, panel: 0 }, m);
      }
      b.add(rbox(15, 13, 0.9, 0.2), { color: '#4d4a46', metal: 0.5, rough: 0.55, panel: 0.3 }, m.clone().multiply(T(0, 0, z)));
    }
    // Pipes running along the spine.
    for (const [x, y] of [
      [-3, 7.2],
      [3.5, 7.0],
      [0, -7.3],
    ])
      b.add(strut(new Vector3(x, y, z0), new Vector3(x, y, z1), 0.8, 6), { color: '#6e6a63', metal: 0.5, rough: 0.5, panel: 0 }, m);
  };

  // ---- forward section (local z from 0 at the bow) ------------------------------------------
  {
    const m = fwdM;
    // Armoured prow.
    const prow: Station[] = [
      { z: 0, w: 22, ht: 11, hb: 12, y: -1, nt: 7, nb: 7 },
      { z: 2.5, w: 30, ht: 15, hb: 15, y: 0, nt: 7, nb: 7 },
      { z: 12, w: 42, ht: 21, hb: 19, y: 0, nt: 7, nb: 7 },
      { z: 32, w: 47, ht: 23, hb: 21, y: 0, nt: 7, nb: 7 },
      { z: 36, w: 42, ht: 20, hb: 18, y: 0, nt: 6, nb: 6 },
    ];
    const inv = m.clone().invert();
    const bandDark = new Color('#1c1d1e');
    b.add(
      paramSurface(
        (u, v, out) => {
          const s = stationAt(prow, u, tmpSt);
          superPoint(v * Math.PI * 2, s.w / 2, s.ht, s.hb, s.nt, s.nb, tmpV2);
          out.set(tmpV2.x, s.y + tmpV2.y, s.z);
        },
        26,
        96,
        { flip: true },
      ),
      hullSurf('#8c887f'),
      m,
      (p, n, c) => {
        weather(2)(p, n, c);
        // Bridge window band wrapping the upper prow.
        const l = p.clone().applyMatrix4(inv);
        if (l.y > 12.6 && l.y < 13.9 && l.z > 4 && l.z < 26) c.copy(bandDark);
      },
    );
    for (let i = 0; i < 4; i++) glows.add(new Vector3(-8 + i * 5.5, 13.5, 9.5).applyMatrix4(m), '#ffd9a8', 8, 1.6, i === 2 ? GlowMode.Failing : GlowMode.Steady, i, 2);
    // Vertical armour ribs on the prow flanks.
    for (const side of [-1, 1]) for (let k = 0; k < 4; k++) b.add(rbox(1.4, 34, 2.2, 0.4), hullSurf('#6c6862', 0.5), m.clone().multiply(T(side * 23.2, 0, 16 + k * 5)));
    // Prow armour plates and sensor blister.
    b.add(rbox(30, 3, 14, 0.8), hullSurf('#77736c'), m.clone().multiply(T(0, -17, 12, -0.25, 0, 0)));
    b.add(lathe([[6, 0], [5.5, 2.5], [3.5, 4.5], [0, 5.5]], 20), hullSurf('#7a766f', 0.4), m.clone().multiply(T(0, 22, 28)));
    // Modules along the spine (one round, one boxy, ...); the last one is torn at the break.
    const mods: ModuleSpec[] = [
      { z0: 42, z1: 73, w: 44, ht: 21, hb: 21, n: 2.4 },
      { z0: 124, z1: 155, w: 44, ht: 21, hb: 21, n: 2.4 },
      { z0: 162, z1: 192, w: 46, ht: 22, hb: 22, n: 5, color: '#96928a' },
      { z0: 199, z1: fLen + 4, w: 44, ht: 21, hb: 21, n: 2.4, torn: 1 },
    ];
    mods.forEach((mod, i) => {
      // The fourth module was crushed in the slide: dropped, rolled and shoved sideways.
      const crushed = mod.z0 === 162;
      module(crushed ? m.clone().multiply(T(4, -5, 0, 0.02, 0.05, 0.3)) : m, mod, 10 + i);
    });
    // Stubs of the module that was torn away (its pieces are in the debris field).
    b.add(rbox(30, 2, 12, 0.5), hullSurf(HULL2), m.clone().multiply(T(6, -16, 86, 0.1, 0, 0.3)));
    b.add(rbox(14, 1.5, 18, 0.5), hullSurf(HULL2), m.clone().multiply(T(-12, 14, 100, 0.4, 0.2, -0.6)));
    spine(m, 30, fLen + 2, 7, 14);
    // Ring hub collar on the spine in the ring gap.
    b.add(
      paramSurface(
        (u, v, out) => {
          superPoint(v * Math.PI * 2, 13, 12, 12, 2.6, 2.6, tmpV2);
          out.set(tmpV2.x, tmpV2.y, 112 + u * 10);
        },
        2,
        40,
        { flip: true },
      ),
      hullSurf('#77736c', 0.6),
      m,
    );
    // Name on the boxy module flanks.
    const mz = 177;
    addDecal(decals, atlas, 'MERIDIAN', 26, '#2f2c2a', m.clone().multiply(T(23.6, 6, mz, 0, Math.PI / 2, 0)), 0.7);
    addDecal(decals, atlas, 'MERIDIAN', 26, '#2f2c2a', m.clone().multiply(T(-23.6, 6, mz, 0, -Math.PI / 2, 0)), 0.7);
    glows.add(new Vector3(0, 32, 26).applyMatrix4(m), '#ff2a1a', 60, 6, GlowMode.Beacon, 0.3, 3.5);
  }

  // ---- aft section (local z from 0 at the break) ---------------------------------------------
  {
    const m = aftM;
    module(m, { z0: -2, z1: 28, w: 44, ht: 21, hb: 21, n: 2.4, torn: -1 }, 30);
    module(m, { z0: 35, z1: 66, w: 46, ht: 22, hb: 22, n: 5, color: HULL2 }, 31);
    spine(m, -12, 76, 9);
    // Engineering block, thrust structure, bells.
    const eng: Station[] = [
      { z: 72, w: 46, ht: 22, hb: 22, y: 0, nt: 5, nb: 5 },
      { z: 76, w: 54, ht: 25, hb: 25, y: 0, nt: 5.5, nb: 5.5 },
      { z: 124, w: 54, ht: 25, hb: 25, y: 0, nt: 5.5, nb: 5.5 },
      { z: 134, w: 44, ht: 20, hb: 20, y: 0, nt: 4, nb: 4 },
      { z: 140, w: 34, ht: 15, hb: 15, y: 0, nt: 3, nb: 3 },
    ];
    b.add(
      paramSurface(
        (u, v, out) => {
          const s = stationAt(eng, u, tmpSt);
          superPoint(v * Math.PI * 2, s.w / 2, s.ht, s.hb, s.nt, s.nb, tmpV2);
          out.set(tmpV2.x, tmpV2.y, s.z);
        },
        30,
        72,
        { flip: true },
      ),
      hullSurf('#8e8a82'),
      m,
      weather(41),
    );
    // Reactor domes on top.
    for (const z of [88, 108]) b.add(lathe([[9, 0], [8.6, 3], [6, 6.5], [0, 8]], 24), hullSurf('#a29e95', 0.6), m.clone().multiply(T(0, 24, z)));
    // Radiators: one standing proud, one snapped and leaning into the ground.
    b.add(rbox(1.2, 30, 40, 0.4), hullSurf('#57534d', 1), m.clone().multiply(T(-27 - 14, 4, 100, 0, 0, Math.PI / 2 - 0.25)));
    for (let k = 0; k < 6; k++) b.add(rbox(0.6, 30, 0.8, 0.2), { color: '#3d3a37', metal: 0.5, rough: 0.5, panel: 0 }, m.clone().multiply(T(-27 - 14, 4.9, 82 + k * 7, 0, 0, Math.PI / 2 - 0.25)));
    b.add(rbox(1.2, 26, 36, 0.4), hullSurf('#57534d', 1), m.clone().multiply(T(27 + 10, -12, 106, 0.15, 0.2, -Math.PI / 2 - 1.0)));
    const bells: [number, number, number][] = [
      [-11, 10, 0.0],
      [11, 10, 0.06],
      [-11, -10, -0.05],
      [11, -10, 0.42],
    ];
    for (const [bx, by, tilt] of bells) {
      const broken = tilt > 0.3;
      const L = broken ? 16 : 26;
      const g = lathe(
        [
          [4.5, 0],
          [5.2, 3],
          [6.8, L * 0.45],
          [8.8, L * 0.85],
          [9.6, L],
          [9.2, L],
          [8.4, L * 0.85],
          [6.4, L * 0.45],
          [4.4, 3],
        ],
        28,
      );
      g.rotateX(Math.PI / 2);
      b.add(g, { color: '#3d3833', metal: 0.7, rough: 0.45, panel: 0.4 }, m.clone().multiply(T(bx, by, 138, tilt, tilt * 0.5, 0)));
    }
    glows.add(new Vector3(0, 33, 100).applyMatrix4(m), '#ff2a1a', 55, 6, GlowMode.Beacon, 0.8, 3.5);
  }

  // ---- the break: exposed frames, decks, hanging girders ---------------------------------------
  const frames = (m: Matrix4, zs: number[], seed: number) => {
    const r = mulberry32(seed);
    for (const z of zs) {
      const pts: Vector3[] = [];
      const a0 = -0.7 + r() * 0.9;
      const a1 = Math.PI * 2 - 0.3 - r() * 1.4;
      for (let a = a0; a <= a1; a += 0.16) {
        if (r() < 0.04) break;
        superPoint(a, 21, 20, 20, 2.4, 2.4, tmpV2);
        pts.push(new Vector3(tmpV2.x, tmpV2.y - r() * 0.8, z + (r() - 0.5) * 1.2).applyMatrix4(m));
      }
      if (pts.length > 3) b.add(tube(pts, 0.8, pts.length * 2, 4), { color: '#55524d', metal: 0.5, rough: 0.55, panel: 0.3 });
    }
  };
  frames(fwdM, [fLen - 26, fLen - 19, fLen - 12, fLen - 5, fLen + 2], 3);
  frames(aftM, [-1, 6, 13, 20], 4);
  const decks = (m: Matrix4, zEdge: number, dir: number, seed: number) => {
    const r = mulberry32(seed);
    for (const ly of [-10, -2, 6, 13]) {
      const half = 21 * Math.pow(1 - Math.pow(Math.abs(ly) / 21, 2.4), 1 / 2.4) - 1.5;
      const len = 14 + r() * 10;
      b.add(rbox(half * 2, 0.8, len, 0.2), { color: '#504d49', metal: 0.4, rough: 0.6, panel: 0.6 }, m.clone().multiply(T(0, ly, zEdge - (dir * len) / 2 + dir * 3)));
      const over = 4 + r() * 9;
      b.add(rbox(half * (0.7 + r() * 0.6), 0.6, over, 0.2), { color: '#47443f', metal: 0.4, rough: 0.6, panel: 0.4 }, m.clone().multiply(T((r() - 0.5) * 10, ly - r() * 2, zEdge + dir * (over / 2 + 2), dir * (0.2 + r() * 0.35), 0, (r() - 0.5) * 0.25)));
      for (let k = 0; k < 3; k++) b.add(rbox(0.6, 7, len * 0.6, 0.2), { color: '#4a4743', metal: 0.4, rough: 0.6, panel: 0.4 }, m.clone().multiply(T((r() - 0.5) * half * 1.6, ly + 3.6, zEdge - (dir * len) / 2)));
    }
    for (let k = 0; k < 10; k++) {
      const a = r() * Math.PI * 2;
      superPoint(a, 18, 17, 17, 2.4, 2.4, tmpV2);
      const p0 = new Vector3(tmpV2.x, tmpV2.y, zEdge - dir * 5);
      const p1 = p0.clone().add(new Vector3((r() - 0.5) * 9, (r() - 0.65) * 9, dir * (8 + r() * 14)));
      b.add(strut(p0.applyMatrix4(m), p1.applyMatrix4(m), 0.5 + r() * 0.5, 4), { color: TRUSS, metal: 0.5, rough: 0.55, panel: 0 });
    }
  };
  decks(fwdM, fLen - 4, 1, 21);
  decks(aftM, 2, -1, 22);
  for (let i = 0; i < 7; i++) {
    const p = breakPt.clone().add(new Vector3((rnd() - 0.5) * 30, 0, (rnd() - 0.5) * 30));
    p.y = ground(p) + (rnd() - 0.3) * 16;
    glows.add(p, '#ffe2b0', 22, 2.6, GlowMode.Failing, rnd() * 10, 2.5);
  }

  // ---- habitation ring ------------------------------------------------------------------------
  const RING_R = 74;
  const ringArc = (m: Matrix4, a0: number, a1: number, seed: number, tornEnd = false) => {
    const segs = Math.max(4, Math.round(((a1 - a0) * RING_R) / 4.5));
    const keep = (u0: number, u1: number, v0: number, v1: number) => {
      const a = a0 + (a1 - a0) * ((u0 + u1) / 2);
      const v = (v0 + v1) / 2;
      const rag = (0.03 + 0.12 * fbm2(v * 7, seed, 3, 2) + (Math.sin(v * 31) > 0.4 ? 0.05 : 0)) * 1.0;
      return !(tornEnd && a > a1 - rag);
    };
    const g = paramSurface(
      (u, v, out) => {
        const a = a0 + (a1 - a0) * u;
        superPoint(v * Math.PI * 2, 7.5, 9.5, 9.5, 7, 7, tmpV2);
        const r = RING_R + tmpV2.x;
        out.set(Math.cos(a) * r, Math.sin(a) * r, tmpV2.y);
      },
      segs,
      28,
      { keep },
    );
    const inv = m.clone().invert();
    const dark = new Color('#1e1f20');
    b.add(g, hullSurf('#9b978e'), m, (p, n, c) => {
      weather(seed)(p, n, c);
      const l = p.clone().applyMatrix4(inv);
      const rr = Math.hypot(l.x, l.y);
      // Window band on both faces.
      if (Math.abs(Math.abs(l.z) - 9.3) < 0.6 && rr > RING_R - 2 && rr < RING_R + 3) c.copy(dark);
    });
    // Segment joints.
    const step = 0.2;
    for (let a = Math.ceil(a0 / step) * step; a < a1; a += step) {
      const cg = paramSurface(
        (u, v, out) => {
          const aa = a - 0.02 + u * 0.04;
          superPoint(v * Math.PI * 2, 8.6, 10.6, 10.6, 7, 7, tmpV2);
          const r = RING_R + tmpV2.x;
          out.set(Math.cos(aa) * r, Math.sin(aa) * r, tmpV2.y);
        },
        1,
        28,
      );
      b.add(cg, hullSurf('#5a5751', 0.5), m);
    }
    const rr = mulberry32(seed);
    for (let i = 0; i < 3; i++) {
      const a = a0 + rr() * (a1 - a0);
      glows.add(new Vector3(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 10).applyMatrix4(m), '#ffcf96', 9, 2.0, GlowMode.Failing, rr() * 9, 2);
    }
  };
  // Attached arc: rises out of the ground beside the hull, arches over it, snapped near the top.
  const ringM = fwdM.clone().multiply(T(0, 0, 117, 0.3, 0, 0.12));
  ringArc(ringM, -0.55, 1.42, 31, true);
  for (const [a, ok] of [
    [0.45, true],
    [1.2, true],
    [2.3, false],
  ] as [number, boolean][]) {
    const p0 = new Vector3(Math.cos(a) * 13, Math.sin(a) * 13, 0);
    const p1 = new Vector3(Math.cos(a) * (ok ? RING_R - 7 : 38), Math.sin(a) * (ok ? RING_R - 7 : 38), 0);
    const dir = p1.clone().sub(p0).normalize();
    const side = new Vector3(-dir.y, dir.x, 0);
    for (const o of [-1, 1]) {
      const off = side.clone().multiplyScalar(o * 1.8).add(new Vector3(0, 0, o * 2.2));
      b.add(strut(p0.clone().add(off).applyMatrix4(ringM), p1.clone().add(off).applyMatrix4(ringM), 1.1, 6), { color: '#6f6b64', metal: 0.45, rough: 0.55, panel: 0.4 });
    }
    for (let t = 0.1; t < 0.95; t += 0.14) {
      const q = p0.clone().lerp(p1, t);
      b.add(rbox(4.8, 0.8, 5.6, 0.2), { color: '#55524d', metal: 0.45, rough: 0.55, panel: 0 }, ringM.clone().multiply(T(q.x, q.y, q.z, 0, 0, Math.atan2(dir.y, dir.x))));
    }
  }
  glows.add(new Vector3(Math.cos(1.2) * (RING_R + 9), Math.sin(1.2) * (RING_R + 9), 0).applyMatrix4(ringM), '#ff2a1a', 70, 6, GlowMode.Beacon, 0.05, 4);
  // Ragged end of the snapped arc: torn frames and girders hanging out.
  {
    const r = mulberry32(55);
    for (let k = 0; k < 9; k++) {
      const a = 1.36 - r() * 0.04;
      const off = new Vector3((r() - 0.5) * 12, 0, (r() - 0.5) * 16);
      const p0 = new Vector3(Math.cos(a) * (RING_R + off.x), Math.sin(a) * (RING_R + off.x), off.z);
      const tan = new Vector3(-Math.sin(a), Math.cos(a), 0);
      const p1 = p0.clone().addScaledVector(tan, 4 + r() * 9).add(new Vector3((r() - 0.5) * 4, -r() * 6, (r() - 0.5) * 4));
      b.add(strut(p0.applyMatrix4(ringM), p1.applyMatrix4(ringM), 0.35 + r() * 0.3, 4), { color: TRUSS, metal: 0.5, rough: 0.55, panel: 0 });
    }
  }
  glows.add(new Vector3(Math.cos(1.38) * RING_R, Math.sin(1.38) * RING_R, 4).applyMatrix4(ringM), '#cfe6ff', 30, 4, GlowMode.Failing, 2.2, 3);

  // Fallen ring segments lying apart, half buried.
  const fallen = (s: number, lat: number, a0: number, a1: number, tiltX: number, tiltZ: number, sink: number, seed: number) => {
    const p = along(s, lat);
    const gy = ground(p);
    const mid = (a0 + a1) / 2;
    const m = T(p.x, gy - sink, p.z, 0, yaw + (seed % 7) * 0.4, 0)
      .multiply(T(0, 0, 0, tiltX, 0, tiltZ))
      .multiply(T(-Math.cos(mid) * RING_R, -Math.sin(mid) * RING_R, 0));
    ringArc(m, a0, a1, seed);
  };
  fallen(-60, -140, 0.2, 0.95, Math.PI / 2 - 0.22, 0.08, 3, 41);
  fallen(40, 135, 1.2, 1.7, Math.PI / 2 - 0.12, 0.05, 4, 42);
  fallen(-150, 105, 3.6, 4.05, Math.PI / 2 - 0.4, -0.2, 2, 43);

  // ---- ground contact: berms along the hull, bow-wave heap --------------------------------------
  const berm = (s0: number, s1: number, lat: number, height: number, width: number, seed: number) => {
    const g = paramSurface(
      (u, v, out) => {
        const s = s0 + (s1 - s0) * u;
        const n = fbm2(u * 9, seed, 4, seed);
        const h = height * (0.55 + 0.9 * n) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.4);
        const off = (v - 0.5) * width * (0.8 + 0.5 * n);
        const p = along(s, lat + off);
        const prof = Math.pow(Math.max(0, Math.cos((v - 0.5) * Math.PI)), 1.6);
        out.set(p.x, ground(p) - 0.8 + h * prof, p.z);
      },
      48,
      10,
    );
    b.add(g, { color: '#7d7368', rough: 0.98, panel: 0 });
  };
  berm(bowS + 20, breakS + 10, 31, 9, 26, 3);
  berm(bowS + 20, breakS + 10, -31, 8, 26, 5);
  berm(aftS0 - 6, sternS - 20, 36, 8, 26, 7);
  berm(aftS0 - 6, sternS - 20, -32, 8, 26, 9);
  {
    const g = paramSurface(
      (u, v, out) => {
        const a = (u - 0.5) * Math.PI * 1.25;
        const n = fbm2(u * 7, 2.2, 4, 17);
        const r = 22 + v * 34 * (0.8 + 0.4 * n);
        const p = along(bowS - 2 - Math.cos(a) * r, Math.sin(a) * r);
        const h = 15 * (0.5 + 0.8 * n) * Math.pow(Math.max(0, Math.sin(Math.PI * v)), 1.3) * Math.pow(Math.max(0, Math.cos(a * 0.8)), 1.2);
        out.set(p.x, ground(p) - 1 + h, p.z);
      },
      40,
      12,
    );
    b.add(g, { color: '#7d7368', rough: 0.98, panel: 0 });
  }

  // ---- debris field ---------------------------------------------------------------------------
  const plate = (p: Vector3, size: number, r: () => number) => {
    const span = 0.5 + r() * 0.7;
    const rad = 14 + r() * 14;
    const len = size * (0.8 + r() * 0.6);
    const g = paramSurface(
      (u, v, out) => {
        const a = (v - 0.5) * span;
        out.set(Math.sin(a) * rad, Math.cos(a) * rad - rad, (u - 0.5) * len);
      },
      3,
      8,
    );
    const m = T(p.x, ground(p) - size * 0.1, p.z, 0, r() * Math.PI * 2, 0).multiply(T(0, 0, 0, (r() - 0.5) * 1.4, 0, (r() - 0.5) * 2.2));
    b.add(g, hullSurf(r() < 0.5 ? HULL : HULL2), m, weather(5));
    // Internal stiffeners on the concave side.
    for (let k = -1; k <= 1; k += 2) b.add(rbox(Math.sin(span / 2) * rad * 1.8, 0.6, 0.6, 0.15), { color: TRUSS, metal: 0.5, rough: 0.55, panel: 0 }, m.clone().multiply(T(0, -0.5 - rad * (1 - Math.cos(span / 4)), (k * len) / 4)));
  };
  const truss = (p: Vector3, size: number, r: () => number) => {
    const len = size * (1.2 + r());
    const m = T(p.x, ground(p) + 0.6, p.z, 0, r() * Math.PI * 2, 0).multiply(T(0, 0, 0, (r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.5));
    const h = 1.6 + size * 0.06;
    for (const y of [-h, h]) b.add(rbox(0.9, 0.9, len, 0.15), { color: TRUSS, metal: 0.5, rough: 0.55, panel: 0.3 }, m.clone().multiply(T(0, y, 0)));
    const n = Math.max(2, Math.round(len / (h * 2)));
    for (let k = 0; k < n; k++) {
      const z0 = -len / 2 + (k * len) / n;
      const z1 = z0 + len / n;
      b.add(strut(new Vector3(0, -h, z0), new Vector3(0, h, z1), 0.3, 4), { color: TRUSS, metal: 0.5, rough: 0.55, panel: 0 }, m);
    }
  };
  const shell = (p: Vector3, size: number, r: () => number) => {
    // Broken hull section lying on its side, ribs inside.
    const rad = size * 0.55;
    const span = 1.6 + r() * 1.4;
    const len = size * (0.8 + r() * 0.7);
    const g = paramSurface(
      (u, v, out) => {
        const a = (v - 0.5) * span;
        out.set(Math.sin(a) * rad, Math.cos(a) * rad, (u - 0.5) * len);
      },
      4,
      14,
      { flip: true },
    );
    const m = T(p.x, ground(p) - rad * 0.35, p.z, 0, r() * Math.PI * 2, 0).multiply(T(0, 0, 0, (r() - 0.5) * 0.3, 0, Math.PI / 2 + (r() - 0.5) * 1.2));
    b.add(g, hullSurf(HULL), m, weather(7));
    for (let k = 0; k < 3; k++) {
      const z = -len / 2 + ((k + 0.5) * len) / 3;
      const pts: Vector3[] = [];
      for (let t = 0; t <= 8; t++) {
        const a = (t / 8 - 0.5) * span;
        pts.push(new Vector3(Math.sin(a) * (rad - 0.6), Math.cos(a) * (rad - 0.6), z).applyMatrix4(m));
      }
      b.add(tube(pts, 0.35, 12, 4), { color: TRUSS, metal: 0.5, rough: 0.55, panel: 0 });
    }
  };
  const piece = (p: Vector3, size: number, r: () => number) => {
    const k = r();
    if (k < 0.5) plate(p, size, r);
    else if (k < 0.75) truss(p, size, r);
    else shell(p, size, r);
  };
  const dr = mulberry32(2024);
  const trenchCount = quality === 'low' ? 40 : 70;
  const t0 = TRENCH.end.clone();
  const t1 = TRENCH.start.clone();
  const tside = new Vector3(-(t1.z - t0.z), 0, t1.x - t0.x).normalize();
  for (let i = 0; i < trenchCount; i++) {
    const t = Math.pow(dr(), 1.5) * 0.8;
    const p = t0.clone().lerp(t1, t);
    p.addScaledVector(tside, (dr() + dr() + dr() - 1.5) * TRENCH.width * 0.8);
    piece(p, (1 - t) * 20 * (0.3 + dr()) + 3, dr);
  }
  const ringCount = quality === 'low' ? 25 : 45;
  for (let i = 0; i < ringCount; i++) {
    const a = dr() * Math.PI * 2;
    const r = WRECK.length * 0.3 + dr() * 140;
    piece(C.clone().add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 4 + dr() * 13, dr);
  }
  // A few big pieces on the near side: depth cues in the vista from the outpost.
  for (let i = 0; i < 7; i++) {
    const p = C.clone().lerp(new Vector3(0, 0, 0), 0.28 + dr() * 0.16).add(new Vector3((dr() - 0.5) * 170, 0, (dr() - 0.5) * 60));
    piece(p, 7 + dr() * 10, dr);
  }

  return { builder: b, groundY: groundC };
}

// The dropship Wren: the players' ship and the hero prop. ~22 m VTOL lander with a wrapped
// cockpit canopy, twin pylon-mounted engine nacelles, V-tail, sturdy gear on footpads and an
// open rear cargo ramp down to the pad. Built in ship space (nose -Z, ramp +Z) and transformed
// into the world, so it merges with the outpost's geometry by material.

import { Color, Float32BufferAttribute, Matrix4, Vector3, type BufferGeometry } from 'three';
import { Asm, PartBuilder, T, facing, type Kit } from './builder';
import { addDecal, GlowMode, type GlowSet } from './fx';
import { RAMP_LIP_Z, WREN, WREN_UMBILICAL } from './layout';
import { bcyl, cyl, extrude, hullPoint, lathe, paramSurface, rbox, sphere, stationAt, strut, tube, type Station } from './shapes';
import type { DecalAtlas } from './textures';

const WHITE = '#c9c6bd';
const WHITE2 = '#bdb9ae';
const GUN = '#2b2e33';
const GUN2 = '#383b40';
const YEL = '#d1a21f';
const RUBBER = '#18191a';
const CHROME = '#c4c7c9';
const INTERIOR = '#3a3d40';

const hullWhite = { color: WHITE, metal: 0.08, rough: 0.5, panel: 1, scale: 1.3 };
const hullGun = { color: '#33363b', metal: 0.3, rough: 0.5, panel: 1, scale: 1.3 };
const metalGun = { color: GUN2, metal: 0.7, rough: 0.38, panel: 0.5 };
const chrome = { color: CHROME, metal: 1, rough: 0.16, panel: 0 };
const rubber = { color: RUBBER, metal: 0, rough: 0.75, panel: 0 };

/** Fuselage stations (ship space). */
export const FUSE: Station[] = [
  { z: -11.0, w: 0.9, ht: 0.22, hb: 0.25, y: 2.0, nt: 3, nb: 3 },
  { z: -10.35, w: 1.9, ht: 0.55, hb: 0.5, y: 2.1, nt: 3.4, nb: 3.6 },
  { z: -9.3, w: 2.75, ht: 0.98, hb: 0.78, y: 2.28, nt: 3.8, nb: 4.4 },
  { z: -7.9, w: 3.35, ht: 1.42, hb: 1.0, y: 2.42, nt: 4.2, nb: 5 },
  { z: -6.2, w: 3.75, ht: 1.66, hb: 1.15, y: 2.52, nt: 4.6, nb: 5.5 },
  { z: -3.3, w: 4.0, ht: 1.62, hb: 1.27, y: 2.6, nt: 5, nb: 6 },
  { z: 0.5, w: 4.1, ht: 1.62, hb: 1.33, y: 2.65, nt: 5, nb: 6 },
  { z: 3.6, w: 4.05, ht: 1.6, hb: 1.24, y: 2.7, nt: 5, nb: 6 },
  { z: 6.2, w: 3.8, ht: 1.46, hb: 0.94, y: 3.0, nt: 4.6, nb: 5 },
  { z: 8.3, w: 3.15, ht: 1.1, hb: 0.56, y: 3.42, nt: 4, nb: 3.6 },
  { z: 9.6, w: 2.1, ht: 0.72, hb: 0.36, y: 3.6, nt: 3.4, nb: 3 },
  { z: 10.15, w: 0.8, ht: 0.26, hb: 0.2, y: 3.62, nt: 3, nb: 3 },
];

const tmpSt: Station = { z: 0, w: 0, ht: 0, hb: 0, y: 0, nt: 2, nb: 2 };

const zTables = new WeakMap<Station[], Float64Array>();
const Z_SAMPLES = 2048;

/** Station parameter u for a given z (z is monotonic in u), via a cached z(u) table. */
export function uAtZ(stations: Station[], z: number): number {
  let table = zTables.get(stations);
  if (!table) {
    table = new Float64Array(Z_SAMPLES + 1);
    for (let i = 0; i <= Z_SAMPLES; i++) table[i] = stationAt(stations, i / Z_SAMPLES, tmpSt).z;
    zTables.set(stations, table);
  }
  if (z <= table[0]) return 0;
  if (z >= table[Z_SAMPLES]) return 1;
  let lo = 0;
  let hi = Z_SAMPLES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] < z) lo = mid;
    else hi = mid;
  }
  const t = (z - table[lo]) / Math.max(table[hi] - table[lo], 1e-9);
  return (lo + t) / Z_SAMPLES;
}

/** Hull point at z and angle (radians, 0 = +X, PI/2 = top), pushed out along the normal by `off`. */
function hullAt(stations: Station[], z: number, a: number, off = 0, out = new Vector3()): Vector3 {
  const u = uAtZ(stations, z);
  hullPoint(stations, u, a / (Math.PI * 2), out);
  if (off !== 0) out.addScaledVector(hullNormal(stations, z, a), off);
  return out;
}

function hullNormal(stations: Station[], z: number, a: number): Vector3 {
  const e = 0.01;
  const p0 = hullAt(stations, z - e, a);
  const p1 = hullAt(stations, z + e, a);
  const q0 = hullAt(stations, z, a - e);
  const q1 = hullAt(stations, z, a + e);
  const dz = p1.sub(p0);
  const da = q1.sub(q0);
  // Outward: da × dz for angles increasing counter-clockwise when looking down -Z.
  return new Vector3().crossVectors(da, dz).normalize();
}

/** Frame on the hull surface: +Z out of the surface, +Y toward `up` (default world up). */
function onHull(stations: Station[], z: number, a: number, off = 0, up = new Vector3(0, 1, 0)): Matrix4 {
  const p = hullAt(stations, z, a, off);
  const n = hullNormal(stations, z, a);
  const u = Math.abs(n.dot(up)) > 0.95 ? new Vector3(0, 0, -1) : up;
  return facing(p, n, u);
}

/** Bottom-surface height of the fuselage at (x, z) (for the cargo opening edges). */
function bottomAt(stations: Station[], z: number, x: number): number {
  const st = stationAt(stations, uAtZ(stations, z), tmpSt);
  const hw = st.w / 2;
  const c = Math.min(Math.abs(x) / hw, 0.999);
  const cc = Math.pow(c, st.nb / 2);
  const s = Math.sqrt(1 - cc * cc);
  return st.y - st.hb * Math.pow(s, 2 / st.nb);
}

/** Top-surface height of a loft at (x, z) (clamped to the station's half-width). */
function topAt(stations: Station[], z: number, x: number): number {
  const st = stationAt(stations, uAtZ(stations, z), tmpSt);
  const hw = st.w / 2;
  const c = Math.min(Math.abs(x - (st.x ?? 0)) / hw, 0.999);
  const cc = Math.pow(c, st.nt / 2);
  const s = Math.sqrt(1 - cc * cc);
  return st.y + st.ht * Math.pow(s, 2 / st.nt);
}

export interface ShipBuild {
  /** Ship-space position of the cargo bay light (for the real PointLight). */
  bayLight: Vector3;
}

/**
 * Builds the Wren into the given builders. `asm` maps ship space to the world.
 * shell: the open fuselage skin (double-sided material); glass: canopy.
 */
export function buildShip(asm: Asm, shell: PartBuilder, glass: PartBuilder, glows: GlowSet, atlas: DecalAtlas): ShipBuild {
  const M = asm.m;
  const kit: Kit = asm.kit;
  const W = (m: Matrix4) => M.clone().multiply(m);

  // ---- fuselage skin ------------------------------------------------------------------------
  const hingeZ = WREN.rampHingeZ;
  const keepFuse = (u0: number, u1: number, v0: number, v1: number): boolean => {
    const p = hullPoint(FUSE, (u0 + u1) / 2, (v0 + v1) / 2, new Vector3());
    const st = stationAt(FUSE, (u0 + u1) / 2, tmpSt);
    const open = p.z > hingeZ && p.z < 9.75 && p.y < st.y - 0.12 && Math.abs(p.x) < 1.6;
    return !open;
  };
  const fuseF = (u: number, v: number, out: Vector3) => hullPoint(FUSE, u, v, out);
  // Upper hull: off-white. Lower hull: gunmetal. Split along a chine below the centre line.
  // (The skin is one surface: its two halves, the end domes and the framed cargo opening seal it.)
  shell.add(paramSurface(fuseF, 110, 46, { flip: true, vRange: [-0.045, 0.545], keep: keepFuse }), { ...hullWhite, open: true }, M);
  shell.add(paramSurface(fuseF, 110, 30, { flip: true, vRange: [0.545, 0.955], keep: keepFuse }), { ...hullGun, open: true }, M);

  // Chine rails (hazard yellow strip on the left/right where paint changes).
  for (const a of [-0.045 * Math.PI * 2, 0.545 * Math.PI * 2]) {
    const pts: Vector3[] = [];
    for (let z = -9.2; z <= 8.8; z += 0.45) pts.push(hullAt(FUSE, z, a, 0.015));
    asm.small(tube(pts, 0.045, 80, 5), { color: YEL, rough: 0.5, panel: 0.4 });
  }

  // ---- cockpit canopy: wrapped glazing following the nose ----------------------------------
  const zFront = (a: number) => -10.25 + 0.55 * Math.pow(Math.abs(Math.cos(a)), 1.5);
  const zRear = (a: number) => -6.9 + 0.75 * Math.pow(Math.abs(Math.cos(a)), 1.2);
  const aMin = 0.065 * Math.PI * 2;
  const aMax = 0.435 * Math.PI * 2;
  const canopy = paramSurface(
    (u, v, out) => {
      const a = aMin + (aMax - aMin) * v;
      const z = zFront(a) + (zRear(a) - zFront(a)) * u;
      hullAt(FUSE, z, a, 0.03, out);
    },
    18,
    26,
    { flip: true },
  );
  // Ensure the canopy faces outward (param orientation differs from the hull's).
  glass.add(canopy, { color: '#ffffff', rough: 0.05, panel: 0, open: true }, M);
  // Frame: outline + mullions.
  {
    const frame = { color: GUN, metal: 0.6, rough: 0.4, panel: 0.3 };
    const line = (fn: (t: number) => Vector3, n: number, r: number) => {
      const pts: Vector3[] = [];
      for (let i = 0; i <= n; i++) pts.push(fn(i / n));
      asm.small(tube(pts, r, n * 3, 6), frame);
    };
    const at = (a: number, t: number, off = 0.06) => hullAt(FUSE, zFront(a) + (zRear(a) - zFront(a)) * t, a, off);
    line((t) => at(aMin + (aMax - aMin) * t, 0, 0.055), 16, 0.06);
    line((t) => at(aMin + (aMax - aMin) * t, 1, 0.055), 16, 0.065);
    for (const f of [0, 0.28, 0.5, 0.72, 1]) line((t) => at(aMin + (aMax - aMin) * f, t, 0.06), 10, f === 0 || f === 1 ? 0.065 : 0.045);
    line((t) => at(aMin + (aMax - aMin) * t, 0.55, 0.055), 16, 0.035);
  }

  // Matte anti-glare panel ahead of the windshield and a gunmetal nose cap.
  {
    const ag = paramSurface(
      (u, v, out) => {
        const a = Math.PI / 2 + (v - 0.5) * 0.9;
        const z = -10.75 + (zFront(a) - 0.08 + 10.75) * u;
        hullAt(FUSE, z, a, 0.012, out);
      },
      8,
      12,
      { flip: true },
    );
    shell.add(ag, { color: '#2a2d31', metal: 0.2, rough: 0.78, panel: 0.4, open: true }, M);
    const cap = paramSurface((u, v, out) => hullAt(FUSE, -11 + u * 0.32, v * Math.PI * 2, 0.008, out), 3, 40, { flip: true });
    shell.add(cap, { color: GUN, metal: 0.55, rough: 0.4, panel: 0.3, open: true }, M);
    // The loft stops at finite end stations: close both ends with shallow domes so the hull is
    // sealed (an open nose or tail let you look straight into, and through, the fuselage).
    shell.add(endDome(FUSE, 0, -0.16, 0.008), { color: GUN, metal: 0.55, rough: 0.4, panel: 0.3, open: true }, M);
    shell.add(endDome(FUSE, 1, 0.12, 0), { color: GUN2, metal: 0.5, rough: 0.45, panel: 0.4, open: true }, M);
  }

  // ---- nacelles -----------------------------------------------------------------------------
  const NAC: Station[] = [
    { z: WREN.nacelleZ0, w: 1.62, ht: 0.8, hb: 0.8, y: 0, nt: 2.3, nb: 2.3 },
    { z: WREN.nacelleZ0 + 0.35, w: 2.0, ht: 1.0, hb: 0.98, y: 0, nt: 2.5, nb: 2.4 },
    { z: 3.4, w: 2.18, ht: 1.08, hb: 1.06, y: 0, nt: 2.7, nb: 2.5 },
    { z: 6.6, w: 2.08, ht: 1.02, hb: 1.0, y: 0, nt: 2.7, nb: 2.5 },
    { z: 9.0, w: 1.78, ht: 0.88, hb: 0.86, y: 0, nt: 2.5, nb: 2.4 },
    { z: WREN.nacelleZ1, w: 1.58, ht: 0.78, hb: 0.78, y: 0, nt: 2.3, nb: 2.3 },
  ];
  for (const side of [-1, 1]) {
    const nx = side * WREN.nacelleX;
    const ny = WREN.nacelleY;
    const nm = W(T(nx, ny, 0));
    const nacF = (u: number, v: number, out: Vector3) => hullPoint(NAC, u, v, out);
    const soot = (p: Vector3, _n: Vector3, c: Color) => {
      // Heat-darkened rear (positions are already in world space; use the local z via inverse).
      const lz = p.clone().applyMatrix4(invM).z;
      const k = Math.min(1, Math.max(0, (lz - 7.6) / 2.4));
      c.multiplyScalar(1 - 0.55 * k * k);
    };
    const invM = nm.clone().invert();
    kit.hard.add(paramSurface(nacF, 40, 34, { flip: true, vRange: [-0.06, 0.56] }), { ...hullWhite, open: true }, nm, soot);
    kit.hard.add(paramSurface(nacF, 40, 22, { flip: true, vRange: [0.56, 0.94] }), { ...hullGun, open: true }, nm, soot);
    const nac = new Asm(kit, nm);
    // Intake: yellow lip ring, dark duct, spinner and fan blades.
    // (Lathe profiles here are closed loops with the material on their left, so every face
    // points out of the solid. Lathe +Y maps to ship -Z, i.e. forward, under this rotation.)
    const intake = T(0, 0, WREN.nacelleZ0 + 0.02, -Math.PI / 2, 0, 0);
    nac.hard(lathe([[0.62, -0.1], [0.84, -0.06], [0.92, 0.06], [0.84, 0.2], [0.7, 0.24], [0.6, 0.12], [0.6, -0.08], [0.62, -0.1]], 32), { color: YEL, rough: 0.45, metal: 0.2, panel: 0.6 }, intake);
    // Duct liner from the lip back to the fan face: you look down a tube, not into the nacelle.
    nac.small(lathe([[0.6, -0.45], [0.72, -0.45], [0.72, -0.02], [0.6, -0.02], [0.6, -0.45]], 32), { color: '#1c1d1f', rough: 0.55, metal: 0.5, panel: 0 }, intake);
    nac.small(bcyl(0.74, 0.06, 32), { color: '#141516', rough: 0.6, metal: 0.4, panel: 0 }, T(0, 0, WREN.nacelleZ0 + 0.38, Math.PI / 2, 0, 0));
    nac.small(lathe([[0, 0.0], [0.24, 0.0], [0.22, 0.12], [0.12, 0.34], [0.0, 0.42]], 16), { color: GUN, metal: 0.8, rough: 0.3, panel: 0 }, T(0, 0, WREN.nacelleZ0 + 0.35, -Math.PI / 2, 0, 0));
    // Bulkheads seal both ends of the nacelle skin behind the fan and ahead of the nozzle.
    kit.hard.add(stationDisc(NAC, WREN.nacelleZ0 + 0.5, 0.012, true), { color: '#1c1d1f', rough: 0.6, metal: 0.4, panel: 0, open: true }, nm);
    kit.hard.add(stationDisc(NAC, WREN.nacelleZ1 - 0.12, 0.012, false), { color: '#1c1d1f', rough: 0.6, metal: 0.4, panel: 0, open: true }, nm);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      nac.small(rbox(0.05, 0.46, 0.14, 0.01), { color: '#55585c', metal: 0.9, rough: 0.3, panel: 0 }, T(Math.cos(a) * 0.46, Math.sin(a) * 0.46, WREN.nacelleZ0 + 0.3, 0.35, 0, a - Math.PI / 2));
    }
    // Nozzle: bell, cold inner cone (engines off), outer petals ring.
    const nz = WREN.nacelleZ1;
    // (Lathe +Y maps to ship +Z, i.e. aft, under this rotation.)
    nac.hard(lathe([[0.76, 0], [0.74, 0.25], [0.7, 0.62], [0.66, 0.66], [0.6, 0.6], [0.58, 0.1], [0.6, 0], [0.76, 0]], 32), { color: '#3a3532', metal: 0.85, rough: 0.35, panel: 0.2 }, T(0, 0, nz - 0.08, Math.PI / 2, 0, 0));
    nac.small(lathe([[0, -0.04], [0.56, -0.04], [0.56, 0.0], [0.35, 0.12], [0.0, 0.2]], 24), { color: '#2a2622', metal: 0.75, rough: 0.5, panel: 0 }, T(0, 0, nz + 0.12, Math.PI / 2, 0, 0)); // cold turbine cone: the ship is parked
    // Aft trim ring closing the slot between the nacelle skin and the bell.
    nac.hard(lathe([[0.62, -0.16], [0.84, -0.16], [0.86, -0.12], [0.86, 0.04], [0.82, 0.08], [0.62, 0.08], [0.62, -0.16]], 32), { color: '#2e2a28', metal: 0.8, rough: 0.4, panel: 0.2 }, T(0, 0, nz, Math.PI / 2, 0, 0));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      nac.small(rbox(0.12, 0.04, 0.55, 0.01), { color: '#2e2a28', metal: 0.85, rough: 0.35, panel: 0 }, T(Math.cos(a) * 0.75, Math.sin(a) * 0.75, nz + 0.2, 0, 0, a).multiply(T(0, 0, 0, -0.12, 0, 0)));
    }
    // Top vents and access hatches on the nacelle.
    for (let k = 0; k < 6; k++) nac.small(rbox(0.9, 0.05, 0.08, 0.015), { color: '#1e2023', metal: 0.6, rough: 0.5, panel: 0 }, T(0, 1.07, 4.6 + k * 0.17));
    nac.small(rbox(1.05, 0.04, 1.2, 0.02), { color: WHITE2, metal: 0.1, rough: 0.5, panel: 0.8 }, T(0, 1.075, 2.3));
    nac.small(rbox(0.5, 0.05, 0.5, 0.02), { color: GUN, metal: 0.6, rough: 0.4, panel: 0.6 }, T(side * 1.0, 0.45, 1.6, 0, 0, side * -1.1));
    // Navigation light on the outboard side: red port, green starboard.
    const navCol = side < 0 ? '#ff2a1a' : '#2aff6a';
    nac.small(sphere(0.09, 10, 8), { color: navCol, rough: 0.2, panel: 0, glow: 3 }, T(side * 1.1, 0.15, 1.0));
    glows.add(nac.pt(side * 1.2, 0.15, 1.0), navCol, 5, 0.45, GlowMode.Steady, 0, 1.5, nac.dir(side, 0, 0));
    // "07" on the outboard nacelle flank, registration below: wrapped onto the curved skin
    // (flat quads floated up to 7 cm off it).
    hullDecal(kit.decal, nm, atlas, 'N07', 5.2, side > 0 ? 0.25 : Math.PI - 0.25, 0.95, side, '#2b2e33', NAC);
    hullDecal(kit.decal, nm, atlas, 'REG', 5.2, side > 0 ? -0.07 : Math.PI + 0.07, 2.6, side, '#2b2e33', NAC);
  }

  // ---- pylons ---------------------------------------------------------------------------------
  for (const side of [-1, 1]) {
    const pm = W(T(side * 2.85, 2.95, 4.6, 0, 0, side * -0.05));
    const p = new Asm(kit, pm);
    p.hard(rbox(2.6, 0.72, 6.4, 0.2, 2), hullWhite);
    p.hard(rbox(1.8, 0.4, 5.6, 0.12, 1), hullGun, T(0, -0.36, 0.1));
    p.small(rbox(1.7, 0.05, 1.1, 0.02), { color: WHITE2, rough: 0.5, panel: 0.8 }, T(0, 0.37, -1.6));
    p.small(rbox(0.12, 0.06, 6.0, 0.02), { color: YEL, rough: 0.5, panel: 0.3 }, T(side * 1.15, 0.36, 0));
    addDecal(kit, atlas, 'NOSTEP', 0.9, '#2b2e33', pm.clone().multiply(T(0, 0.375, 0.9, -Math.PI / 2, 0, side < 0 ? Math.PI : 0)));
    // Leading-edge fairing into the fuselage.
    p.hard(rbox(1.2, 0.6, 1.6, 0.2, 2), hullWhite, T(-side * 0.8, 0.0, -3.0, 0, side * 0.5, 0));
  }

  // ---- dorsal spine, sensors, beacon -----------------------------------------------------------
  {
    const top = (z: number) => hullAt(FUSE, z, Math.PI / 2).y;
    const sm = W(T(0, top(-0.5) + 0.12, -0.6));
    const s = new Asm(kit, sm);
    s.hard(rbox(1.15, 0.42, 9.2, 0.14, 2), hullGun);
    for (let k = 0; k < 10; k++) s.small(rbox(0.85, 0.05, 0.07, 0.015), { color: '#1d1f22', metal: 0.6, rough: 0.5, panel: 0 }, T(0, 0.22, 2.2 + k * 0.16));
    for (let k = 0; k < 10; k++) s.small(rbox(0.85, 0.05, 0.07, 0.015), { color: '#1d1f22', metal: 0.6, rough: 0.5, panel: 0 }, T(0, 0.22, -3.6 + k * 0.16));
    s.small(cyl(0.012, 0.025, 1.6, 6), { color: '#202020', metal: 0.5, rough: 0.4, panel: 0 }, T(0.3, 1.0, -0.4));
    s.small(sphere(0.04, 8, 6), { color: '#202020', rough: 0.4, panel: 0 }, T(0.3, 1.8, -0.4));
    s.hard(lathe([[0, 0], [0.32, 0], [0.3, 0.12], [0.2, 0.26], [0, 0.32]], 20), { color: '#d8d6cf', rough: 0.35, panel: 0 }, T(0, 0.19, 0.9));
    s.small(rbox(0.36, 0.08, 0.6, 0.03), { color: GUN, metal: 0.6, rough: 0.4 }, T(-0.25, 0.23, -1.9));
    // Red anti-collision beacon.
    s.small(cyl(0.09, 0.11, 0.16, 12), { color: '#ff2a1a', rough: 0.2, panel: 0, glow: 1.5 }, T(0, 0.3, 3.6));
    glows.add(s.pt(0, 0.42, 3.6), '#ff2a1a', 14, 0.7, GlowMode.Beacon, 0.4, 2);
  }

  // ---- V-tail fins -----------------------------------------------------------------------------
  for (const side of [-1, 1]) {
    const roll = side * -0.42;
    const baseY = hullAt(FUSE, 8.0, Math.PI / 2).y - 0.12;
    // The root edge follows the hull's top surface (it falls away toward the tail) and is sunk
    // 15 cm into it, so the fin never floats above the skin.
    const root: [number, number][] = [];
    for (let z = 5.9; z <= 10.0; z += 0.41) {
      const yl = (topAt(FUSE, z, side * 0.62) - baseY) / Math.cos(roll) - 0.15;
      root.push([z, yl]);
    }
    const outline: [number, number][] = [...root, [10.95, 2.4], [9.2, 2.45]];
    const fin = extrude(outline, 0.18, 0.05, 1);
    // Extrude lies in XY (x = z coordinate here, y = height), thickness along Z → rotate to ship.
    fin.rotateY(-Math.PI / 2);
    const fm = W(T(side * 0.62, baseY, 0, 0, 0, roll));
    kit.hard.add(fin, hullWhite, fm);
    const tip = new Vector3(0, 2.42, 10.1).applyMatrix4(fm);
    kit.small.add(sphere(0.06, 8, 6), { color: '#ffffff', rough: 0.2, panel: 0, glow: 3 }, T(tip.x, tip.y, tip.z));
    glows.add(tip, '#e8f0ff', 30, 0.7, GlowMode.Strobe, side * 0.06, 2);
    addDecal(kit, atlas, 'N07', 0.75, '#2b2e33', fm.clone().multiply(T(side * 0.1, 1.2, 9.0, 0, side * Math.PI / 2, 0)));
    // Yellow tip cap.
    kit.small.add(rbox(0.2, 0.08, 1.6, 0.03), { color: YEL, rough: 0.5, panel: 0.4 }, fm.clone().multiply(T(0, 2.42, 9.9)));
  }

  // ---- landing gear -------------------------------------------------------------------------
  const gear = (gx: number, gz: number, topY: number, twin: boolean) => {
    const g = new Asm(kit, W(T(gx, 0, gz)));
    const xs = twin ? [-0.34, 0.34] : [0];
    for (const ox of xs) {
      g.hard(bcyl(twin ? 0.13 : 0.17, topY - 0.7, 16), metalGun, T(ox, (topY + 0.7) / 2 + 0.05, 0));
      g.hard(bcyl(twin ? 0.09 : 0.115, 0.6, 16), chrome, T(ox, 0.58, 0));
      g.small(bcyl(twin ? 0.15 : 0.2, 0.12, 16), metalGun, T(ox, 0.82, 0));
      g.small(sphere(twin ? 0.12 : 0.16, 12, 8), metalGun, T(ox, 0.26, 0));
      // Torque links (scissor) on the front.
      g.small(rbox(0.06, 0.34, 0.08, 0.015), metalGun, T(ox, 0.68, -0.18, -0.5, 0, 0));
      g.small(rbox(0.06, 0.34, 0.08, 0.015), metalGun, T(ox, 0.42, -0.18, 0.5, 0, 0));
      // Hydraulic line.
      g.small(tube([new Vector3(ox + 0.16, topY, 0.08), new Vector3(ox + 0.19, 1.0, 0.1), new Vector3(ox + 0.14, 0.5, 0.12), new Vector3(ox + 0.1, 0.32, 0.1)], 0.018, 16, 4), rubber);
    }
    if (twin) {
      g.hard(rbox(1.25, 0.14, 0.78, 0.05, 2), metalGun, T(0, 0.09, 0));
      g.hard(rbox(0.9, 0.12, 0.4, 0.04), metalGun, T(0, 0.24, 0));
    } else {
      g.hard(lathe([[0, 0], [0.64, 0], [0.64, 0.08], [0.58, 0.14], [0.28, 0.24], [0.2, 0.3], [0, 0.3]], 24), metalGun, T(0, 0, 0));
      g.small(bcyl(0.66, 0.02, 24), rubber, T(0, 0.01, 0));
    }
    return g;
  };
  for (const side of [-1, 1]) {
    const gx = side * WREN.nacelleX;
    const g = gear(gx, WREN.mainGearZ, WREN.nacelleY - 0.95, false);
    // Side and drag braces into the nacelle belly.
    kit.hard.add(strut(new Vector3(-side * 0.75, 1.92, 0), new Vector3(0, 0.92, 0), 0.07, 8), metalGun, g.m);
    kit.hard.add(strut(new Vector3(0, 1.75, -1.2), new Vector3(0, 0.98, 0), 0.07, 8), metalGun, g.m);
    // Gear bay doors hanging open.
    for (const d of [-1, 1]) g.hard(rbox(0.05, 0.6, 1.5, 0.02), hullGun, T(d * 0.5, 1.55, -0.2, 0, 0, d * 0.35));
  }
  {
    // Leg tops run 15 cm up into the belly (the hull bottom is ~1.4 m up here).
    const g = gear(0, WREN.noseGearZ, bottomAt(FUSE, WREN.noseGearZ, 0.34) + 0.12, true);
    kit.hard.add(strut(new Vector3(0, bottomAt(FUSE, WREN.noseGearZ - 0.9, 0) + 0.1, -0.9), new Vector3(0, 0.85, 0), 0.06, 8), metalGun, g.m);
    for (const d of [-1, 1]) {
      const hinge = bottomAt(FUSE, WREN.noseGearZ - 0.3, 0.62) + 0.04;
      g.hard(rbox(0.04, 0.55, 1.2, 0.02), hullGun, T(d * 0.62, hinge - 0.27 * Math.cos(0.25), -0.3, 0, 0, d * 0.25));
    }
  }

  // ---- belly lift thrusters (faint glow) and chin sensor --------------------------------------
  for (const side of [-1, 1]) {
    const z = -5.2;
    const x = side * 1.15;
    const y = bottomAt(FUSE, z, x);
    asm.hard(lathe([[0, -0.05], [0.28, -0.05], [0.3, -0.24], [0.36, -0.22], [0.4, -0.1], [0.42, 0.0], [0, 0]], 20), { color: '#34302d', metal: 0.85, rough: 0.35, panel: 0.2 }, T(x, y + 0.02, z));
    asm.small(bcyl(0.27, 0.02, 16), { color: '#ff6a25', rough: 0.6, panel: 0, glow: 0.9 }, T(x, y - 0.14, z));
  }
  asm.hard(sphere(0.34, 18, 12), { color: '#1c2026', metal: 0.3, rough: 0.12, panel: 0 }, T(0, bottomAt(FUSE, -9.2, 0) + 0.05, -9.2));
  asm.small(cyl(0.36, 0.36, 0.12, 18), metalGun, T(0, bottomAt(FUSE, -9.2, 0) + 0.25, -9.2));

  // ---- greebles: access panels, RCS quads, handles, vents ------------------------------------
  {
    const panels: [number, number, number, number][] = [
      // z, angle (deg), w, h
      [-5.9, 36, 1.0, 0.55],
      [0.9, 22, 0.8, 0.8],
      [2.6, 34, 1.4, 0.5],
      [-5.9, 144, 1.0, 0.55],
      [0.9, 158, 0.8, 0.8],
      [2.6, 146, 1.4, 0.5],
      [-6.0, 70, 0.7, 0.5],
      [2.8, 105, 1.0, 0.7],
      [-2.6, -12, 0.9, 0.45],
      [-2.6, 192, 0.9, 0.45],
      [3.3, -8, 0.7, 0.5],
    ];
    for (const [z, deg, w, h] of panels) {
      const m = onHull(FUSE, z, (deg * Math.PI) / 180, 0.012);
      kit.small.add(rbox(w, h, 0.04, 0.015), { color: deg > 90 && deg < 270 ? WHITE2 : '#c3bfb4', metal: 0.1, rough: 0.48, panel: 0.9 }, W(m));
    }
    // RCS thruster quads at nose and tail.
    for (const [z, deg] of [
      [-8.6, 12],
      [-8.6, 168],
      [7.6, 18],
      [7.6, 162],
    ] as [number, number][]) {
      const m = W(onHull(FUSE, z, (deg * Math.PI) / 180, 0.05));
      kit.small.add(rbox(0.42, 0.3, 0.16, 0.04), metalGun, m);
      for (const [ox, oy] of [
        [-0.1, 0.06],
        [0.1, 0.06],
        [0, -0.07],
      ])
        kit.small.add(cyl(0.035, 0.05, 0.08, 8), { color: '#1a1a1a', metal: 0.8, rough: 0.4, panel: 0 }, m.clone().multiply(T(ox, oy, 0.1, Math.PI / 2, 0, 0)));
    }
    // Grab handles beside the cockpit.
    for (const deg of [14, 166]) {
      const m = W(onHull(FUSE, -6.0, (deg * Math.PI) / 180, 0.06));
      kit.small.add(rbox(0.6, 0.04, 0.04, 0.015), { color: YEL, rough: 0.5, panel: 0.3 }, m);
    }
    // Side vents behind the cockpit.
    for (const deg of [8, 172]) {
      for (let k = 0; k < 7; k++) {
        const m = W(onHull(FUSE, -0.4 + k * 0.14, (deg * Math.PI) / 180, 0.02));
        kit.small.add(rbox(0.06, 0.55, 0.05, 0.012), { color: '#1d1f22', metal: 0.6, rough: 0.5, panel: 0 }, m);
      }
    }
    // Ground-power socket on the port flank, where the pad's umbilical plugs in.
    asm.small(rbox(0.16, 0.36, 0.36, 0.03), metalGun, T(WREN_UMBILICAL.x - 0.06, WREN_UMBILICAL.y, WREN_UMBILICAL.z));
    asm.small(rbox(0.06, 0.1, 0.24, 0.015), { color: YEL, rough: 0.5, panel: 0.3 }, T(WREN_UMBILICAL.x - 0.13, WREN_UMBILICAL.y + 0.22, WREN_UMBILICAL.z));
    // Belly blade antenna and a belly beacon.
    asm.small(rbox(0.04, 0.4, 0.5, 0.015), metalGun, T(0, bottomAt(FUSE, -2.5, 0) - 0.18, -2.5));
    asm.small(cyl(0.08, 0.1, 0.12, 12), { color: '#ff2a1a', rough: 0.2, panel: 0, glow: 1.5 }, T(0, bottomAt(FUSE, 0.5, 0) - 0.05, 0.5));
    glows.add(asm.pt(0, bottomAt(FUSE, 0.5, 0) - 0.14, 0.5), '#ff2a1a', 12, 0.6, GlowMode.Beacon, 1.25, 2);
  }

  // ---- registration and markings --------------------------------------------------------------
  for (const side of [-1, 1]) {
    const deg = side > 0 ? 24 : 156;
    const a = (deg * Math.PI) / 180;
    // "WREN" along the forward fuselage, following the hull curvature.
    hullDecal(kit.decal, M, atlas, 'WREN', -2.9, a, 3.0, side, '#2b2e33');
    hullDecal(kit.decal, M, atlas, 'RESCUE', -7.4, side > 0 ? 0.32 : Math.PI - 0.32, 0.9, side, '#b8401c');
    hullDecal(kit.decal, M, atlas, 'K7', 1.9, side > 0 ? 0.62 : Math.PI - 0.62, 0.9, side, '#2b2e33');
  }

  // ---- open rear ramp -----------------------------------------------------------------------
  const floorY = WREN.floorY;
  const run = RAMP_LIP_Z - hingeZ;
  const slope = Math.atan2(floorY, run);
  const rampLen = WREN.rampLength;
  {
    const rm = W(T(0, floorY, hingeZ, slope, 0, 0)); // +Z runs down the ramp
    const r = new Asm(kit, rm);
    const rw = WREN.rampWidth;
    r.hard(rbox(rw, 0.16, rampLen, 0.05, 2), hullGun, T(0, -0.1, rampLen / 2));
    // Inner deck plating and anti-slip treads.
    r.small(rbox(rw - 0.3, 0.03, rampLen - 0.3, 0.01), { color: '#45474a', metal: 0.6, rough: 0.55, panel: 0.6 }, T(0, 0, rampLen / 2));
    for (let k = 0; k < 16; k++) r.small(rbox(rw - 0.5, 0.035, 0.06, 0.012), { color: '#5a5c5e', metal: 0.7, rough: 0.45, panel: 0 }, T(0, 0.025, 0.25 + k * 0.3));
    // Side rails with hazard stripes.
    for (const s of [-1, 1]) {
      r.hard(rbox(0.12, 0.26, rampLen, 0.03), { color: YEL, rough: 0.5, panel: 0.5 }, T(s * (rw / 2 - 0.06), 0.02, rampLen / 2));
      addDecal(kit, atlas, 'HAZARD', rampLen * 0.94, '#141414', rm.clone().multiply(T(s * (rw / 2 + 0.002), 0.02, rampLen / 2, 0, s * Math.PI / 2, 0)).multiply(new Matrix4().makeScale(1, 0.26 / (rampLen * 0.94 / 8), 1)));
    }
    // Toe plate resting on the pad.
    kit.hard.add(rbox(rw - 0.1, 0.04, 0.42, 0.015), { color: '#4a4c4e', metal: 0.7, rough: 0.45, panel: 0.3 }, W(T(0, 0.02, RAMP_LIP_Z + 0.08)));
    // Hydraulic rams from the bay sides down to the ramp.
    for (const s of [-1, 1]) {
      const a = new Vector3(s * 1.42, 2.5, hingeZ + 0.5).applyMatrix4(M);
      const b = new Vector3(s * 1.42, 0.12, rampLen * 0.45).applyMatrix4(rm);
      const mid = a.clone().lerp(b, 0.55);
      kit.hard.add(strut(a, mid, 0.075, 10), metalGun);
      kit.small.add(strut(mid, b, 0.045, 10), chrome);
    }
  }

  // ---- cargo opening frame ---------------------------------------------------------------------
  {
    const frame = { color: GUN, metal: 0.6, rough: 0.4, panel: 0.6 };
    for (const s of [-1, 1]) {
      const pts: Vector3[] = [];
      for (let z = hingeZ; z <= 9.7; z += 0.35) pts.push(new Vector3(s * 1.62, bottomAt(FUSE, z, 1.62) + 0.02, z).applyMatrix4(M));
      kit.hard.add(tube(pts, 0.11, 30, 6), frame);
    }
    kit.hard.add(rbox(3.5, 0.2, 0.3, 0.05), frame, W(T(0, floorY - 0.05, hingeZ)));
    // Rear arch: across the tail underside where the opening ends.
    kit.hard.add(rbox(3.3, 0.26, 0.3, 0.06), frame, W(T(0, bottomAt(FUSE, 9.6, 0) + 0.08, 9.62)));
    // Work lights over the opening (warm).
    for (const s of [-1, 1]) {
      kit.small.add(rbox(0.5, 0.08, 0.16, 0.02), { color: '#ffd9a8', rough: 0.3, panel: 0, glow: 4 }, W(T(s * 1.1, bottomAt(FUSE, 9.4, 1.1) + 0.12, 9.35)));
      glows.add(new Vector3(s * 1.1, bottomAt(FUSE, 9.4, 1.1), 9.35).applyMatrix4(M), '#ffd9a8', 2.5, 0.5, GlowMode.Steady, 0, 1.5, new Vector3(0, -1, 0.3).transformDirection(M));
    }
  }

  // ---- cargo bay interior ---------------------------------------------------------------------
  {
    const inner = { color: INTERIOR, metal: 0.45, rough: 0.55, panel: 0.8 };
    const z0 = -2.2;
    const z1 = 9.6;
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    // Floor up to the hinge.
    asm.hard(rbox(3.4, 0.12, hingeZ - z0, 0.03), { color: '#3d3f41', metal: 0.6, rough: 0.5, panel: 1 }, T(0, floorY - 0.06, (z0 + hingeZ) / 2));
    for (let k = 0; k < 6; k++) asm.small(rbox(0.06, 0.02, hingeZ - z0 - 0.3, 0.01), { color: '#55585b', metal: 0.8, rough: 0.4, panel: 0 }, T(-1.25 + k * 0.5, floorY + 0.01, (z0 + hingeZ) / 2));
    // Walls: trapezoids whose lower edge follows the opening.
    for (const s of [-1, 1]) {
      const outline: [number, number][] = [
        [z0, floorY],
        [hingeZ, floorY],
        [9.6, bottomAt(FUSE, 9.6, 1.6) + 0.1],
        [9.6, 3.95],
        [z0, 3.95],
      ];
      const wall = extrude(outline, 0.08, 0.02, 1);
      wall.rotateY(-Math.PI / 2);
      asm.hard(wall, inner, T(s * 1.72, 0, 0));
      // Ribs every 0.9 m and a run of fold-down seats.
      for (let z = z0 + 0.4; z < 9.4; z += 0.9) {
        const yb = Math.max(floorY, z > hingeZ ? bottomAt(FUSE, z, 1.6) + 0.12 : floorY);
        asm.small(rbox(0.14, 3.95 - yb, 0.12, 0.03), { color: '#2e3134', metal: 0.6, rough: 0.5, panel: 0.4 }, T(s * 1.63, (3.95 + yb) / 2, z));
      }
      for (let k = 0; k < 5; k++) asm.small(rbox(0.42, 0.06, 0.48, 0.02), { color: '#5c4a30', rough: 0.8, panel: 0 }, T(s * 1.45, floorY + 0.46, -1.6 + k * 0.62));
      asm.small(rbox(0.04, 0.5, 2.8, 0.01), { color: '#5c4a30', rough: 0.8, panel: 0 }, T(s * 1.66, floorY + 0.85, -0.4));
    }
    // Ceiling with ribs and strip lights.
    asm.hard(rbox(3.5, 0.08, len, 0.02), inner, T(0, 3.98, zc));
    for (let z = z0 + 0.4; z < 9.5; z += 0.9) asm.small(rbox(3.3, 0.12, 0.12, 0.03), { color: '#2e3134', metal: 0.6, rough: 0.5, panel: 0.3 }, T(0, 3.88, z));
    for (const s of [-1, 1]) asm.small(rbox(0.12, 0.04, len - 1.6, 0.015), { color: '#ffe2b8', rough: 0.3, panel: 0, glow: 3.2 }, T(s * 0.9, 3.9, zc - 0.2));
    // Forward bulkhead with a door to the flight deck (lit edge).
    asm.hard(rbox(3.5, 2.6, 0.12, 0.03), inner, T(0, floorY + 1.25, z0));
    asm.small(rbox(1.0, 2.0, 0.06, 0.03), { color: '#2a2c2f', metal: 0.6, rough: 0.45, panel: 0.6 }, T(0, floorY + 1.0, z0 + 0.08));
    asm.small(rbox(1.12, 0.04, 0.04, 0.01), { color: '#9fe0ff', rough: 0.3, panel: 0, glow: 3 }, T(0, floorY + 2.04, z0 + 0.1));
    asm.small(rbox(0.25, 0.15, 0.04, 0.01), { color: '#ff3a20', rough: 0.3, panel: 0, glow: 3 }, T(0.8, floorY + 1.6, z0 + 0.1));
    // Strapped cargo.
    asm.hard(rbox(1.2, 0.9, 1.0, 0.04), { color: '#4c5450', rough: 0.6, metal: 0.2 }, T(-0.8, floorY + 0.45, -0.8));
    asm.hard(rbox(1.0, 0.7, 0.8, 0.04), { color: '#6b6248', rough: 0.6, metal: 0.2 }, T(-0.85, floorY + 1.25, -0.8, 0, 0.1, 0));
    asm.hard(rbox(0.8, 0.6, 1.4, 0.04), { color: YEL, rough: 0.55, metal: 0.1 }, T(0.9, floorY + 0.3, 0.6, 0, -0.05, 0));
    for (const z of [-1.2, -0.4]) asm.small(rbox(1.26, 0.04, 0.06, 0.01), { color: '#c46a1a', rough: 0.8, panel: 0 }, T(-0.8, floorY + 0.92, z));
  }

  return {
    bayLight: new Vector3(0, 3.35, 6.6),
  };
}

/** Decal that wraps the hull: a small grid sampled on the surface. */
function hullDecal(b: PartBuilder, M: Matrix4, atlas: DecalAtlas, name: string, zc: number, a: number, width: number, side: number, color: string, stations: Station[] = FUSE): void {
  const r = atlas.rect(name);
  const h = width / r.aspect;
  // Angular height: approximate local radius of curvature from the station.
  const st = { ...stationAt(stations, uAtZ(stations, zc), tmpSt) };
  const rad = Math.max(st.ht, st.w / 2) * 0.95;
  const da = h / rad;
  const nu = 12;
  const nv = 4;
  const geo = paramSurface(
    (u, v, out) => {
      // Starboard reads nose-ward, port reads tail-ward.
      const z = zc + (u - 0.5) * width * (side > 0 ? -1 : 1);
      const ang = a + (v - 0.5) * da * (side > 0 ? 1 : -1);
      hullAt(stations, z, ang, 0.012, out);
    },
    nu,
    nv,
  );
  // uv: u along text, v up.
  const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const k = (i * (nv + 1) + j) * 2;
      uv[k] = r.u0 + (r.u1 - r.u0) * (i / nu);
      uv[k + 1] = r.v0 + (r.v1 - r.v0) * (j / nv);
    }
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  // Normals from the hull (paramSurface may point them either way).
  const nor = geo.attributes.normal;
  const pos = geo.attributes.position;
  for (let i = 0; i < nor.count; i++) {
    const out = new Vector3().fromBufferAttribute(pos, i);
    const n = new Vector3().fromBufferAttribute(nor, i);
    const radial = new Vector3(out.x - (st.x ?? 0), out.y - st.y, 0);
    if (n.dot(radial) < 0) nor.setXYZ(i, -n.x, -n.y, -n.z);
  }
  // Winding: make front faces face outward.
  const n0 = new Vector3().fromBufferAttribute(nor, 0);
  const i0 = geo.index!;
  const a0 = new Vector3().fromBufferAttribute(pos, i0.getX(0));
  const b0 = new Vector3().fromBufferAttribute(pos, i0.getX(1));
  const c0 = new Vector3().fromBufferAttribute(pos, i0.getX(2));
  const fn = new Vector3().crossVectors(b0.sub(a0), c0.sub(a0));
  if (fn.dot(n0) < 0) {
    for (let t = 0; t < i0.count; t += 3) {
      const x = i0.getX(t + 1);
      i0.setX(t + 1, i0.getX(t + 2));
      i0.setX(t + 2, x);
    }
  }
  b.add(geo, { color, rough: 0.6, panel: 0 }, M);
}

/**
 * Flat plate filling a loft's cross-section at z (inset from the skin), facing +Z, or -Z when
 * `front`. Used as bulkheads that seal open loft ends.
 */
function stationDisc(stations: Station[], z: number, inset: number, front: boolean): BufferGeometry {
  const u = uAtZ(stations, z);
  const st = stationAt(stations, u, tmpSt);
  const cx = st.x ?? 0;
  const cy = st.y;
  const p = new Vector3();
  return paramSurface(
    (s, v, out) => {
      hullPoint(stations, u, v, p, inset);
      out.set(cx + (p.x - cx) * s, cy + (p.y - cy) * s, p.z);
    },
    2,
    40,
    { flip: front },
  );
}

/**
 * Shallow dome closing a loft at its first (end 0) or last (end 1) station: from the skin
 * (pushed out by `off`) to a tip `depth` metres beyond (negative = toward -Z).
 */
function endDome(stations: Station[], end: 0 | 1, depth: number, off: number): BufferGeometry {
  const st = stationAt(stations, end, { z: 0, w: 0, ht: 0, hb: 0, y: 0, nt: 2, nb: 2 });
  const rim = new Vector3();
  return paramSurface(
    (u, v, out) => {
      hullAt(stations, st.z, v * Math.PI * 2, off, rim);
      const k = Math.cos((u * Math.PI) / 2);
      out.set((st.x ?? 0) + (rim.x - (st.x ?? 0)) * k, st.y + (rim.y - st.y) * k, st.z + depth * Math.sin((u * Math.PI) / 2));
    },
    5,
    40,
    { flip: end === 1 },
  );
}

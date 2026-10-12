// Placement of every man-made thing in Chapter 1, as plain data (no WebGL), so the builders
// and the colliders come from one source and tests can check them without a GPU.
// World metres, +Y up, -Z north. See src/env/layout.ts for the shared world layout.

import { CatmullRomCurve3, Vector3 } from 'three';
import type { Collider } from '../../game/collision';
import { LANDING_PAD, SPAWN_POINTS } from '../layout';

// ---------------------------------------------------------------------------------------------
// Landing pad
// ---------------------------------------------------------------------------------------------

/** Height of the pad's top surface above the regolith. */
export const PAD_TOP = 0.16;
/** Radius of the flat top; the bevelled skirt runs from here down to the ground. */
export const PAD_TOP_RADIUS = 12.9;
export const PAD_BASE_RADIUS = 13.6;

/** Two-step stair down the pad's west rim (toward the habs): radius and top height of each step. */
export const PAD_STAIR = {
  angle: Math.PI + 0.02,
  steps: [
    { r: PAD_BASE_RADIUS - 0.15, h: PAD_TOP },
    { r: PAD_BASE_RADIUS + 0.27, h: PAD_TOP * 0.5 },
  ],
  halfWidth: 1.2,
  halfDepth: 0.25,
} as const;

/** Vehicle ramp off the north-west rim: from the pad top at r0 down to the ground over `run`. */
export const PAD_RAMP = { angle: Math.atan2(-0.55, -0.83), r0: PAD_TOP_RADIUS - 0.2, run: 2.6, halfWidth: 2.1 } as const;

/**
 * Height of the walkable pad surface at (x, z), or 0 off the pad: the deck, its bevelled rim, the
 * stair and the vehicle ramp. Gameplay adds this to the terrain height so feet stand on the pad
 * (and on the steps) instead of sinking into them.
 */
export function padSurfaceHeight(x: number, z: number): number {
  const dx = x - LANDING_PAD.x;
  const dz = z - LANDING_PAD.z;
  const r = Math.hypot(dx, dz);
  if (r <= PAD_TOP_RADIUS) return PAD_TOP;
  let h = r >= PAD_BASE_RADIUS ? 0 : (PAD_TOP * (PAD_BASE_RADIUS - r)) / (PAD_BASE_RADIUS - PAD_TOP_RADIUS);
  const along = (a: number) => dx * Math.cos(a) + dz * Math.sin(a);
  const across = (a: number) => -dx * Math.sin(a) + dz * Math.cos(a);
  if (Math.abs(across(PAD_STAIR.angle)) <= PAD_STAIR.halfWidth) {
    const ra = along(PAD_STAIR.angle);
    for (const s of PAD_STAIR.steps) if (Math.abs(ra - s.r) <= PAD_STAIR.halfDepth) h = Math.max(h, s.h);
  }
  if (Math.abs(across(PAD_RAMP.angle)) <= PAD_RAMP.halfWidth) {
    const ra = along(PAD_RAMP.angle);
    if (ra >= PAD_RAMP.r0 - 0.2 && ra <= PAD_RAMP.r0 + PAD_RAMP.run) h = Math.max(h, PAD_TOP * (1 - (ra - PAD_RAMP.r0) / PAD_RAMP.run));
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// The dropship Wren. Built in ship space: nose toward -Z, stern (open ramp) toward +Z,
// origin on the pad surface under the hull.
// ---------------------------------------------------------------------------------------------

export const WREN = {
  noseZ: -11,
  tailZ: 10.9,
  /** Cargo floor height (= ramp hinge height) above the pad. */
  floorY: 1.45,
  rampHingeZ: 4.6,
  rampWidth: 3.0,
  /** Length of the ramp plate from hinge to lip. */
  rampLength: 5.1,
  nacelleX: 4.35,
  nacelleY: 2.65,
  nacelleZ0: 0.4,
  nacelleZ1: 10.1,
  nacelleR: 1.08,
  mainGearZ: 4.2,
  noseGearZ: -7.3,
} as const;

/** Horizontal distance from hinge to the lip resting on the pad. */
export const RAMP_RUN = Math.sqrt(WREN.rampLength ** 2 - WREN.floorY ** 2);
export const RAMP_LIP_Z = WREN.rampHingeZ + RAMP_RUN;

/**
 * The Wren's footprint at body height (0.3-1.85 m above the pad), measured from the built
 * geometry (tests/unit/props-colliders.test.ts checks it): half-width of the solid against z
 * in ship space. Fuselage (nose cone to the bay walls), then the lowered ramp.
 */
export const WREN_HULL_FOOTPRINT: ReadonlyArray<readonly [number, number]> = [
  [-11.25, 0.3],
  [-10.85, 0.5],
  [-10.5, 0.8],
  [-10.25, 0.94],
  [-10.0, 1.06],
  [-9.5, 1.32],
  [-9.0, 1.54],
  [-8.5, 1.65],
  [-8.0, 1.74],
  [-7.0, 1.87],
  [-6.0, 1.95],
  [-5.0, 2.01],
  [-4.0, 2.04],
  [-3.0, 2.07],
  [-2.0, 2.09],
  [3.5, 2.1],
  [4.0, 2.0],
  [4.5, 1.94],
  [5.0, 1.81],
  [5.6, 1.79],
  [5.7, 1.53],
  [9.2, 1.53],
];
/** Same for each engine nacelle (centred on x = ±nacelleX): intake lip to nozzle petals. */
export const WREN_NACELLE_FOOTPRINT: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0.3],
  [0.25, 0.46],
  [0.5, 0.66],
  [0.85, 0.72],
  [1.0, 0.73],
  [1.5, 0.78],
  [2.0, 0.81],
  [2.5, 0.83],
  [6.0, 0.8],
  [7.0, 0.73],
  [7.5, 0.69],
  [8.0, 0.62],
  [8.5, 0.54],
  [9.0, 0.44],
  [9.5, 0.33],
  [10.3, 0.33],
  [10.6, 0.12],
];

export interface ShipPlacement {
  x: number;
  z: number;
  /** Pad surface height under the ship. */
  y: number;
  /** Rotation about +Y; ship-space +Z (the ramp) maps to (sin yaw, cos yaw). */
  yaw: number;
}

const spawnMid = {
  x: SPAWN_POINTS.reduce((s, p) => s + p.x, 0) / SPAWN_POINTS.length,
  z: SPAWN_POINTS.reduce((s, p) => s + p.z, 0) / SPAWN_POINTS.length,
};

/**
 * The Wren points its ramp at the spawn points and is pushed back on the pad far enough that
 * its ramp lip and hull stay more than 6 m from them.
 */
function placeShip(): ShipPlacement {
  const dx = spawnMid.x - LANDING_PAD.x;
  const dz = spawnMid.z - LANDING_PAD.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  // (Far enough that the nozzles, now fully inside the colliders, stay 6 m from the spawns.)
  const back = 4.1;
  return { x: LANDING_PAD.x - ux * back, z: LANDING_PAD.z - uz * back, y: PAD_TOP, yaw: Math.atan2(ux, uz) };
}

export const SHIP: ShipPlacement = placeShip();

/** Ship space → world (x, z). */
export function shipToWorld(lx: number, lz: number, ship: ShipPlacement = SHIP): { x: number; z: number } {
  const c = Math.cos(ship.yaw);
  const s = Math.sin(ship.yaw);
  return { x: ship.x + lx * c + lz * s, z: ship.z - lx * s + lz * c };
}

// ---------------------------------------------------------------------------------------------
// Survey Outpost Kestrel-7
// ---------------------------------------------------------------------------------------------

export interface HabSpec {
  name: string;
  x: number;
  z: number;
  /** World axis the hull lies along. */
  axis: 'x' | 'z';
  length: number;
  radius: number;
  /** Airlock: which side (+1/-1 across the axis) and where along the axis (offset from centre). */
  airlock: { side: 1 | -1; along: number };
  /** Window positions along the axis (offsets) on each side; lit ones glow warm. */
  windows: { along: number; side: 1 | -1; lit: boolean }[];
}

/** Hull axis height above ground (skids + legs + radius). */
export const HAB_LIFT = 0.95;

export const HABS: HabSpec[] = [
  {
    name: 'HAB-1',
    x: -13,
    z: 6,
    axis: 'z',
    length: 11,
    radius: 2.3,
    airlock: { side: 1, along: 2.2 },
    windows: [
      { along: -3.4, side: 1, lit: true },
      { along: -1.6, side: 1, lit: false },
      { along: 4.4, side: 1, lit: true },
      { along: -2.5, side: -1, lit: false },
      { along: 2.0, side: -1, lit: true },
    ],
  },
  {
    name: 'LAB-2',
    x: -16.5,
    z: -10.5,
    axis: 'x',
    length: 10,
    radius: 2.3,
    // Airlock on the north flank: the south flank carries the tunnel from HAB-1 (they used to
    // run into each other).
    airlock: { side: -1, along: 2.6 },
    windows: [
      { along: -2.8, side: 1, lit: false },
      { along: -0.8, side: 1, lit: true },
      { along: 0.3, side: -1, lit: false },
      { along: -2.0, side: -1, lit: true },
    ],
  },
  {
    name: 'HAB-3',
    x: -26.5,
    z: 4,
    axis: 'x',
    length: 8,
    radius: 2.1,
    airlock: { side: 1, along: -1.2 },
    windows: [
      { along: 1.4, side: 1, lit: false },
      { along: 0.8, side: -1, lit: false },
    ],
  },
];

export interface TunnelSpec {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
  /** Axis height above ground. */
  y: number;
}

export const TUNNELS: TunnelSpec[] = [
  // HAB-1's north dome to LAB-2's south flank.
  { ax: -13, az: 0.35, bx: -13, bz: -9.25, radius: 1.05, y: 2.45 },
  // HAB-1's west flank to HAB-3's east dome.
  { ax: -14.3, az: 3.6, bx: -23.0, bz: 3.6, radius: 1.05, y: 2.45 },
];

export interface ContainerSpec {
  x: number;
  z: number;
  /** Height of the container's floor (0 or stacked). */
  y: number;
  yaw: number;
  color: string;
  label: string;
}

/** ISO-style cargo container: 6 x 2.4 x 2.6 m (length along local X). */
export const CONTAINER = { length: 6, width: 2.4, height: 2.6 } as const;

export const CONTAINERS: ContainerSpec[] = [
  // A stack: two side by side (rails touching, so there is no slit of daylight between them)
  // and one craned on top across both.
  { x: -7.2, z: 21.6, y: 0, yaw: 0.02, color: '#566466', label: 'KS7-03' },
  { x: -7.0, z: 24.0, y: 0, yaw: 0.02, color: '#8a5634', label: 'KS7-11' },
  { x: -7.4, z: 22.8, y: CONTAINER.height, yaw: 0.07, color: '#b4afa3', label: 'KS7-07' },
  { x: 8.5, z: -24, y: 0, yaw: Math.PI / 2 + 0.05, color: '#3f4756', label: 'KS7-14' },
];

export interface CrateSpec {
  x: number;
  z: number;
  y: number;
  w: number;
  h: number;
  d: number;
  yaw: number;
  kind: 'crate' | 'case' | 'drum';
  color: string;
}

export const CRATES: CrateSpec[] = [
  // by the containers
  { x: -2.6, z: 21.4, y: 0, w: 1.3, h: 0.9, d: 0.95, yaw: 0.1, kind: 'crate', color: '#4c5450' },
  { x: -2.7, z: 21.5, y: 0.9, w: 1.1, h: 0.7, d: 0.8, yaw: -0.18, kind: 'crate', color: '#b2aa95' },
  { x: -2.2, z: 23.1, y: 0, w: 0.8, h: 0.6, d: 0.6, yaw: 0.5, kind: 'case', color: '#d1a21f' },
  { x: -11.4, z: 22.6, y: 0, w: 0, h: 0.95, d: 0, yaw: 0, kind: 'drum', color: '#4a5a6a' },
  { x: -11.3, z: 23.4, y: 0, w: 0, h: 0.95, d: 0, yaw: 0, kind: 'drum', color: '#8a5634' },
  { x: -11.9, z: 23.1, y: 0, w: 0, h: 0.95, d: 0, yaw: 0, kind: 'drum', color: '#4a5a6a' },
  // by the HAB-1 airlock
  { x: -7.4, z: 12.6, y: 0, w: 1.2, h: 0.85, d: 0.9, yaw: 0.3, kind: 'crate', color: '#4c5450' },
  { x: -7.0, z: 13.9, y: 0, w: 0.8, h: 0.55, d: 0.6, yaw: -0.4, kind: 'case', color: '#c9c6bd' },
  // pad-side ground equipment
  { x: 2.9, z: -6.6, y: 0, w: 1.4, h: 1.0, d: 1.0, yaw: 0.6, kind: 'crate', color: '#6b6248' },
  { x: 4.2, z: -7.6, y: 0, w: 0, h: 0.95, d: 0, yaw: 0, kind: 'drum', color: '#a8892e' },
  // fuel farm
  { x: 18.5, z: -18.4, y: 0, w: 1.2, h: 0.9, d: 0.9, yaw: 0.2, kind: 'crate', color: '#4c5450' },
  { x: 19.3, z: -19.6, y: 0, w: 0, h: 0.95, d: 0, yaw: 0, kind: 'drum', color: '#a8892e' },
  // beside LAB-2
  { x: -10.6, z: -15.2, y: 0, w: 1.3, h: 0.9, d: 0.95, yaw: -0.3, kind: 'crate', color: '#566466' },
  { x: -9.4, z: -15.8, y: 0, w: 0.8, h: 0.6, d: 0.6, yaw: 0.9, kind: 'case', color: '#d1a21f' },
];

export interface RoverSpec {
  x: number;
  z: number;
  yaw: number;
}
export const ROVER: RoverSpec = { x: -3.6, z: 10.8, yaw: -0.35 };
export const ROVER_DIMS = { length: 6.2, width: 2.9 } as const;

export const MAST = { x: -21, z: -3, height: 16 } as const;
/** Equipment cabinet beside the mast. */
export const MAST_CABINET = { x: MAST.x - 1.2, z: MAST.z + 2.2 } as const;

export interface FloodSpec {
  x: number;
  z: number;
  height: number;
  /** Where the lamps aim on the ground. */
  aimX: number;
  aimZ: number;
  /** Carries one of the real SpotLights. */
  realLight: boolean;
  /** Index (0-2) of a burnt-out lamp: dark lens, no glow or beam. Every working lamp is steady. */
  deadLamp?: number;
}

export const FLOODLIGHTS: FloodSpec[] = [
  { x: -9.3, z: 14.2, height: 8, aimX: -7.5, aimZ: 7.0, realLight: true },
  { x: 23.5, z: 18.8, height: 8.5, aimX: 13.5, aimZ: 7.5, realLight: true },
  { x: -24, z: -14.5, height: 7.5, aimX: -17, aimZ: -12.5, realLight: false, deadLamp: 2 },
];

/** Solar array: panels along a row facing the Hollow. */
export const SOLAR = { x: -23.5, z: -25, count: 6, spacing: 2.25, panelW: 1.9, panelL: 3.3 } as const;

export interface TankSpec {
  x: number;
  z: number;
  yaw: number;
  length: number;
  radius: number;
  label: string;
}
export const TANKS: TankSpec[] = [
  { x: 24.5, z: -13.5, yaw: 0.0, length: 7, radius: 1.2, label: 'LOX' },
  { x: 24.8, z: -16.9, yaw: 0.03, length: 7, radius: 1.2, label: 'LH2' },
];

export const SIGN = { x: -7.6, z: 15.6, yaw: 0.45 } as const;

/** Ground power pedestal at the pad edge (umbilical to the Wren). */
export const PEDESTAL = { x: 1.8, z: 1.2 } as const;

/** Small ground equipment and clutter. */
export const TROLLEY = { x: 4.6, z: 0.6, yaw: 0.55 } as const;
export const REEL_CART = { x: 5.0, z: -8.6, yaw: -0.3 } as const;
export const TARP = { x: -17.5, z: -16.2, yaw: 0.25 } as const;
/** Marker stakes along the west edge of the north lane, leading the eye to the wreck. */
export function laneStakes(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = -6; z > -36; z -= 6) out.push({ x: NORTH_LANE.minX - 0.8 - 0.12 * (z + 6) * 0.1, z });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Colliders
// ---------------------------------------------------------------------------------------------

function box(minX: number, maxX: number, minZ: number, maxZ: number): Collider {
  return { kind: 'box', minX, maxX, minZ, maxZ };
}
function circle(x: number, z: number, r: number): Collider {
  return { kind: 'circle', x, z, r };
}
/** Axis-aligned box around a (possibly slightly rotated) rectangle; halfL along local X. */
function rotatedRectAabb(x: number, z: number, halfL: number, halfW: number, yaw: number): Collider {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hx = halfL * c + halfW * s;
  const hz = halfL * s + halfW * c;
  return box(x - hx, x + hx, z - hz, z + hz);
}

/** Local (lx, lz) of a frame placed like TY(x, ·, z, yaw) → world (x, z). */
export function localToWorld(x: number, z: number, yaw: number, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

/**
 * Circles covering the rectangle [x0,x1] x [z0,z1] of a rotated frame: the rectangle is cut into
 * cells no bigger than `cell` and each cell gets the circle through its corners. The collision
 * system only has circles and axis-aligned boxes, so this is how rotated props get tight colliders.
 */
function rectCircles(out: Collider[], x: number, z: number, yaw: number, x0: number, x1: number, z0: number, z1: number, cell = 0.8): void {
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell - 1e-6));
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell - 1e-6));
  const dx = (x1 - x0) / nx;
  const dz = (z1 - z0) / nz;
  const r = Math.hypot(dx, dz) / 2;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const p = localToWorld(x, z, yaw, x0 + (i + 0.5) * dx, z0 + (j + 0.5) * dz);
      out.push(circle(p.x, p.z, r));
    }
}

/** Half-width of a footprint profile at z (linear between samples, 0 outside). */
function profileAt(profile: ReadonlyArray<readonly [number, number]>, z: number): number {
  if (z < profile[0][0] || z > profile[profile.length - 1][0]) return 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const [za, wa] = profile[i];
    const [zb, wb] = profile[i + 1];
    if (z >= za && z <= zb) return wa + ((z - za) / Math.max(zb - za, 1e-9)) * (wb - wa);
  }
  return 0;
}

/**
 * Chain of circles along local z (at local x = ax) covering a body whose half-width follows
 * `profile`: each circle covers its slice [zc - h, zc + h] out to the widest point in it.
 */
function profileCircles(out: Collider[], ax: number, profile: ReadonlyArray<readonly [number, number]>, spacing: number): void {
  const z0 = profile[0][0];
  const z1 = profile[profile.length - 1][0];
  const n = Math.max(1, Math.ceil((z1 - z0) / spacing));
  const h = (z1 - z0) / n / 2;
  for (let k = 0; k < n; k++) {
    const zc = z0 + h * (2 * k + 1);
    let r = 0;
    for (let t = -1; t <= 1.0001; t += 0.125) r = Math.max(r, Math.hypot(profileAt(profile, Math.min(z1, Math.max(z0, zc + t * h))), t * h));
    out.push(circle(ax, zc, r));
  }
}

/** Ship-space (x, z, r) circles: fuselage and ramp, the ramp's lip, both nacelles. */
export function wrenCollidersLocal(): [number, number, number][] {
  const out: Collider[] = [];
  // The ramp is solid down to its toe plate; the chain stops short of the lip and two rows of
  // small circles square off the end (one big circle would bulge a metre past the lip).
  const hull = WREN_HULL_FOOTPRINT.filter(([z]) => z <= 7.9);
  profileCircles(out, 0, [...hull, [7.9, 1.53]], 0.55);
  // The last ~1.2 m of ramp (still ankle-to-knee high) in rows of small circles; the final
  // 0.4 m of the lip is low enough to step onto.
  for (const z of [8.25, 8.62, 9.0]) for (const x of [-1.14, -0.38, 0.38, 1.14]) out.push(circle(x, z, 0.45));
  for (const s of [-1, 1]) {
    // Blunt intake: one circle set back from the lip, then the chain.
    out.push(circle(s * WREN.nacelleX, 0.56, 0.68));
    profileCircles(out, s * WREN.nacelleX, WREN_NACELLE_FOOTPRINT.filter(([z]) => z >= 0.85), 0.5);
  }
  return out.map((c) => (c.kind === 'circle' ? [c.x, c.z, c.r] : [0, 0, 0]));
}

/** Where a tunnel enters its habs and what holds it up: computed from the hull shapes. */
export interface TunnelPlan {
  /** Tube end points (buried inside the hulls). */
  a: Vector3;
  b: Vector3;
  /** Where the tube's axis pierces each hull (docking collars go here). */
  skinA: Vector3;
  skinB: Vector3;
  /** Support saddle positions (on the axis) along the exposed span. */
  supports: Vector3[];
}

/**
 * Sinks both ends of a tunnel into the habs it joins: walking from the middle of the span toward
 * each layout end point, `skin` is where the axis pierces the hull, and the tube ends once its
 * whole rim (radius + corrugation) is inside the hull, so the joint is closed from every angle.
 * `groundY` is the ground height under the tunnel.
 */
export function tunnelPlan(t: TunnelSpec, groundY = 0): TunnelPlan {
  const mid = new Vector3((t.ax + t.bx) / 2, groundY + t.y, (t.az + t.bz) / 2);
  const rr = t.radius + 0.06;
  const joint = (ex: number, ez: number) => {
    const end = new Vector3(ex, groundY + t.y, ez);
    const dir = end.clone().sub(mid).normalize();
    const side = new Vector3(-dir.z, 0, dir.x);
    const up = new Vector3().crossVectors(side, dir);
    const inside = (q: Vector3, margin: number) => HABS.some((h) => habInside(h, q.x, q.y - groundY, q.z) > margin);
    const total = mid.distanceTo(end) * 2;
    let skin: Vector3 | null = null;
    const p = new Vector3();
    const q = new Vector3();
    for (let s = 0; s <= total; s += 0.01) {
      p.copy(mid).addScaledVector(dir, s);
      if (!skin && inside(p, 0)) skin = p.clone();
      if (!skin) continue;
      let all = true;
      for (let k = 0; k < 24 && all; k++) {
        const a = (k / 24) * Math.PI * 2;
        q.copy(p).addScaledVector(side, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr);
        all = inside(q, 0.04);
      }
      if (all) return { skin, end: p.clone().addScaledVector(dir, 0.05) };
    }
    throw new Error('props: tunnel does not reach a hab');
  };
  const ja = joint(t.ax, t.az);
  const jb = joint(t.bx, t.bz);
  const span = ja.skin.distanceTo(jb.skin);
  const count = Math.max(1, Math.floor(span / 2.6));
  const supports: Vector3[] = [];
  for (let k = 1; k <= count; k++) supports.push(ja.skin.clone().lerp(jb.skin, k / (count + 1)));
  return { a: ja.end, b: jb.end, skinA: ja.skin, skinB: jb.skin, supports };
}

/** Yaw of the ground power pedestal. */
export const PEDESTAL_YAW = 1.0;

/** Ship-space socket of the ground-power umbilical on the Wren's port flank. */
export const WREN_UMBILICAL = new Vector3(-1.95, 1.95, -1.0);

/**
 * The umbilical cable from the ground power pedestal to the Wren (world space, flat ground): out
 * of the pedestal's top, straight down onto the pad, across it, and up the flank to the socket,
 * so it only rises off the ground right at the two ends.
 */
export function umbilicalPath(): Vector3[] {
  const top = localToWorld(PEDESTAL.x, PEDESTAL.z, PEDESTAL_YAW, 0, 0.3);
  const s = shipToWorld(WREN_UMBILICAL.x, WREN_UMBILICAL.z);
  const socket = new Vector3(s.x, SHIP.y + WREN_UMBILICAL.y, s.z);
  const a = new Vector3(top.x, 1.0, top.z);
  const dir = socket.clone().sub(a).setY(0).normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  const d = Math.hypot(socket.x - a.x, socket.z - a.z);
  const along = (k: number) => a.clone().addScaledVector(dir, k);
  const g = (p: Vector3) => p.setY(0.07 + padSurfaceHeight(p.x, p.z));
  return [
    a,
    along(0.22).setY(0.7),
    g(along(0.55)),
    g(along(d * 0.35).addScaledVector(side, 0.5)),
    g(along(d * 0.7).addScaledVector(side, -0.3)),
    g(along(d - 0.75)),
    along(d - 0.3).setY(socket.y - 0.95),
    socket,
  ];
}

export function computeColliders(): Collider[] {
  const out: Collider[] = [];

  // The Wren: chains of circles in ship space (it stands at an angle on the pad).
  for (const [lx, lz, r] of wrenCollidersLocal()) {
    const p = shipToWorld(lx, lz);
    out.push(circle(p.x, p.z, r));
  }

  // Habitat modules. At body height the hull is narrower than its radius (it sits on legs), and
  // the domed ends taper: one box for the barrel and the start of the domes, one for the tips.
  for (const h of HABS) {
    const R = h.radius;
    const dy = HAB_LIFT + R - 1.85; // hull axis above head height
    const wide = Math.sqrt((R + 0.09) ** 2 - dy * dy) + 0.02;
    const narrow = Math.sqrt(R * R * (1 - 0.62 ** 2) - dy * dy);
    const barrel = h.length / 2 - HAB_DOME;
    for (const [along, across] of [
      [barrel + 0.52 * HAB_DOME, wide],
      [barrel + Math.sqrt(1 - (dy / R) ** 2) * HAB_DOME + 0.04, narrow],
    ]) {
      const a = habToWorld(h, -along, -across);
      const b = habToWorld(h, along, across);
      out.push(box(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z)));
    }
    const lock = airlockFootprint(h);
    out.push(box(lock.minX, lock.maxX, lock.minZ, lock.maxZ));
  }
  // Tunnels (axis-aligned): the tube between the hull skins, the docking collars, and wider
  // boxes at the supports for the splayed legs.
  for (const t of TUNNELS) {
    const plan = tunnelPlan(t);
    const half = (dy: number, r: number) => Math.sqrt(Math.max(r * r - dy * dy, 0));
    const dir = plan.skinB.clone().sub(plan.skinA).normalize();
    const span = (p: Vector3, q: Vector3, w: number) => {
      const alongX = Math.abs(dir.x) > Math.abs(dir.z);
      out.push(
        box(
          Math.min(p.x, q.x) - (alongX ? 0 : w),
          Math.max(p.x, q.x) + (alongX ? 0 : w),
          Math.min(p.z, q.z) - (alongX ? w : 0),
          Math.max(p.z, q.z) + (alongX ? w : 0),
        ),
      );
    };
    span(plan.a, plan.b, half(t.y - 1.85, t.radius + 0.04) + 0.03);
    const collar = half(t.y - 1.85, t.radius + 0.2) + 0.03;
    span(plan.skinA.clone().addScaledVector(dir, 0.27), plan.skinA.clone().addScaledVector(dir, -0.1), collar);
    span(plan.skinB.clone().addScaledVector(dir, -0.27), plan.skinB.clone().addScaledVector(dir, 0.1), collar);
    for (const sp of plan.supports) span(sp.clone().addScaledVector(dir, -0.2), sp.clone().addScaledVector(dir, 0.2), t.radius + 0.36);
  }

  // Cargo containers on the ground (the stacked one is above head height); door hardware sticks
  // out a few cm past the frame.
  for (const c of CONTAINERS) {
    if (c.y > 0) continue;
    out.push(rotatedRectAabb(c.x, c.z, CONTAINER.length / 2 + 0.07, CONTAINER.width / 2 + 0.03, c.yaw));
  }
  // Crates and cases (straps and latches add a few cm), including the one stacked on a crate.
  for (const c of CRATES) {
    if (c.kind === 'drum') {
      out.push(circle(c.x, c.z, 0.34));
      continue;
    }
    if (c.y + c.h < 0.3) continue;
    if (Math.abs(Math.sin(c.yaw)) < 0.2) out.push(rotatedRectAabb(c.x, c.z, c.w / 2 + 0.02, c.d / 2 + 0.05, c.yaw));
    else rectCircles(out, c.x, c.z, c.yaw, -c.w / 2 - 0.02, c.w / 2 + 0.02, -c.d / 2 - 0.05, c.d / 2 + 0.05, 0.5);
  }

  // Rover: chassis, wheels and treads, bumper to the end of the bed.
  rectCircles(out, ROVER.x, ROVER.z, ROVER.yaw, -1.6, 1.6, -3.27, 3.02, 0.8);

  // Comms mast: square footing, equipment cabinet, and where each guy wire passes body height.
  out.push(box(MAST.x - 1.22, MAST.x + 1.22, MAST.z - 1.22, MAST.z + 1.22));
  out.push(circle(MAST_CABINET.x, MAST_CABINET.z, 0.82));
  for (const g of mastGuyAnchors()) out.push(circle(g.x + (MAST.x - g.x) * 0.085, g.z + (MAST.z - g.z) * 0.085, 0.36));
  for (const f of FLOODLIGHTS) out.push(circle(f.x, f.z, 0.45));

  // Fuel tanks: shell and end domes, valve box and wheel at +X, ladder on the south side.
  for (const t of TANKS) {
    // Barrel (plus the fat start of the end domes), then the dome tips.
    const domeD = t.radius * 0.7;
    out.push(rotatedRectAabb(t.x, t.z, t.length / 2 - domeD / 2, t.radius + 0.1, t.yaw));
    out.push(rotatedRectAabb(t.x, t.z, t.length / 2 + 0.06, t.radius * 0.8, t.yaw));
    const ladder = localToWorld(t.x, t.z, t.yaw, -t.length * 0.1, t.radius + 0.17);
    out.push(rotatedRectAabb(ladder.x, ladder.z, 0.27, 0.11, t.yaw));
    const valves = localToWorld(t.x, t.z, t.yaw, t.length / 2 + 0.3, 0.3);
    out.push(rotatedRectAabb(valves.x, valves.z, 0.36, 0.4, t.yaw));
  }

  // Solar array: each standing panel's lower half hangs at body height (two circles), the fallen
  // panel's raised end, and the inverter box at the end of the row.
  for (const p of solarPanels()) {
    if (p.fallen) {
      // The panel rests on its stump at one end: only that raised end is at body height.
      const c = localToWorld(p.x, p.z, SOLAR_YAW, 0.4, 1.3);
      rectCircles(out, c.x, c.z, SOLAR_YAW + 0.237, -1.02, 1.02, -1.74, 0.55, 0.8);
      out.push(circle(p.x, p.z, 0.2));
      continue;
    }
    for (const lx of [-0.5, 0.5]) {
      const q = localToWorld(p.x, p.z, SOLAR_YAW, lx, 0.33);
      out.push(circle(q.x, q.z, 0.83));
    }
  }
  const inv = solarInverter();
  rectCircles(out, inv.x, inv.z, inv.yaw, -0.52, 0.52, -0.32, 0.32, 0.6);

  // Sign: two posts and the board between them (its lower edge is at head height).
  rectCircles(out, SIGN.x, SIGN.z, SIGN.yaw, -2.2, 2.2, -0.08, 0.14, 0.3);
  // Ground power pedestal (cabinet + cable drum) and the umbilical where it is off the ground.
  rectCircles(out, PEDESTAL.x, PEDESTAL.z, PEDESTAL_YAW, -0.4, 0.4, -0.57, 0.3, 0.45);
  const cable = new CatmullRomCurve3(umbilicalPath(), false, 'centripetal');
  for (let k = 0; k <= 80; k++) {
    const q = cable.getPoint(k / 80);
    if (q.y > 0.3 + 0.07) out.push(circle(q.x, q.z, 0.12));
  }
  // Cargo trolley (bed 1.4 x 2.5 with bumpers), hose reel cart, tarp-covered pile, lane stakes.
  rectCircles(out, TROLLEY.x, TROLLEY.z, TROLLEY.yaw, -0.77, 0.77, -1.33, 1.33, 0.8);
  const tow = localToWorld(TROLLEY.x, TROLLEY.z, TROLLEY.yaw, 0, -1.5);
  out.push(circle(tow.x, tow.z, 0.2));
  rectCircles(out, REEL_CART.x, REEL_CART.z, REEL_CART.yaw, -0.76, 0.76, -0.6, 0.95, 0.8);
  for (const lx of [-0.6, 0.6]) {
    const q = localToWorld(TARP.x, TARP.z, TARP.yaw, lx, 0);
    out.push(circle(q.x, q.z, 1.32));
  }
  for (const p of laneStakes()) out.push(circle(p.x, p.z, 0.06));
  return out;
}

/** Azimuth the solar panels face (toward the Hollow). */
export const SOLAR_YAW = Math.atan2(-0.87, -0.49);

/** Inverter box at the end of the solar row. */
export function solarInverter(): { x: number; z: number; yaw: number } {
  const ends = solarPanels();
  const e = ends[ends.length - 1];
  return { x: e.x + 1.6, z: e.z - 1.2, yaw: SOLAR_YAW + Math.PI };
}

/** Ground anchors of the comms mast's three guy wires. */
export function mastGuyAnchors(): { x: number; z: number }[] {
  return [0, 1, 2].map((i) => {
    const ang = (i / 3) * Math.PI * 2 + 0.9;
    return { x: MAST.x + Math.cos(ang) * 5.2, z: MAST.z + Math.sin(ang) * 5.2 };
  });
}

/**
 * A hab's local frame on the ground: local +X runs along the hull axis, local +Z toward the
 * airlock side (side = +1). For hulls lying along world Z, local +X points to world -Z so the
 * frame stays right-handed.
 */
export function habFrame(h: HabSpec): { ex: [number, number]; ez: [number, number]; yaw: number } {
  return h.axis === 'x' ? { ex: [1, 0], ez: [0, 1], yaw: 0 } : { ex: [0, -1], ez: [1, 0], yaw: Math.PI / 2 };
}

/** Hab-local (along axis, across) -> world (x, z). */
export function habToWorld(h: HabSpec, along: number, across: number): { x: number; z: number } {
  const f = habFrame(h);
  return { x: h.x + f.ex[0] * along + f.ez[0] * across, z: h.z + f.ex[1] * along + f.ez[1] * across };
}

/** Depth of a hab hull's domed end caps (the dome is a half-ellipsoid, radius R, depth this). */
export const HAB_DOME = 1.05;

/**
 * Signed "insideness" of a point (world x, height above the hab's ground, world z) in a hab hull:
 * > 0 inside (roughly metres from the skin), < 0 outside. Used to sink tunnels into the hulls.
 */
export function habInside(h: HabSpec, x: number, y: number, z: number): number {
  const f = habFrame(h);
  const dx = x - h.x;
  const dz = z - h.z;
  const along = dx * f.ex[0] + dz * f.ex[1];
  const across = dx * f.ez[0] + dz * f.ez[1];
  const rho = Math.hypot(across, y - (HAB_LIFT + h.radius));
  const cyl = h.length / 2 - HAB_DOME;
  const a = Math.abs(along);
  if (a <= cyl) return Math.min(h.radius - rho, h.length / 2 - a);
  const t = (a - cyl) / HAB_DOME;
  const r = rho / h.radius;
  // Ellipsoid cap: approximate distance by scaling the normalised radius by the smaller axis.
  return (1 - Math.hypot(t, r)) * Math.min(HAB_DOME, h.radius);
}

/** How far the airlock (vestibule, porch, steps) reaches from the hull axis. */
export const AIRLOCK_REACH = 3.6;

/** Footprint of a hab's airlock vestibule plus its steps. */
export function airlockFootprint(h: HabSpec): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const s = h.airlock.side;
  const a = habToWorld(h, h.airlock.along - 1.3, s * (h.radius - 0.4));
  const b = habToWorld(h, h.airlock.along + 1.3, s * (h.radius + AIRLOCK_REACH));
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

export interface SolarPanelSpot {
  x: number;
  z: number;
  fallen: boolean;
  cracked: boolean;
}

/** Panels in a row perpendicular to the sun's azimuth. */
export function solarPanels(): SolarPanelSpot[] {
  // Row direction: perpendicular to the horizontal sun direction (-0.87, -0.49).
  const rx = 0.49;
  const rz = -0.87;
  const out: SolarPanelSpot[] = [];
  for (let i = 0; i < SOLAR.count; i++) {
    const t = (i - (SOLAR.count - 1) / 2) * SOLAR.spacing;
    out.push({ x: SOLAR.x + rx * t, z: SOLAR.z + rz * t, fallen: i === 4, cracked: i === 1 });
  }
  return out;
}

/** The lane north from the outpost toward the wreck, kept free of colliders and tall props. */
export const NORTH_LANE = { minX: -5.4, maxX: 1.2, minZ: -38, maxZ: -1 } as const;

/** Min distance from a point to a collider's surface (negative inside). */
export function distanceToCollider(c: Collider, x: number, z: number): number {
  if (c.kind === 'circle') return Math.hypot(x - c.x, z - c.z) - c.r;
  const dx = Math.max(c.minX - x, 0, x - c.maxX);
  const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
  if (dx === 0 && dz === 0) return -Math.min(x - c.minX, c.maxX - x, z - c.minZ, c.maxZ - z);
  return Math.hypot(dx, dz);
}

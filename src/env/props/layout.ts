// Placement of every man-made thing in Chapter 1, as plain data (no WebGL), so the builders
// and the colliders come from one source and tests can check them without a GPU.
// World metres, +Y up, -Z north. See src/env/layout.ts for the shared world layout.

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

/**
 * Height of the walkable pad surface at (x, z), or 0 off the pad. Gameplay can add this to the
 * terrain height so feet stand on the pad instead of sinking 16 cm into it.
 */
export function padSurfaceHeight(x: number, z: number): number {
  const r = Math.hypot(x - LANDING_PAD.x, z - LANDING_PAD.z);
  if (r <= PAD_TOP_RADIUS) return PAD_TOP;
  if (r >= PAD_BASE_RADIUS) return 0;
  return (PAD_TOP * (PAD_BASE_RADIUS - r)) / (PAD_BASE_RADIUS - PAD_TOP_RADIUS);
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

/** Ship-space collision circles (x, z, r) covering hull, nacelles, gear and the ramp. */
export const WREN_COLLIDERS_LOCAL: ReadonlyArray<readonly [number, number, number]> = [
  // fuselage
  [0, -9.6, 1.4],
  [0, -7.2, 1.9],
  [0, -4.2, 2.1],
  [0, -0.9, 2.15],
  [0, 2.4, 2.1],
  [0, 4.6, 1.9],
  // ramp (solid: players stop at the lip)
  [0, 6.4, 1.6],
  [0, RAMP_LIP_Z - 1.5, 1.5],
  // nacelles and main gear
  ...[-1, 1].flatMap((s) => [
    [s * WREN.nacelleX, 1.6, 1.05] as const,
    [s * WREN.nacelleX, 3.9, 1.1] as const,
    [s * WREN.nacelleX, 6.2, 1.05] as const,
    [s * WREN.nacelleX, 8.5, 1.0] as const,
    [s * 2.9, 3.4, 0.9] as const, // pylon root
  ]),
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
  const back = 3.75;
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
    airlock: { side: 1, along: 2.6 },
    windows: [
      { along: -2.8, side: 1, lit: false },
      { along: -0.8, side: 1, lit: true },
      { along: 1.0, side: -1, lit: false },
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
  { x: -7.2, z: 21.6, y: 0, yaw: 0.02, color: '#566466', label: 'KS7-03' },
  { x: -7.0, z: 24.25, y: 0, yaw: -0.015, color: '#8a5634', label: 'KS7-11' },
  { x: -7.4, z: 22.95, y: CONTAINER.height, yaw: 0.07, color: '#b4afa3', label: 'KS7-07' },
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
  flicker: boolean;
}

export const FLOODLIGHTS: FloodSpec[] = [
  { x: -9.3, z: 14.2, height: 8, aimX: -7.5, aimZ: 7.0, realLight: true, flicker: false },
  { x: 23.5, z: 18.8, height: 8.5, aimX: 13.5, aimZ: 7.5, realLight: true, flicker: false },
  { x: -24, z: -14.5, height: 7.5, aimX: -17, aimZ: -12.5, realLight: false, flicker: true },
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
/** Axis-aligned box around a (possibly slightly rotated) rectangle. */
function rotatedRectAabb(x: number, z: number, halfL: number, halfW: number, yaw: number): Collider {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hx = halfL * c + halfW * s;
  const hz = halfL * s + halfW * c;
  return box(x - hx, x + hx, z - hz, z + hz);
}

export function computeColliders(): Collider[] {
  const out: Collider[] = [];

  // Ship: circles in ship space.
  for (const [lx, lz, r] of WREN_COLLIDERS_LOCAL) {
    const p = shipToWorld(lx, lz);
    out.push(circle(p.x, p.z, r));
  }

  // Habitat modules (hull + skids) and their airlock porches.
  for (const h of HABS) {
    const half = h.length / 2;
    const wide = h.radius + 0.1;
    if (h.axis === 'x') out.push(box(h.x - half, h.x + half, h.z - wide, h.z + wide));
    else out.push(box(h.x - wide, h.x + wide, h.z - half, h.z + half));
    const lock = airlockFootprint(h);
    out.push(box(lock.minX, lock.maxX, lock.minZ, lock.maxZ));
  }
  for (const t of TUNNELS) {
    const r = t.radius + 0.15;
    out.push(box(Math.min(t.ax, t.bx) - r, Math.max(t.ax, t.bx) + r, Math.min(t.az, t.bz) - r, Math.max(t.az, t.bz) + r));
  }

  for (const c of CONTAINERS) {
    if (c.y > 0) continue; // stacked: covered by the ones below
    out.push(rotatedRectAabb(c.x, c.z, CONTAINER.length / 2, CONTAINER.width / 2, c.yaw));
  }
  for (const c of CRATES) {
    if (c.y > 0) continue;
    if (c.kind === 'drum') out.push(circle(c.x, c.z, 0.34));
    else if (c.w * c.d > 0.6) out.push(rotatedRectAabb(c.x, c.z, c.w / 2, c.d / 2, c.yaw));
  }

  // Rover: three circles along its length.
  for (const t of [-1.9, 0, 1.9]) {
    out.push(circle(ROVER.x + Math.sin(ROVER.yaw) * t, ROVER.z + Math.cos(ROVER.yaw) * t, ROVER_DIMS.width / 2));
  }

  out.push(circle(MAST.x, MAST.z, 1.3));
  out.push(circle(MAST_CABINET.x, MAST_CABINET.z, 0.75));
  for (const f of FLOODLIGHTS) out.push(circle(f.x, f.z, 0.45));

  for (const t of TANKS) out.push(rotatedRectAabb(t.x, t.z, t.length / 2 + 0.4, t.radius + 0.25, t.yaw));

  for (const p of solarPanels()) out.push(circle(p.x, p.z, p.fallen ? 1.6 : 0.35));

  // Sign posts.
  for (const s of [-1, 1]) out.push(circle(SIGN.x + Math.cos(SIGN.yaw) * 1.9 * s, SIGN.z - Math.sin(SIGN.yaw) * 1.9 * s, 0.15));
  out.push(circle(PEDESTAL.x, PEDESTAL.z, 0.45));
  out.push(rotatedRectAabb(TROLLEY.x, TROLLEY.z, 1.3, 0.75, TROLLEY.yaw));
  out.push(circle(REEL_CART.x, REEL_CART.z, 0.8));
  out.push(rotatedRectAabb(TARP.x, TARP.z, 1.7, 1.3, TARP.yaw));
  return out;
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

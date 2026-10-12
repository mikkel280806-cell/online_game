// Collision vs. the real geometry. Builds the actual outpost, landing pad and Wren (pure geometry,
// no GPU), takes everything a walking astronaut's body could touch (between step height and head
// height above the walkable ground) and checks the gameplay colliders against it:
//  - every solid point is blocked (no walking through containers, hulls, legs, rails, signs...),
//  - colliders don't put invisible walls far from any geometry,
//  - spawn points and the routes between the places players go stay open.
// PROPS_COLLIDER_MAP=path.ppm writes a top-down map (grey: solid, red: colliders, yellow: misses).
// PROPS_COLLIDERS_JSON=path.json checks another collider list (e.g. the previous one) instead.
import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { SPAWN_POINTS } from '../../src/env/layout';
import { buildPropGeometry } from '../../src/env/props';
import { partAudit } from '../../src/env/props/builder';
import {
  computeColliders,
  CONTAINERS,
  CRATES,
  distanceToCollider,
  FLOODLIGHTS,
  HABS,
  habToWorld,
  MAST,
  MAST_CABINET,
  NORTH_LANE,
  padSurfaceHeight,
  PEDESTAL,
  RAMP_LIP_Z,
  ROVER,
  SIGN,
  shipToWorld,
  solarPanels,
  TANKS,
  TUNNELS,
  AIRLOCK_REACH,
} from '../../src/env/props/layout';
import { createGeometryOnlyAtlas } from '../../src/env/props/textures';
import type { Collider } from '../../src/game/collision';

/** The astronaut steps over anything lower than this (cables, footings, pad steps, toe plates). */
const STEP = 0.3;
/** Top of the helmet. Overhangs above this (pylons, tunnels' undersides) can be walked under. */
const HEAD = 1.85;
/** Player collision radius (src/game/player.ts) and the suit's real half-width (shoulders + arms). */
const PLAYER_R = 0.4;
const BODY_R = 0.32;
/** Solid geometry may poke this far out of a collider before the suit visibly clips into it. */
const TOL = PLAYER_R - BODY_R;
/**
 * A collider may reach this far past the nearest geometry before it feels like a wall of air.
 * "Geometry" here is anything from ankle height to half a metre over the helmet: low clutter and
 * overhangs (a ramp's lip, a nacelle above your head) make a stop look deliberate.
 */
const SLACK = 0.45;
const SUPPORT_LO = 0.1;
const SUPPORT_HI = HEAD + 0.5;

// Top-down grid over the outpost.
const CELL = 0.05;
const X0 = -40;
const Z0 = -40;
const N = Math.round(80 / CELL);

let colliders: Collider[];
/** Solid cells: 0 = free, else 1 + index into `sites`. */
let solid: Int32Array;
/** Cells under any geometry from ankle height to just over the helmet (see SLACK). */
let support: Uint8Array;
const sites: string[] = [];

function mark(x: number, z: number, site: number): void {
  const i = Math.floor((x - X0) / CELL);
  const j = Math.floor((z - Z0) / CELL);
  if (i < 0 || j < 0 || i >= N || j >= N) return;
  if (!solid[j * N + i]) solid[j * N + i] = site + 1;
}

/** Marks every cell under a part of `geo` that lies in the body slab above the walkable ground. */
function rasterise(geo: BufferGeometry, site: number, ox = 0, oy = 0, oz = 0): void {
  const p = geo.attributes.position.array as Float32Array;
  const idx = geo.index!.array;
  const ds = CELL * 0.7;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ymin = Math.min(p[a + 1], p[b + 1], p[c + 1]) + oy;
    const ymax = Math.max(p[a + 1], p[b + 1], p[c + 1]) + oy;
    if (ymax < SUPPORT_LO || ymin > SUPPORT_HI + 0.2) continue;
    const e = Math.max(Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]), Math.hypot(p[b] - p[c], p[b + 1] - p[c + 1], p[b + 2] - p[c + 2]), Math.hypot(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]));
    const n = Math.max(1, Math.ceil(e / ds));
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        const x = p[a] * w + p[b] * u + p[c] * v + ox;
        const y = p[a + 1] * w + p[b + 1] * u + p[c + 1] * v + oy;
        const z = p[a + 2] * w + p[b + 2] * u + p[c + 2] * v + oz;
        const g = padSurfaceHeight(x, z);
        if (y >= g + STEP && y <= g + HEAD) mark(x, z, site);
        if (y >= g + SUPPORT_LO && y <= g + SUPPORT_HI) {
          const ii = Math.floor((x - X0) / CELL);
          const jj = Math.floor((z - Z0) / CELL);
          if (ii >= 0 && jj >= 0 && ii < N && jj < N) support[jj * N + ii] = 1;
        }
      }
  }
}

/** Fills cells enclosed by solid walls (the inside of a closed hull is solid too). */
function fillEnclosed(): void {
  const seen = new Uint8Array(N * N);
  const stack: number[] = [];
  for (let k = 0; k < N; k++) for (const c of [k, (N - 1) * N + k, k * N, k * N + N - 1]) if (!solid[c] && !seen[c]) (seen[c] = 1), stack.push(c);
  while (stack.length) {
    const c = stack.pop()!;
    const i = c % N;
    const j = (c - i) / N;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const cc = jj * N + ii;
      if (!solid[cc] && !seen[cc]) {
        seen[cc] = 1;
        stack.push(cc);
      }
    }
  }
  const inner = sites.push('(enclosed)') - 1;
  for (let c = 0; c < N * N; c++) if (!solid[c] && !seen[c]) solid[c] = inner + 1;
}

const cx = (i: number) => X0 + (i + 0.5) * CELL;
const cz = (j: number) => Z0 + (j + 0.5) * CELL;

function nearestCollider(x: number, z: number): number {
  let d = Infinity;
  for (const c of colliders) d = Math.min(d, distanceToCollider(c, x, z));
  return d;
}

/** Distance (m) from each cell to the nearest supported cell, by a two-pass chamfer transform. */
function distanceToSupport(): Float32Array {
  const d = new Float32Array(N * N).fill(1e9);
  for (let c = 0; c < N * N; c++) if (solid[c] || support[c]) d[c] = 0;
  const a = CELL;
  const b = CELL * Math.SQRT2;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const c = j * N + i;
      if (i > 0) d[c] = Math.min(d[c], d[c - 1] + a);
      if (j > 0) d[c] = Math.min(d[c], d[c - N] + a);
      if (i > 0 && j > 0) d[c] = Math.min(d[c], d[c - N - 1] + b);
      if (i < N - 1 && j > 0) d[c] = Math.min(d[c], d[c - N + 1] + b);
    }
  for (let j = N - 1; j >= 0; j--)
    for (let i = N - 1; i >= 0; i--) {
      const c = j * N + i;
      if (i < N - 1) d[c] = Math.min(d[c], d[c + 1] + a);
      if (j < N - 1) d[c] = Math.min(d[c], d[c + N] + a);
      if (i < N - 1 && j < N - 1) d[c] = Math.min(d[c], d[c + N + 1] + b);
      if (i > 0 && j < N - 1) d[c] = Math.min(d[c], d[c + N - 1] + b);
    }
  return d;
}

/** Can a player (radius PLAYER_R) stand at (x, z)? */
function free(x: number, z: number): boolean {
  return colliders.every((c) => distanceToCollider(c, x, z) >= PLAYER_R);
}

/** Cells (0.25 m) reachable on foot from `from`, flood-filled through free space. */
function reachable(from: { x: number; z: number }): (x: number, z: number) => boolean {
  const S = 0.25;
  const M = Math.round(80 / S);
  const ok = new Uint8Array(M * M);
  const seen = new Uint8Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) ok[j * M + i] = free(X0 + (i + 0.5) * S, Z0 + (j + 0.5) * S) ? 1 : 0;
  const start = Math.floor((from.z - Z0) / S) * M + Math.floor((from.x - X0) / S);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const i = c % M;
    const j = (c - i) / M;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= M || jj >= M) continue;
      const cc = jj * M + ii;
      if (ok[cc] && !seen[cc]) {
        seen[cc] = 1;
        stack.push(cc);
      }
    }
  }
  return (x, z) => !!seen[Math.floor((z - Z0) / S) * M + Math.floor((x - X0) / S)];
}

beforeAll(() => {
  partAudit.enabled = true;
  partAudit.parts = [];
  const built = buildPropGeometry(() => 0, createGeometryOnlyAtlas(), 'high', { wreck: false });
  const parts = partAudit.parts.filter((p) => p.builder !== 'decal' && p.builder !== 'pad');
  partAudit.enabled = false;
  partAudit.parts = [];
  solid = new Int32Array(N * N);
  support = new Uint8Array(N * N);
  const siteIndex = new Map<string, number>();
  for (const part of parts) {
    let s = siteIndex.get(part.site);
    if (s === undefined) siteIndex.set(part.site, (s = sites.push(part.site) - 1));
    // The comms dish is built around its pivot and placed by its mesh.
    const o = part.builder === 'dish' ? built.outpost.dishPivot : { x: 0, y: 0, z: 0 };
    rasterise(part.geo, s, o.x, o.y, o.z);
  }
  fillEnclosed();
  // PROPS_COLLIDERS_JSON=file evaluates another collider set (e.g. an older one) against this geometry.
  colliders = process.env.PROPS_COLLIDERS_JSON ? JSON.parse(readFileSync(process.env.PROPS_COLLIDERS_JSON, "utf8")) : computeColliders();
}, 120_000);

describe('props colliders vs. the built geometry', () => {
  it('blocks every solid surface a walking astronaut could touch', () => {
    const misses = new Map<string, { n: number; worst: number; x: number; z: number }>();
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const s = solid[j * N + i];
        if (!s) continue;
        const d = nearestCollider(cx(i), cz(j));
        if (d <= TOL + CELL * 0.71) continue;
        const site = sites[s - 1];
        const m = misses.get(site);
        if (!m) misses.set(site, { n: 1, worst: d, x: cx(i), z: cz(j) });
        else {
          m.n++;
          if (d > m.worst) Object.assign(m, { worst: d, x: cx(i), z: cz(j) });
        }
      }
    const report = [...misses.entries()]
      .sort((a, b) => b[1].worst - a[1].worst)
      .map(([site, m]) => `${site}: ${(m.n * CELL * CELL).toFixed(2)} m² uncovered, worst ${m.worst.toFixed(2)} m outside a collider at (${m.x.toFixed(2)}, ${m.z.toFixed(2)})`);
    if (report.length) console.log(`solid geometry players could walk into:\n${report.join('\n')}`);
    expect(report).toEqual([]);
  });

  it('puts no invisible walls far from the geometry', () => {
    const dist = distanceToSupport();
    const bad: string[] = [];
    colliders.forEach((c, k) => {
      let worst = 0;
      let at = [0, 0];
      let area = 0;
      const [x0, x1, z0, z1] = c.kind === 'circle' ? [c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r] : [c.minX, c.maxX, c.minZ, c.maxZ];
      for (let j = Math.max(0, Math.floor((z0 - Z0) / CELL)); j <= Math.min(N - 1, Math.floor((z1 - Z0) / CELL)); j++)
        for (let i = Math.max(0, Math.floor((x0 - X0) / CELL)); i <= Math.min(N - 1, Math.floor((x1 - X0) / CELL)); i++) {
          if (distanceToCollider(c, cx(i), cz(j)) > 0) continue;
          const d = dist[j * N + i];
          if (d > SLACK) area += CELL * CELL;
          if (d > worst) {
            worst = d;
            at = [cx(i), cz(j)];
          }
        }
      if (worst > SLACK) bad.push(`collider ${k} (${c.kind} at ${at[0].toFixed(1)}, ${at[1].toFixed(1)}): ${area.toFixed(2)} m² more than ${SLACK} m from any geometry (worst ${worst.toFixed(2)} m)`);
    });
    if (bad.length) console.log(`colliders blocking empty ground:\n${bad.join('\n')}`);
    expect(bad).toEqual([]);
  });

  it('keeps spawn points free and every place players go reachable on foot', () => {
    for (const s of SPAWN_POINTS) expect(free(s.x, s.z)).toBe(true);
    const canReach = reachable(SPAWN_POINTS[0]);
    for (const s of SPAWN_POINTS) expect(canReach(s.x, s.z)).toBe(true);
    // Places worth walking to: each airlock's steps, the container stack, the drums, the fuel
    // farm, the comms mast cabinet, the solar row, every floodlight, the rover, the sign, the
    // ground power pedestal, the Wren's ramp lip and nose, and the far end of the lane north.
    const goals: Record<string, { x: number; z: number }> = {};
    for (const h of HABS) goals[`${h.name} airlock`] = habToWorld(h, h.airlock.along, h.airlock.side * (h.radius + AIRLOCK_REACH + 0.6));
    const stack = CONTAINERS[0];
    goals['container doors'] = { x: stack.x + 3.9, z: CONTAINERS[1].z + 0.6 };
    goals['drums'] = { x: CRATES[3].x, z: CRATES[3].z - 1.2 };
    goals['fuel farm'] = { x: TANKS[0].x - 5, z: TANKS[0].z + 3 };
    goals['mast cabinet'] = { x: MAST_CABINET.x + 1.6, z: MAST_CABINET.z + 0.8 };
    goals['comms mast'] = { x: MAST.x + 2.2, z: MAST.z - 1.5 };
    const panels = solarPanels();
    goals['solar row'] = { x: panels[2].x + 2.4, z: panels[2].z + 1.4 };
    FLOODLIGHTS.forEach((f, k) => (goals[`floodlight ${k}`] = { x: f.x + 1.0, z: f.z + 1.0 }));
    goals['rover'] = { x: ROVER.x + 2.4, z: ROVER.z + 1.5 };
    goals['sign'] = { x: SIGN.x + 1.2, z: SIGN.z + 1.6 };
    goals['pedestal'] = { x: PEDESTAL.x - 1.0, z: PEDESTAL.z + 0.6 };
    const lip = shipToWorld(0, RAMP_LIP_Z + 1.5);
    goals['Wren ramp'] = lip;
    const nose = shipToWorld(0, -13);
    goals['Wren nose'] = nose;
    goals['lane north'] = { x: (NORTH_LANE.minX + NORTH_LANE.maxX) / 2, z: NORTH_LANE.minZ + 1 };
    const t1 = TUNNELS[0];
    goals['under the hab-lab tunnel'] = { x: t1.ax + 2.2, z: (t1.az + t1.bz) / 2 };
    const blocked = Object.entries(goals).filter(([, p]) => !free(p.x, p.z) || !canReach(p.x, p.z)).map(([k, p]) => `${k} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ${free(p.x, p.z) ? 'unreachable' : 'inside a collider'}`);
    if (blocked.length) console.log(`places players cannot get to:\n${blocked.join('\n')}`);
    expect(blocked).toEqual([]);
  });
});

if (process.env.PROPS_COLLIDER_MAP) {
  it('writes the debug map', () => {
    const W = N / 2;
    const img = Buffer.alloc(W * W * 3);
    for (let j = 0; j < W; j++)
      for (let i = 0; i < W; i++) {
        const x = cx(i * 2);
        const z = cz(j * 2);
        const s = solid[j * 2 * N + i * 2];
        const d = nearestCollider(x, z);
        let r = 125;
        let g = 115;
        let b = 104;
        if (d <= 0) [r, g, b] = [200, 70, 60];
        else if (d < PLAYER_R) [r, g, b] = [160, 120, 100];
        if (s) [r, g, b] = d <= TOL + 0.04 ? (d <= 0 ? [70, 30, 30] : [40, 40, 40]) : [255, 230, 0];
        const o = (j * W + i) * 3;
        img[o] = r;
        img[o + 1] = g;
        img[o + 2] = b;
      }
    writeFileSync(process.env.PROPS_COLLIDER_MAP!, Buffer.concat([Buffer.from(`P6\n${W} ${W}\n255\n`), img]));
  }, 120_000);
}

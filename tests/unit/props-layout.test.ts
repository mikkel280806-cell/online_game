import { describe, expect, it } from 'vitest';
import { LANDING_PAD, OUTPOST_FLAT_RADIUS, SPAWN_POINTS } from '../../src/env/layout';
import {
  computeColliders,
  distanceToCollider,
  NORTH_LANE,
  PAD_TOP,
  PAD_TOP_RADIUS,
  padSurfaceHeight,
  RAMP_LIP_Z,
  SHIP,
  shipToWorld,
  WREN,
} from '../../src/env/props/layout';
import { resolve } from '../../src/game/collision';

const colliders = computeColliders();

describe('props layout', () => {
  it('keeps 6 m clear around every spawn point', () => {
    for (const s of SPAWN_POINTS) {
      const nearest = Math.min(...colliders.map((c) => distanceToCollider(c, s.x, s.z)));
      expect(nearest).toBeGreaterThanOrEqual(6);
    }
  });

  it('does not move a player standing on a spawn point', () => {
    const bounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
    for (const s of SPAWN_POINTS) {
      const p = resolve(s.x, s.z, 0.45, colliders, bounds);
      expect(p.x).toBeCloseTo(s.x, 6);
      expect(p.z).toBeCloseTo(s.z, 6);
    }
  });

  it('points the Wren ramp at the spawn points', () => {
    const lip = shipToWorld(0, RAMP_LIP_Z);
    const hinge = shipToWorld(0, WREN.rampHingeZ);
    const mid = { x: (SPAWN_POINTS[0].x + SPAWN_POINTS[1].x) / 2, z: (SPAWN_POINTS[0].z + SPAWN_POINTS[1].z) / 2 };
    const ramp = { x: lip.x - hinge.x, z: lip.z - hinge.z };
    const toSpawn = { x: mid.x - lip.x, z: mid.z - lip.z };
    const cos = (ramp.x * toSpawn.x + ramp.z * toSpawn.z) / (Math.hypot(ramp.x, ramp.z) * Math.hypot(toSpawn.x, toSpawn.z));
    expect(cos).toBeGreaterThan(Math.cos((25 * Math.PI) / 180));
    for (const s of SPAWN_POINTS) expect(Math.hypot(s.x - lip.x, s.z - lip.z)).toBeGreaterThanOrEqual(6);
  });

  it('stands the Wren landing gear on the pad', () => {
    const feet = [shipToWorld(-WREN.nacelleX, WREN.mainGearZ), shipToWorld(WREN.nacelleX, WREN.mainGearZ), shipToWorld(0, WREN.noseGearZ)];
    for (const f of feet) {
      expect(Math.hypot(f.x - LANDING_PAD.x, f.z - LANDING_PAD.z)).toBeLessThan(PAD_TOP_RADIUS - 0.8);
    }
    expect(SHIP.y).toBe(PAD_TOP);
  });

  it('keeps every collider on the flat outpost ground', () => {
    for (const c of colliders) {
      const far = c.kind === 'circle' ? Math.hypot(c.x, c.z) + c.r : Math.max(...[c.minX, c.maxX].flatMap((x) => [c.minZ, c.maxZ].map((z) => Math.hypot(x, z))));
      expect(far).toBeLessThan(OUTPOST_FLAT_RADIUS);
    }
  });

  it('leaves the lane north toward the wreck open', () => {
    let nearest = Infinity;
    for (let x = NORTH_LANE.minX; x <= NORTH_LANE.maxX; x += 0.5) {
      for (let z = NORTH_LANE.minZ; z <= NORTH_LANE.maxZ; z += 0.5) {
        for (const c of colliders) nearest = Math.min(nearest, distanceToCollider(c, x, z));
      }
    }
    expect(nearest).toBeGreaterThan(0);
  });

  it('reports the pad surface height for gameplay', () => {
    expect(padSurfaceHeight(LANDING_PAD.x, LANDING_PAD.z)).toBe(PAD_TOP);
    expect(padSurfaceHeight(LANDING_PAD.x + 30, LANDING_PAD.z)).toBe(0);
    const edge = padSurfaceHeight(LANDING_PAD.x + PAD_TOP_RADIUS + 0.3, LANDING_PAD.z);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(PAD_TOP);
  });
});

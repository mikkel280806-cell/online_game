import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MOUNTAIN_START_RADIUS,
  OUTPOST_FLAT_RADIUS,
  PLAY_RADIUS,
  SPAWN_POINTS,
  TRENCH,
  VISTA_CORRIDOR,
  WRECK,
} from '../../src/env/layout';
import { buildTerrainHeights, type TerrainHeights } from '../../src/env/terrain';
import { NEAR_HALF, NEAR_VERTS, POLAR_RINGS, POLAR_SEG } from '../../src/env/terrain/grid';
import { buildNearGeometry } from '../../src/env/terrain/meshes';
import { scatterBoulders } from '../../src/env/terrain/rocks';
import { mulberry32 } from '../../src/game/random';

let t: TerrainHeights;
beforeAll(() => {
  t = buildTerrainHeights();
});

const ring = (cx: number, cz: number, r: number, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as const;
  });

describe('terrain heightfield', () => {
  it('is deterministic (same seed, separate builds)', () => {
    const other = buildTerrainHeights();
    const rng = mulberry32(99);
    for (let i = 0; i < 2000; i++) {
      const x = (rng() - 0.5) * 6000;
      const z = (rng() - 0.5) * 6000;
      expect(other.grid.heightAt(x, z)).toBe(t.grid.heightAt(x, z));
    }
    expect(other.model.craters).toEqual(t.model.craters);
    expect(other.model.outcrops).toEqual(t.model.outcrops);
  });

  it('is exactly 0 inside the outpost flat radius', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 4000; i++) {
      const r = Math.sqrt(rng()) * OUTPOST_FLAT_RADIUS;
      const a = rng() * Math.PI * 2;
      expect(t.grid.heightAt(Math.cos(a) * r, Math.sin(a) * r)).toBe(0);
    }
    for (const [x, z] of ring(0, 0, OUTPOST_FLAT_RADIUS - 1e-3, 720)) expect(t.grid.heightAt(x, z)).toBe(0);
  });

  it('has walkable slopes around the spawn points', () => {
    const n = new Vector3();
    for (const s of SPAWN_POINTS) {
      expect(t.grid.heightAt(s.x, s.z)).toBe(0);
      for (let r = 2; r <= 40; r += 2) {
        for (const [x, z] of ring(s.x, s.z, r, 48)) {
          t.grid.normalAt(x, z, n);
          // < ~20 degrees everywhere within 40 m of the spawn.
          expect(n.y).toBeGreaterThan(Math.cos((20 * Math.PI) / 180));
        }
      }
    }
  });

  it('digs a crater under the Meridian, lower than its surroundings', () => {
    const centre = t.grid.heightAt(WRECK.x, WRECK.z);
    const around = ring(WRECK.x, WRECK.z, WRECK.craterRadius * 2.2, 64).map(([x, z]) => t.grid.heightAt(x, z));
    const mean = around.reduce((a, b) => a + b, 0) / around.length;
    expect(centre).toBeLessThan(mean - WRECK.craterDepth * 0.7);
  });

  it('makes the small impact craters lower than their rims', () => {
    for (const c of t.model.craters) {
      const rim = ring(c.x, c.z, c.r, 32).map(([x, z]) => t.model.sample(x, z));
      const rimMean = rim.reduce((a, b) => a + b, 0) / rim.length;
      expect(t.model.sample(c.x, c.z)).toBeLessThan(rimMean - c.depth * 0.5);
    }
  });

  it('ploughs a trench lower than its spoil berms', () => {
    const mid = TRENCH.start.clone().lerp(TRENCH.end, 0.7);
    const dir = TRENCH.end.clone().sub(TRENCH.start).normalize();
    const side = new Vector3(-dir.z, 0, dir.x);
    const floor = t.grid.heightAt(mid.x, mid.z);
    const berm = mid.clone().addScaledVector(side, TRENCH.width * 0.65);
    expect(floor).toBeLessThan(t.grid.heightAt(berm.x, berm.z) - TRENCH.depth * 0.6);
  });

  it('keeps the vista corridor low', () => {
    for (let s = 0; s <= 1; s += 0.01) {
      const p = VISTA_CORRIDOR.from.clone().lerp(VISTA_CORRIDOR.to, s);
      expect(t.grid.heightAt(p.x, p.z)).toBeLessThanOrEqual(VISTA_CORRIDOR.maxHeight + 0.01);
    }
  });

  it('rings the play area with hills and raises mountains beyond', () => {
    let ringMax = 0;
    for (const [x, z] of ring(0, 0, 240, 720)) ringMax = Math.max(ringMax, t.grid.heightAt(x, z));
    expect(ringMax).toBeGreaterThan(10);
    expect(ringMax).toBeLessThan(60);
    let mountMax = 0;
    for (let r = MOUNTAIN_START_RADIUS + 600; r < 4000; r += 150) {
      for (const [x, z] of ring(0, 0, r, 180)) mountMax = Math.max(mountMax, t.grid.heightAt(x, z));
    }
    expect(mountMax).toBeGreaterThan(150);
    expect(mountMax).toBeLessThan(900);
  });
});

describe('terrain meshes', () => {
  it('heightAt matches the rendered near-mesh vertices exactly', () => {
    const g = buildNearGeometry(t.grid);
    const pos = g.getAttribute('position');
    expect(pos.count).toBe(NEAR_VERTS * NEAR_VERTS);
    for (let i = 0; i < pos.count; i += 97) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (Math.abs(x) >= NEAR_HALF || Math.abs(z) >= NEAR_HALF) continue;
      expect(t.grid.heightAt(x, z)).toBeCloseTo(pos.getY(i), 4);
    }
  });

  it('heightAt matches the far-field vertices and has no seam at the near-mesh edge', () => {
    const g = t.grid;
    for (let k = 1; k < POLAR_RINGS - 1; k += 5) {
      for (let j = 0; j < POLAR_SEG; j += 11) {
        const x = g.ringR[k] * g.cosT[j];
        const z = g.ringR[k] * g.sinT[j];
        if (Math.max(Math.abs(x), Math.abs(z)) < NEAR_HALF + 1) continue;
        expect(g.heightAt(x, z)).toBeCloseTo(g.polarH[k * POLAR_SEG + j], 3);
      }
    }
    let worst = 0;
    for (let s = -NEAR_HALF; s <= NEAR_HALF; s += 0.37) {
      for (const [x, z, dx, dz] of [
        [NEAR_HALF, s, 1, 0],
        [-NEAR_HALF, s, -1, 0],
        [s, NEAR_HALF, 0, 1],
        [s, -NEAR_HALF, 0, -1],
      ]) {
        worst = Math.max(worst, Math.abs(g.heightAt(x - dx * 0.01, z - dz * 0.01) - g.heightAt(x + dx * 0.01, z + dz * 0.01)));
      }
    }
    expect(worst).toBeLessThan(0.25);
  });
});

describe('boulders', () => {
  it('keep the outpost clear and stay deterministic', () => {
    const a = scatterBoulders(t.model, t.grid, 15);
    const b = scatterBoulders(t.model, t.grid, 15);
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(500);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      const r = Math.hypot(a[i].x, a[i].z);
      expect(r).toBeGreaterThan(OUTPOST_FLAT_RADIUS - 8.01);
      if (r < OUTPOST_FLAT_RADIUS) expect(a[i].size).toBeLessThanOrEqual(0.45);
    }
    // Some big ones inside the play area (they become colliders).
    expect(a.filter((p) => p.size > 0.8 && Math.hypot(p.x, p.z) < PLAY_RADIUS + 20).length).toBeGreaterThan(20);
  });
});

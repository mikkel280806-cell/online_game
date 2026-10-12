import { describe, expect, it } from 'vitest';
import type { Collider } from '../../src/game/collision';
import { findPath, segmentClear } from '../../src/game/pathfinding';

const bounds = { cx: 0, cz: 0, radius: 100 };
const wall: Collider = { kind: 'box', minX: -6, maxX: 6, minZ: 9, maxZ: 10 };

describe('pathfinding', () => {
  it('sees a clear straight line', () => {
    expect(segmentClear({ x: 0, z: 0 }, { x: 10, z: 0 }, 0.4, [wall], bounds)).toBe(true);
    expect(segmentClear({ x: 0, z: 18 }, { x: 0, z: 0 }, 0.4, [wall], bounds)).toBe(false);
  });

  it('routes around a wall and every leg is walkable', () => {
    const start = { x: 0, z: 18 };
    const path = findPath(start, { x: 0, z: 0 }, 0.4, [wall], bounds)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual({ x: 0, z: 0 });
    let from = start;
    for (const p of path) {
      expect(segmentClear(from, p, 0.4, [wall], bounds)).toBe(true);
      from = p;
    }
    expect(path.length).toBeLessThan(5); // string-pulled, not a cell-by-cell staircase
  });

  it('gets as close as it can to an unreachable goal', () => {
    const box: Collider = { kind: 'box', minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
    const path = findPath({ x: 0, z: 10 }, { x: 0, z: 0 }, 0.4, [box], bounds)!;
    const end = path[path.length - 1];
    expect(Math.hypot(end.x, end.z)).toBeLessThan(5);
  });
});

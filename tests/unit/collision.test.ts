import { describe, expect, it } from 'vitest';
import { resolve, type Collider } from '../../src/game/collision';

const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

describe('resolve', () => {
  it('leaves a free position alone', () => {
    expect(resolve(1, 2, 0.4, [], bounds)).toEqual({ x: 1, z: 2 });
  });

  it('keeps the player inside the bounds', () => {
    const p = resolve(50, -50, 0.4, [], bounds);
    expect(p.x).toBeCloseTo(9.6);
    expect(p.z).toBeCloseTo(-9.6);
  });

  it('pushes out of a circle along the line from its centre', () => {
    const c: Collider[] = [{ kind: 'circle', x: 0, z: 0, r: 1 }];
    const p = resolve(0.5, 0, 0.4, c, bounds);
    expect(p.x).toBeCloseTo(1.4);
    expect(p.z).toBeCloseTo(0);
  });

  it('pushes out of a box edge and slides along it', () => {
    const c: Collider[] = [{ kind: 'box', minX: -1, maxX: 1, minZ: -1, maxZ: 1 }];
    const p = resolve(0.3, 1.2, 0.4, c, bounds);
    expect(p.x).toBeCloseTo(0.3);
    expect(p.z).toBeCloseTo(1.4);
  });

  it('ejects from inside a box through the nearest face', () => {
    const c: Collider[] = [{ kind: 'box', minX: -1, maxX: 1, minZ: -1, maxZ: 1 }];
    const p = resolve(0.9, 0, 0.4, c, bounds);
    expect(p.x).toBeCloseTo(1.4);
  });
});

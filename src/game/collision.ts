/** 2D collision on the XZ plane. Everything walkable is flat in M0. */

export interface CircleCollider {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
}

export interface BoxCollider {
  kind: 'box';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type Collider = CircleCollider | BoxCollider;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Push a circle of radius `r` at (x, z) out of every collider and keep it inside `bounds`.
 * Returns the corrected position. Runs a few iterations so corners resolve cleanly.
 */
export function resolve(x: number, z: number, r: number, colliders: Collider[], bounds: Bounds): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    for (const c of colliders) {
      if (c.kind === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        const min = c.r + r;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 1e-6;
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
      } else {
        const cx = Math.max(c.minX, Math.min(x, c.maxX));
        const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
        const dx = x - cx;
        const dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-12) {
            const d = Math.sqrt(d2);
            x = cx + (dx / d) * r;
            z = cz + (dz / d) * r;
          } else {
            // Centre is inside the box: push out along the shallowest axis.
            const left = x - c.minX;
            const right = c.maxX - x;
            const back = z - c.minZ;
            const front = c.maxZ - z;
            const m = Math.min(left, right, back, front);
            if (m === left) x = c.minX - r;
            else if (m === right) x = c.maxX + r;
            else if (m === back) z = c.minZ - r;
            else z = c.maxZ + r;
          }
        }
      }
    }
    x = Math.max(bounds.minX + r, Math.min(x, bounds.maxX - r));
    z = Math.max(bounds.minZ + r, Math.min(z, bounds.maxZ - r));
  }
  return { x, z };
}

import type { Bounds, Collider } from './collision';

export interface Point {
  x: number;
  z: number;
}

/** Does a walker of radius r overlap this collider at (x, z)? */
function blocked(x: number, z: number, r: number, c: Collider): boolean {
  if (c.kind === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const m = c.r + r;
    return dx * dx + dz * dz < m * m;
  }
  const cx = Math.max(c.minX, Math.min(x, c.maxX));
  const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

function inBounds(x: number, z: number, r: number, b: Bounds): boolean {
  if ('radius' in b) return Math.hypot(x - b.cx, z - b.cz) <= b.radius - r;
  return x >= b.minX + r && x <= b.maxX - r && z >= b.minZ + r && z <= b.maxZ - r;
}

export function isFree(p: Point, r: number, colliders: Collider[], bounds: Bounds): boolean {
  return inBounds(p.x, p.z, r, bounds) && !colliders.some((c) => blocked(p.x, p.z, r, c));
}

/** True if a walker of radius r can go straight from a to b (sampled every r/2). */
export function segmentClear(a: Point, b: Point, r: number, colliders: Collider[], bounds: Bounds): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  // Only test colliders near the segment.
  const minX = Math.min(a.x, b.x) - r - 1;
  const maxX = Math.max(a.x, b.x) + r + 1;
  const minZ = Math.min(a.z, b.z) - r - 1;
  const maxZ = Math.max(a.z, b.z) + r + 1;
  const near = colliders.filter((c) =>
    c.kind === 'circle'
      ? c.x + c.r > minX && c.x - c.r < maxX && c.z + c.r > minZ && c.z - c.r < maxZ
      : c.maxX > minX && c.minX < maxX && c.maxZ > minZ && c.minZ < maxZ,
  );
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (!inBounds(x, z, r, bounds)) return false;
    for (const c of near) if (blocked(x, z, r, c)) return false;
  }
  return true;
}

const CELL = 0.75;
const MARGIN = 14;
const MAX_SPAN = 90;

/**
 * A* on a local grid around start and goal, 8-connected, then string-pulled so the
 * walker takes straight lines where it can. Returns waypoints after `start` (ending
 * at `goal`, or at the reachable cell nearest to it), or null if nothing is reachable.
 */
export function findPath(start: Point, goal: Point, r: number, colliders: Collider[], bounds: Bounds): Point[] | null {
  const minX = Math.max(Math.min(start.x, goal.x) - MARGIN, (start.x + goal.x) / 2 - MAX_SPAN / 2);
  const minZ = Math.max(Math.min(start.z, goal.z) - MARGIN, (start.z + goal.z) / 2 - MAX_SPAN / 2);
  const w = Math.min(Math.ceil((Math.max(start.x, goal.x) + MARGIN - minX) / CELL), Math.ceil(MAX_SPAN / CELL));
  const h = Math.min(Math.ceil((Math.max(start.z, goal.z) + MARGIN - minZ) / CELL), Math.ceil(MAX_SPAN / CELL));
  const cx = (i: number) => minX + (i + 0.5) * CELL;
  const cz = (j: number) => minZ + (j + 0.5) * CELL;
  const toCell = (p: Point) => ({
    i: Math.max(0, Math.min(w - 1, Math.floor((p.x - minX) / CELL))),
    j: Math.max(0, Math.min(h - 1, Math.floor((p.z - minZ) / CELL))),
  });

  // Rasterise obstacles.
  const near = colliders.filter((c) =>
    c.kind === 'circle'
      ? c.x + c.r > minX - r && c.x - c.r < minX + w * CELL + r && c.z + c.r > minZ - r && c.z - c.r < minZ + h * CELL + r
      : c.maxX > minX - r && c.minX < minX + w * CELL + r && c.maxZ > minZ - r && c.minZ < minZ + h * CELL + r,
  );
  const solid = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = cx(i);
      const z = cz(j);
      if (!inBounds(x, z, r, bounds) || near.some((c) => blocked(x, z, r + 0.1, c))) solid[j * w + i] = 1;
    }
  }

  const s = toCell(start);
  const g = toCell(goal);
  const startIdx = s.j * w + s.i;
  const goalIdx = g.j * w + g.i;
  solid[startIdx] = 0; // we're standing here, whatever the grid says

  const gScore = new Float32Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heur = (idx: number) => {
    const dx = Math.abs((idx % w) - g.i);
    const dz = Math.abs(Math.floor(idx / w) - g.j);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  };
  // Small binary heap on f-score.
  const heap: [number, number][] = [];
  const push = (f: number, idx: number) => {
    heap.push([f, idx]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0][1];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const rr = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  gScore[startIdx] = 0;
  push(heur(startIdx), startIdx);
  let best = startIdx;
  let bestH = heur(startIdx);
  while (heap.length) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) {
      best = cur;
      break;
    }
    const hc = heur(cur);
    if (hc < bestH) {
      bestH = hc;
      best = cur;
    }
    const ci = cur % w;
    const cj = Math.floor(cur / w);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const n = nj * w + ni;
        if (solid[n] || closed[n]) continue;
        // No cutting corners past obstacles.
        if (di && dj && (solid[cj * w + ni] || solid[nj * w + ci])) continue;
        const cost = gScore[cur] + (di && dj ? 1.414 : 1);
        if (cost < gScore[n]) {
          gScore[n] = cost;
          came[n] = cur;
          push(cost + heur(n), n);
        }
      }
    }
  }
  if (best === startIdx && startIdx !== goalIdx) return null;

  const cells: Point[] = [];
  for (let k = best; k !== -1 && k !== startIdx; k = came[k]) cells.push({ x: cx(k % w), z: cz(Math.floor(k / w)) });
  cells.reverse();
  if (best === goalIdx) cells[cells.length - 1] = { ...goal };

  // String-pulling: skip waypoints we can see past.
  const out: Point[] = [];
  let from: Point = start;
  let k = 0;
  while (k < cells.length) {
    let far = k;
    for (let m = cells.length - 1; m > k; m--) {
      if (segmentClear(from, cells[m], r, colliders, bounds)) {
        far = m;
        break;
      }
    }
    out.push(cells[far]);
    from = cells[far];
    k = far + 1;
  }
  return out;
}

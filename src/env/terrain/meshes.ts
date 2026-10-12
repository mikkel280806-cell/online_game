// Ground meshes built from the precomputed grids (grid.ts). Normals come from central
// differences of the height grids, not from the triangles, so lighting stays smooth.

import { BufferAttribute, BufferGeometry } from 'three';
import { NEAR_CELLS, NEAR_HALF, NEAR_STEP, NEAR_VERTS, POLAR_RINGS, POLAR_SEG, type TerrainGrid } from './grid';

/** The detailed square around the outpost and play area. Diagonal v00-v11 (see grid.nearSurface). */
export function buildNearGeometry(grid: TerrainGrid): BufferGeometry {
  const N = NEAR_VERTS;
  const H = grid.nearH;
  const pos = new Float32Array(N * N * 3);
  const nor = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) {
    const z = -NEAR_HALF + j * NEAR_STEP;
    const jm = Math.max(0, j - 1);
    const jp = Math.min(N - 1, j + 1);
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const im = Math.max(0, i - 1);
      const ip = Math.min(N - 1, i + 1);
      pos[idx * 3] = -NEAR_HALF + i * NEAR_STEP;
      pos[idx * 3 + 1] = H[idx];
      pos[idx * 3 + 2] = z;
      const dx = (H[j * N + ip] - H[j * N + im]) / ((ip - im) * NEAR_STEP);
      const dz = (H[jp * N + i] - H[jm * N + i]) / ((jp - jm) * NEAR_STEP);
      const l = Math.sqrt(dx * dx + 1 + dz * dz);
      nor[idx * 3] = -dx / l;
      nor[idx * 3 + 1] = 1 / l;
      nor[idx * 3 + 2] = -dz / l;
    }
  }
  const index = new Uint32Array(NEAR_CELLS * NEAR_CELLS * 6);
  let o = 0;
  for (let j = 0; j < NEAR_CELLS; j++) {
    for (let i = 0; i < NEAR_CELLS; i++) {
      const v00 = j * N + i;
      const v10 = v00 + 1;
      const v01 = v00 + N;
      const v11 = v01 + 1;
      index[o++] = v00;
      index[o++] = v01;
      index[o++] = v11;
      index[o++] = v00;
      index[o++] = v11;
      index[o++] = v10;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('aTerrain', new BufferAttribute(grid.nearAttr, 4, true));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * The far field out to the horizon, split into angular sectors and radial bands so the camera
 * only draws the chunks it faces (each chunk gets a tight bounding box for culling).
 * Vertices inside the near square are sunk under the near mesh.
 */
export function buildPolarGeometries(grid: TerrainGrid, sectors: number, bandEdges: number[]): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (let s = 0; s < sectors; s++) {
    for (let b = 0; b + 1 < bandEdges.length; b++) {
      const k0 = Math.max(0, Math.floor(Math.log(bandEdges[b] / grid.ringR[0]) / Math.log(grid.ringR[1] / grid.ringR[0])));
      const k1 = Math.min(POLAR_RINGS - 1, Math.ceil(Math.log(bandEdges[b + 1] / grid.ringR[0]) / Math.log(grid.ringR[1] / grid.ringR[0])));
      out.push(buildPolarChunk(grid, s, sectors, k0, k1));
    }
  }
  return out;
}

function buildPolarChunk(grid: TerrainGrid, s: number, sectors: number, kStart: number, kEnd: number): BufferGeometry {
  const per = POLAR_SEG / sectors;
  const R = kEnd - kStart + 1;
  const { ringR, cosT, sinT, polarH, polarRaw, polarAttr } = grid;
  const P = (k: number, j: number) => k * POLAR_SEG + ((j + POLAR_SEG) % POLAR_SEG);
  {
    const cols = per + 1;
    const pos = new Float32Array(cols * R * 3);
    const nor = new Float32Array(cols * R * 3);
    const attr = new Uint8Array(cols * R * 4);
    for (let kk = 0; kk < R; kk++) {
      const k = kStart + kk;
      const r = ringR[k];
      const km = Math.max(0, k - 1);
      const kp = Math.min(POLAR_RINGS - 1, k + 1);
      for (let c = 0; c < cols; c++) {
        const j = (s * per + c) % POLAR_SEG;
        const v = kk * cols + c;
        const x = r * cosT[j];
        const z = r * sinT[j];
        pos[v * 3] = x;
        pos[v * 3 + 1] = polarH[P(k, j)];
        pos[v * 3 + 2] = z;
        // Tangents along the ring (theta) and along the radius, from the unsunk heights.
        const jm = (j + POLAR_SEG - 1) % POLAR_SEG;
        const jp = (j + 1) % POLAR_SEG;
        const tx = r * (cosT[jp] - cosT[jm]);
        const ty = polarRaw[P(k, jp)] - polarRaw[P(k, jm)];
        const tz = r * (sinT[jp] - sinT[jm]);
        const rx = (ringR[kp] - ringR[km]) * cosT[j];
        const ry = polarRaw[P(kp, j)] - polarRaw[P(km, j)];
        const rz = (ringR[kp] - ringR[km]) * sinT[j];
        // n = t x r (points up for counter-clockwise theta)
        let nx = ty * rz - tz * ry;
        let ny = tz * rx - tx * rz;
        let nz = tx * ry - ty * rx;
        const l = Math.hypot(nx, ny, nz) || 1;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        nor[v * 3] = nx / l;
        nor[v * 3 + 1] = ny / l;
        nor[v * 3 + 2] = nz / l;
        const a = P(k, j) * 4;
        attr[v * 4] = polarAttr[a];
        attr[v * 4 + 1] = polarAttr[a + 1];
        attr[v * 4 + 2] = polarAttr[a + 2];
        attr[v * 4 + 3] = polarAttr[a + 3];
      }
    }
    const index = new Uint16Array((R - 1) * per * 6);
    let o = 0;
    for (let k = 0; k < R - 1; k++) {
      for (let c = 0; c < per; c++) {
        const v00 = k * cols + c;
        const v01 = v00 + 1; // next angle
        const v10 = v00 + cols; // next ring
        const v11 = v10 + 1;
        index[o++] = v00;
        index[o++] = v01;
        index[o++] = v11;
        index[o++] = v00;
        index[o++] = v11;
        index[o++] = v10;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nor, 3));
    g.setAttribute('aTerrain', new BufferAttribute(attr, 4, true));
    g.setIndex(new BufferAttribute(index, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

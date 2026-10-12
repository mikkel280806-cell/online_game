// Geometry health of the props, built for real (pure geometry, no GPU):
//  - every solid part is watertight, so no camera angle can look into or through it
//    (open ends, slits between panels, missing faces...); deliberate open surfaces are declared,
//  - closed parts face outward (an inside-out part is invisible from outside and shows its back),
//  - outpost lights are steady (only the dead ship's emergency lights may shimmer),
//  - the triangle budget holds.
import { beforeAll, describe, expect, it } from 'vitest';
import { BufferAttribute, Vector3 } from 'three';
import { buildPropGeometry, type PropGeometry } from '../../src/env/props';
import { partAudit, type AuditedPart } from '../../src/env/props/builder';
import { GlowMode } from '../../src/env/props/fx';
import { FLOODLIGHTS } from '../../src/env/props/layout';
import { createGeometryOnlyAtlas } from '../../src/env/props/textures';

let built: PropGeometry;
let parts: AuditedPart[];

beforeAll(() => {
  partAudit.enabled = true;
  partAudit.parts = [];
  built = buildPropGeometry(() => 0, createGeometryOnlyAtlas(), 'high', { wreck: true });
  parts = partAudit.parts;
  partAudit.enabled = false;
  partAudit.parts = [];
}, 120_000);

/** Open (boundary) edges after welding coincident vertices, and the signed volume. */
function topology(part: AuditedPart): { open: number; volume: number } {
  const pos = part.geo.attributes.position;
  const idx = part.geo.index!;
  const ids = new Map<string, number>();
  const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    vid[i] = id;
  }
  const edges = new Map<number, number>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const o = new Vector3();
  part.geo.computeBoundingBox();
  part.geo.boundingBox!.getCenter(o);
  let volume = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const [i0, i1, i2] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    a.fromBufferAttribute(pos as BufferAttribute, i0).sub(o);
    b.fromBufferAttribute(pos as BufferAttribute, i1).sub(o);
    c.fromBufferAttribute(pos as BufferAttribute, i2).sub(o);
    volume += a.dot(b.clone().cross(c)) / 6;
    const v = [vid[i0], vid[i1], vid[i2]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let e = 0; e < 3; e++) {
      const p = v[e];
      const q = v[(e + 1) % 3];
      const key = p < q ? p * 4194304 + q : q * 4194304 + p;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n === 1) open++;
  return { open, volume };
}

const solidParts = () => parts.filter((p) => p.builder !== 'decal' && !p.open && !/wreck\.ts/.test(p.site));

describe('props geometry', () => {
  it('builds every solid part watertight (nothing to see into or through)', () => {
    const leaks = new Map<string, number>();
    for (const p of solidParts()) {
      const { open } = topology(p);
      if (open) leaks.set(p.site, (leaks.get(p.site) ?? 0) + open);
    }
    const report = [...leaks.entries()].map(([site, n]) => `${site}: ${n} open edges`);
    expect(report).toEqual([]);
  });

  it('has every closed part facing outward', () => {
    const inside = new Set<string>();
    for (const p of solidParts()) {
      const { open, volume } = topology(p);
      if (!open && volume < -1e-7) inside.add(p.site);
    }
    expect([...inside]).toEqual([]);
  });

  it('keeps outpost and ship lights steady; only the wreck may shimmer', () => {
    const pts = built.glows.build()!;
    const pos = pts.geometry.attributes.position;
    const par = pts.geometry.attributes.aParams;
    let floodGlows = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const mode = Math.round(par.getY(i));
      const nearOutpost = Math.hypot(x, z) < 150;
      if (nearOutpost) expect(mode, `light at (${x.toFixed(1)}, ${z.toFixed(1)})`).not.toBe(GlowMode.Failing);
      if (FLOODLIGHTS.some((f) => Math.hypot(x - f.x, z - f.z) < 2.5 && pos.getY(i) > f.height - 1)) {
        floodGlows++;
        expect(mode).toBe(GlowMode.Steady);
      }
    }
    // Three lamps per floodlight, one of them burnt out (dark, no glow).
    expect(floodGlows).toBe(FLOODLIGHTS.length * 3 - FLOODLIGHTS.filter((f) => f.deadLamp !== undefined).length);
  });

  it('stays within the triangle budget', () => {
    let triangles = 0;
    for (const p of parts) triangles += p.geo.index!.count / 3;
    console.info(`[props] ${Math.round(triangles / 1000)}k triangles in ${parts.length} parts`);
    expect(triangles).toBeLessThan(600_000);
  });
});

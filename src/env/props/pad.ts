// Landing pad 07: a weathered, slightly raised plated slab with bevelled skirt, painted
// markings, scorch, embedded edge lights, an access ramp and steps, and dust drifted on its rim.

import { Vector3 } from 'three';
import { LANDING_PAD } from '../layout';
import { Asm, PartBuilder, T, TY, type Kit } from './builder';
import { GlowMode, type GlowSet } from './fx';
import { PAD_BASE_RADIUS, PAD_RAMP, PAD_STAIR, PAD_TOP, PAD_TOP_RADIUS, SHIP, WREN, shipToWorld, RAMP_LIP_Z } from './layout';
import { fbm2, lathe, paramSurface, rbox, bcyl } from './shapes';
import { DUST_COLOR } from '../layout';
import type { HeightFn } from '../types';
import type { PadMarkSpec } from './textures';

export const PAD_COLOR = '#67655f';

/** Data for the markings texture (pad-local coordinates). */
export function padMarkSpec(): PadMarkSpec {
  const ax = Math.sin(SHIP.yaw);
  const az = Math.cos(SHIP.yaw);
  const local = (lx: number, lz: number) => {
    const p = shipToWorld(lx, lz);
    return { x: p.x - LANDING_PAD.x, z: p.z - LANDING_PAD.z };
  };
  const lip = local(0, RAMP_LIP_Z + 0.3);
  // Walkway runs from the lip to the pad edge along the ship axis.
  const edge = { x: lip.x + ax * 20, z: lip.z + az * 20 };
  const el = Math.hypot(edge.x, edge.z);
  const edgeAt = { x: (edge.x / el) * (PAD_TOP_RADIUS - 1.6), z: (edge.z / el) * (PAD_TOP_RADIUS - 1.6) };
  return {
    radius: PAD_BASE_RADIUS,
    axis: { x: ax, z: az },
    shipOffset: { x: SHIP.x - LANDING_PAD.x, z: SHIP.z - LANDING_PAD.z },
    scorch: [
      { ...local(-1.15, -5.2), r: 2.4, k: 0.6 },
      { ...local(1.15, -5.2), r: 2.4, k: 0.6 },
      { ...local(-WREN.nacelleX, 2.6), r: 3.6, k: 0.55 },
      { ...local(WREN.nacelleX, 2.6), r: 3.6, k: 0.55 },
      { ...local(-WREN.nacelleX, 11.5), r: 3.0, k: 0.35 },
      { ...local(WREN.nacelleX, 11.5), r: 3.0, k: 0.35 },
    ],
    walkFrom: edgeAt,
    walkTo: lip,
  };
}

/** Pad slab geometry goes in its own builder (pad material); fittings go in the shared kit. */
export function buildPad(padB: PartBuilder, kit: Kit, glows: GlowSet, heightAt: HeightFn): void {
  const cx = LANDING_PAD.x;
  const cz = LANDING_PAD.z;
  const gy = heightAt(cx, cz);
  const top = gy + PAD_TOP;

  // Slab: flat top, small edge bevel, sloped skirt that tucks under the regolith.
  const rt = PAD_TOP_RADIUS;
  const rb = PAD_BASE_RADIUS;
  const prof: [number, number][] = [
    [0, top],
    [rt * 0.35, top],
    [rt * 0.7, top],
    [rt - 0.08, top],
    [rt - 0.02, top - 0.015],
    [rt + 0.06, top - 0.045],
    [rb - 0.1, gy + 0.01],
    [rb + 0.15, gy - 0.06],
  ];
  // Lathe winds clockwise seen from above; reverse the profile so normals face up/out.
  padB.add(lathe(prof.slice().reverse(), 160), { color: PAD_COLOR, rough: 0.82, metal: 0.05, panel: 0.75, open: true }, T(cx, 0, cz));

  const asm = new Asm(kit);

  // Edge lights set into the skirt: housings + lenses (a few dead), with glow sprites.
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.04;
    const r = rt + 0.32;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const yy = gy + PAD_TOP * 0.55;
    const slope = Math.atan2(PAD_TOP, rb - rt);
    const m = TY(x, yy, z, -a + Math.PI / 2, -slope);
    asm.small(rbox(0.34, 0.06, 0.2, 0.02), { color: '#2b2e33', metal: 0.6, rough: 0.4 }, m);
    const dead = i % 13 === 5 || i === 22;
    const white = i % 5 === 0;
    const col = white ? '#dfe8ff' : '#ffb347';
    asm.small(rbox(0.24, 0.05, 0.1, 0.015), { color: dead ? '#3a3632' : col, rough: 0.2, panel: 0, glow: dead ? 0 : 3.2 }, m.clone().multiply(T(0, 0.02, 0)));
    if (!dead) glows.add(new Vector3(x, yy + 0.1, z), col, white ? 2.0 : 1.6, 0.22, GlowMode.Steady, i * 0.37, 1.0);
  }

  // Vehicle access ramp on the north-west side (toward the lane north).
  {
    // Flush with the deck at r0 and with the ground at r0 + run (walkable: see padSurfaceHeight).
    const a = PAD_RAMP.angle; // direction from centre (x, z)
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const yaw = Math.atan2(dx, dz);
    const run = PAD_RAMP.run;
    const slope = Math.atan2(PAD_TOP, run);
    const r0 = PAD_RAMP.r0;
    const mx = cx + dx * (r0 + run / 2);
    const mz = cz + dz * (r0 + run / 2);
    const m = TY(mx, gy + PAD_TOP / 2 - 0.06, mz, yaw, slope);
    asm.hard(rbox(4.2, 0.12, run + 0.4, 0.03), { color: '#4a4a47', metal: 0.5, rough: 0.55 }, m);
    for (let k = 0; k < 9; k++) {
      asm.small(rbox(3.7, 0.03, 0.06, 0.012), { color: '#55544f', metal: 0.6, rough: 0.5 }, m.clone().multiply(T(0, 0.07, -run / 2 + 0.1 + (k * run) / 9)));
    }
    for (const s of [-1, 1]) asm.small(rbox(0.12, 0.1, run + 0.4, 0.02), { color: '#d1a21f', rough: 0.5 }, m.clone().multiply(T(s * 2.06, 0.03, 0)));
  }

  // Two-step stair toward the habs (west); walkable (see padSurfaceHeight).
  {
    const a = PAD_STAIR.angle;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const yaw = Math.atan2(dx, dz);
    for (const { r, h } of PAD_STAIR.steps) {
      asm.hard(rbox(PAD_STAIR.halfWidth * 2, h, PAD_STAIR.halfDepth * 2, 0.02), { color: '#3c3d3c', metal: 0.55, rough: 0.5 }, TY(cx + dx * r, gy + h / 2, cz + dz * r, yaw));
      asm.small(rbox(2.3, 0.02, 0.05, 0.008), { color: '#d1a21f', rough: 0.5 }, TY(cx + dx * (r + 0.23), gy + h + 0.002, cz + dz * (r + 0.23), yaw));
    }
  }

  // Dust drifted against the rim: lumpy, heavier on the north-west (windward) side.
  const drift = paramSurface(
    (u, v, out) => {
      const a = u * Math.PI * 2;
      const n = fbm2(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10, 4, 3);
      const wind = 0.6 + 0.4 * Math.max(0, Math.cos(a - Math.atan2(-0.6, -0.8)));
      const height = (0.04 + 0.17 * n * n * 2.2) * wind;
      const width = 0.9 + 1.4 * n * wind;
      const r = rb - 0.45 + v * width;
      const prof = Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, v) * 1.15))), 1.3) * (1 - v * 0.35);
      out.set(cx + Math.cos(a) * r, gy - 0.03 + height * prof, cz + Math.sin(a) * r);
    },
    220,
    6,
  );
  kit.hard.add(drift, { color: DUST_COLOR, rough: 0.98, panel: 0, open: true });

  // A few tufts of dust that have crept onto the pad top.
  for (let i = 0; i < 9; i++) {
    const a = 2.3 + i * 0.37 + Math.sin(i * 7.1) * 0.2;
    const r = rt - 0.6 - (i % 3) * 0.5;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const g = paramSurface(
      (u, v, out) => {
        const ang = v * Math.PI * 2;
        const rr = u * (0.8 + (i % 4) * 0.35);
        out.set(x + Math.cos(ang) * rr * 1.6, top + 0.035 * (1 - u * u) - 0.004, z + Math.sin(ang) * rr);
      },
      3,
      10,
      { flip: true },
    );
    kit.small.add(g, { color: DUST_COLOR, rough: 0.98, panel: 0, open: true });
  }

  // Tie-down rings and a couple of utility hatches on the deck.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const r = 9.6;
    asm.small(bcyl(0.22, 0.03, 12), { color: '#2b2e33', metal: 0.7, rough: 0.4 }, T(cx + Math.cos(a) * r, top + 0.01, cz + Math.sin(a) * r));
  }
  asm.small(rbox(1.0, 0.03, 0.7, 0.01), { color: '#3a3b3a', metal: 0.6, rough: 0.5 }, TY(cx - 6.5, top + 0.005, cz - 6.0, 0.4));
}

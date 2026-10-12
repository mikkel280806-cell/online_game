// Survey Outpost Kestrel-7 (abandoned): habitat modules, tunnels, comms mast, solar array,
// fuel tanks, cargo containers, crates, a six-wheeled rover, floodlights, cables and a sign.
// Everything is placed from layout.ts and stands on `heightAt`.

import { BoxGeometry, Color, Matrix4, Vector3 } from 'three';
import type { HeightFn } from '../types';
import { Asm, PartBuilder, T, TY, facing, type Kit } from './builder';
import { addCylinderDecal, addDecal, GlowMode, type ConeSet, type GlowSet } from './fx';
import {
  CONTAINER,
  CONTAINERS,
  CRATES,
  FLOODLIGHTS,
  HAB_LIFT,
  HABS,
  MAST,
  MAST_CABINET,
  PAD_TOP,
  PEDESTAL,
  REEL_CART,
  ROVER,
  SIGN,
  SOLAR,
  TANKS,
  TARP,
  TROLLEY,
  TUNNELS,
  laneStakes,
  mastGuyAnchors,
  PEDESTAL_YAW,
  SOLAR_YAW,
  solarInverter,
  tunnelPlan,
  umbilicalPath,
  type TunnelSpec,
  habFrame,
  solarPanels,
  type ContainerSpec,
  type HabSpec,
} from './layout';
import { bcyl, corrugated, corrugatedDecal, cyl, extrude, fbm2, lathe, paramSurface, rbox, strut, tube } from './shapes';
import type { DecalAtlas } from './textures';

const WHITE2 = '#b9b5aa';
const GUN = '#2b2e33';
const GUN2 = '#3a3d42';
const YEL = '#d1a21f';
const RUBBER = '#1a1b1c';

const paint = (color: string, rough = 0.55) => ({ color, metal: 0.08, rough, panel: 1 });
const metal = (color = GUN2, rough = 0.42) => ({ color, metal: 0.65, rough, panel: 0.5 });
const plain = (color: string, rough = 0.6) => ({ color, metal: 0.1, rough, panel: 0 });

export interface OutpostBuild {
  /** The comms dish (animated: slow rotation about Y). */
  dishPivot: Vector3;
  /** Lamp positions and aim points for the real spot lights. */
  spots: { pos: Vector3; target: Vector3 }[];
}

export function buildOutpost(kit: Kit, dish: PartBuilder, solar: PartBuilder, glows: GlowSet, cones: ConeSet, atlas: DecalAtlas, heightAt: HeightFn): OutpostBuild {
  const world = new Asm(kit);
  for (const h of HABS) buildHab(world, h, glows, atlas, heightAt);
  for (const t of TUNNELS) buildTunnel(world, t, heightAt);
  const dishPivot = buildMast(world, dish, glows, atlas, heightAt);
  buildSolar(world, solar, heightAt, atlas);
  for (const t of TANKS) buildTank(world, t.x, t.z, t.yaw, t.length, t.radius, t.label, atlas, heightAt);
  for (const c of CONTAINERS) buildContainer(world, c, atlas, heightAt);
  buildCrates(world, heightAt);
  buildRover(world, glows, heightAt);
  const spots = buildFloodlights(world, glows, cones, heightAt);
  buildSign(world, atlas, heightAt);
  buildCables(world, heightAt);
  buildClutter(world, heightAt);
  return { dishPivot, spots };
}

// ---- habitat modules --------------------------------------------------------------------------

function habMatrix(h: HabSpec, heightAt: HeightFn): Matrix4 {
  const f = habFrame(h);
  return TY(h.x, heightAt(h.x, h.z), h.z, f.yaw);
}

function buildHab(world: Asm, h: HabSpec, glows: GlowSet, atlas: DecalAtlas, heightAt: HeightFn): void {
  const a = world.sub(habMatrix(h, heightAt));
  const R = h.radius;
  const L = h.length;
  const cy = HAB_LIFT + R;
  const D = 1.05; // dome depth

  // Hull: lathe along the axis with domed ends and raised ribs.
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * (Math.PI / 2);
    prof.push([R * Math.sin(p), -L / 2 + D * (1 - Math.cos(p))]);
  }
  const y0 = -L / 2 + D;
  const y1 = L / 2 - D;
  const bandW = 0.22;
  prof.push([R + 0.09, y0 + 0.02], [R + 0.09, y0 + bandW], [R, y0 + bandW + 0.03]);
  const ribs = Math.max(2, Math.round((y1 - y0) / 1.25));
  for (let k = 1; k < ribs; k++) {
    const y = y0 + ((y1 - y0) * k) / ribs;
    prof.push([R, y - 0.1], [R + 0.065, y - 0.06], [R + 0.065, y + 0.06], [R, y + 0.1]);
  }
  prof.push([R, y1 - bandW - 0.03], [R + 0.09, y1 - bandW], [R + 0.09, y1 - 0.02]);
  for (let i = 8; i >= 0; i--) {
    const p = (i / 8) * (Math.PI / 2);
    prof.push([R * Math.sin(p), L / 2 - D * (1 - Math.cos(p))]);
  }
  const hull = lathe(prof, 56);
  hull.rotateZ(-Math.PI / 2); // lathe Y → local X
  const gunC = new Color(GUN2);
  const inv = a.m.clone().invert();
  a.hard(hull, { ...paint(WHITE2, 0.5), scale: 1.7 }, T(0, cy, 0), (p, _n, c) => {
    // Ribs and end bands in gunmetal (radius beyond the skin).
    const local = p.clone().applyMatrix4(inv);
    const r = Math.hypot(local.y - cy, local.z);
    if (r > R + 0.03) c.copy(gunC);
  });

  // Skids, cradles and legs.
  const sk = R * 0.64;
  for (const s of [-1, 1]) {
    a.hard(rbox(L - 0.6, 0.24, 0.32, 0.05), metal(), T(0, 0.09, s * sk));
    for (const e of [-1, 1]) a.small(rbox(0.5, 0.06, 0.5, 0.02), metal(GUN), T(e * (L / 2 - 0.5), 0.02, s * sk));
  }
  for (const x of [-(L / 2 - D - 0.4), 0, L / 2 - D - 0.4]) {
    a.hard(rbox(0.3, 0.32, 2 * sk + 0.4, 0.05), metal(), T(x, HAB_LIFT - 0.05, 0));
    for (const s of [-1, 1]) {
      a.hard(rbox(0.22, HAB_LIFT - 0.1, 0.22, 0.04), metal(), T(x, (HAB_LIFT - 0.1) / 2 + 0.1, s * sk));
      a.small(strut(new Vector3(x - 0.7, 0.2, s * sk), new Vector3(x, HAB_LIFT - 0.15, s * sk), 0.05, 6), metal());
    }
  }
  // Conduits along the lower hull and a roof equipment unit.
  // Each conduit rests on the hull ribs, is held by clamps and ends in a junction box on the skin.
  for (const s of [-1, 1]) {
    const ang = s * 1.15; // above head height
    const at = (x: number, r: number) => new Vector3(x, cy - Math.cos(ang) * r, Math.sin(ang) * r);
    const x0 = -L / 2 + D + 0.3;
    const x1 = L / 2 - D - 0.3;
    a.small(tube([at(x0, R + 0.1), at(0, R + 0.1), at(x1, R + 0.1)], 0.05, 12, 6), plain('#4a4d50', 0.5));
    const nrm = new Vector3(0, -Math.cos(ang), Math.sin(ang));
    for (const x of [x0, x1]) a.small(rbox(0.28, 0.22, 0.2, 0.03), metal('#4a4d52'), facing(at(x, R + 0.06), nrm).multiply(T(0, 0, 0, 0, Math.PI / 2, 0)));
    for (let k = 1; k < 4; k++) a.small(rbox(0.06, 0.16, 0.16, 0.01), metal(GUN), facing(at(x0 + ((x1 - x0) * k) / 4, R + 0.08), nrm).multiply(T(0, 0, 0, 0, Math.PI / 2, 0)));
  }
  a.hard(rbox(1.8, 0.55, 1.2, 0.06), metal('#4a4d52'), T(-L * 0.18, cy + R + 0.18, 0));
  for (let k = 0; k < 7; k++) a.small(rbox(0.04, 0.4, 1.1, 0.01), metal('#24272a'), T(-L * 0.18 - 0.75 + k * 0.25, cy + R + 0.2, 0));
  // Whip antenna on a base plate (both sunk into the curved roof).
  a.small(bcyl(0.07, 0.14, 10), metal(GUN), T(L * 0.25, cy + R + 0.02, -0.4));
  a.small(cyl(0.012, 0.02, 2.25, 6), plain('#202020', 0.4), T(L * 0.25, cy + R + 1.2, -0.4));
  a.small(bcyl(0.12, 0.6, 10), metal(), T(L * 0.12, cy + R + 0.2, 0.6));
  // Handrail along the top.
  a.small(tube([new Vector3(-L / 2 + D, cy + R + 0.35, -0.5), new Vector3(L / 2 - D, cy + R + 0.35, -0.5)], 0.03, 4, 5), plain(YEL, 0.5));
  for (const x of [-L / 2 + D, 0, L / 2 - D]) a.small(cyl(0.025, 0.025, 0.46, 5), plain(YEL, 0.5), T(x, cy + R + 0.12, -0.5));

  // Windows.
  for (const w of h.windows) {
    const ang = 0.28; // just above the equator
    const nrm = new Vector3(0, Math.sin(ang), Math.cos(ang) * w.side);
    const pos = new Vector3(w.along, cy, 0).addScaledVector(nrm, R + 0.02);
    const m = facing(pos, nrm);
    a.hard(rbox(0.82, 0.58, 0.16, 0.1, 2), metal(GUN), m);
    if (w.lit) {
      a.small(rbox(0.6, 0.38, 0.1, 0.06, 2), { color: '#ffcf96', rough: 0.15, panel: 0, glow: 2.6 }, m.clone().multiply(T(0, 0, 0.04)));
      glows.add(pos.clone().addScaledVector(nrm, 0.2).applyMatrix4(a.m), '#ffcc90', 0.8, 0.6, GlowMode.Steady, 0, 1.2);
    } else {
      a.small(rbox(0.6, 0.38, 0.1, 0.06, 2), { color: '#0d1115', rough: 0.07, metal: 0.3, panel: 0 }, m.clone().multiply(T(0, 0, 0.04)));
    }
    a.small(rbox(0.9, 0.06, 0.2, 0.02), metal(GUN), m.clone().multiply(T(0, 0.34, 0.06)));
  }

  // Airlock vestibule, door, porch and steps.
  {
    const s = h.airlock.side;
    const al = a.sub(T(h.airlock.along, 0, 0, 0, s > 0 ? 0 : Math.PI, 0)); // local +Z points outward
    const vz0 = R - 0.35;
    const vd = 2.0;
    const floor = HAB_LIFT + 0.05;
    const vh = 2.75;
    al.hard(rbox(2.3, vh, vd, 0.1, 2), paint(WHITE2, 0.5), T(0, floor + vh / 2 - 0.15, vz0 + vd / 2));
    al.hard(rbox(2.5, 0.16, vd + 0.25, 0.05), metal(GUN), T(0, floor + vh - 0.08, vz0 + vd / 2 + 0.1));
    const fz = vz0 + vd;
    // Door frame with hazard band, door leaf with a porthole.
    al.hard(rbox(1.36, 2.32, 0.14, 0.04), metal(GUN), T(0, floor + 1.12, fz + 0.03));
    al.small(rbox(1.0, 2.02, 0.08, 0.03), paint('#a9a59b', 0.5), T(0, floor + 1.06, fz + 0.09));
    al.small(bcyl(0.16, 0.06, 16), { color: '#0e1216', rough: 0.07, metal: 0.3, panel: 0 }, T(0, floor + 1.55, fz + 0.13, Math.PI / 2, 0, 0));
    al.small(rbox(0.06, 0.32, 0.06, 0.02), metal('#6a6d70'), T(0.36, floor + 1.0, fz + 0.15));
    for (const sx of [-1, 1]) al.small(rbox(0.14, 2.3, 0.04, 0.01), plain(YEL, 0.5), T(sx * 0.6, floor + 1.12, fz + 0.11));
    // Hazard lintel: a solid band from the vestibule face out to the frame's face.
    al.small(rbox(1.36, 0.16, 0.12, 0.01), plain(YEL, 0.5), T(0, floor + 2.33, fz + 0.05));
    addDecal(al.kit, atlas, 'HAZARD', 1.3, '#151515', al.m.clone().multiply(T(0, floor + 2.33, fz + 0.113)));
    addDecal(al.kit, atlas, 'AIRLOCK', 1.0, '#2b2e33', al.m.clone().multiply(T(0, floor + 2.6, fz + 0.004)));
    for (const sx of [-1, 1]) addDecal(al.kit, atlas, h.name, 1.15, '#2b2e33', al.m.clone().multiply(T(sx * 1.157, floor + 1.75, vz0 + vd / 2 + 0.1, 0, (sx * Math.PI) / 2, 0)));
    // Door lamp (warm) and a status light.
    al.small(rbox(0.56, 0.14, 0.2, 0.03), metal(GUN), T(0, floor + 2.5, fz + 0.09));
    al.small(rbox(0.5, 0.04, 0.16, 0.015), { color: '#ffd9a8', rough: 0.3, panel: 0, glow: 5 }, T(0, floor + 2.43, fz + 0.1));
    glows.add(al.pt(0, floor + 2.44, fz + 0.25), '#ffd2a0', 3.0, 0.6, GlowMode.Steady, 0, 1.5);
    al.small(rbox(0.12, 0.12, 0.05, 0.02), { color: '#ff3a1a', rough: 0.3, panel: 0, glow: 4 }, T(0.85, floor + 1.4, fz + 0.02));
    glows.add(al.pt(0.85, floor + 1.4, fz + 0.12), '#ff3a1a', 2, 0.25, GlowMode.Beacon, h.x * 0.1, 1.0);
    // Porch grating and steps down to the regolith.
    const pz = fz + 0.5;
    al.hard(rbox(1.9, 0.08, 1.0, 0.02), metal('#4a4c4f'), T(0, floor - 0.04, pz));
    for (let k = 0; k < 6; k++) al.small(rbox(1.8, 0.02, 0.03, 0.005), metal('#2a2c2e'), T(0, floor + 0.005, pz - 0.4 + k * 0.16));
    const rise = floor / 4;
    for (let k = 1; k <= 3; k++) {
      al.hard(rbox(1.5, 0.06, 0.32, 0.015), metal('#4a4c4f'), T(0, floor - rise * k, pz + 0.5 + k * 0.3 - 0.15));
    }
    for (const sx of [-1, 1]) {
      // Stringers and handrails.
      al.small(strut(new Vector3(sx * 0.8, floor - 0.05, pz + 0.45), new Vector3(sx * 0.8, 0.0, pz + 0.5 + 0.9 + 0.1), 0.05, 6), metal());
      const rail = [new Vector3(sx * 0.95, floor + 0.95, fz + 0.1), new Vector3(sx * 0.95, floor + 0.95, pz + 0.45), new Vector3(sx * 0.82, 0.95, pz + 0.5 + 0.9)];
      al.small(tube(rail, 0.03, 12, 5), plain(YEL, 0.45));
      for (const p of rail) al.small(cyl(0.025, 0.025, p.y, 5), plain(YEL, 0.45), T(p.x, p.y / 2, p.z));
    }
  }

  // Dust heaped against the skids' ends.
  for (const s of [-1, 1]) for (const e of [-1, 1]) dustMound(a, e * (L / 2 - 0.3), s * sk, 0.9, 0.18, h.x + s * 3 + e);
}

/** Low lumpy dust heap (local coordinates of the assembly). */
function dustMound(a: Asm, x: number, z: number, r: number, height: number, seed: number): void {
  const g = paramSurface(
    (u, v, out) => {
      const ang = v * Math.PI * 2;
      const n = fbm2(Math.cos(ang) * 1.5 + seed, Math.sin(ang) * 1.5 + seed, 3, 9);
      const rr = r * u * (0.7 + 0.6 * n);
      const hh = height * (1 - u * u) * (0.6 + 0.8 * n);
      out.set(x + Math.cos(ang) * rr * 1.3, hh - 0.02, z + Math.sin(ang) * rr);
    },
    4,
    14,
    { flip: true },
  );
  a.small(g, { ...plain('#7d7368', 0.98), open: true });
}

// ---- tunnels ------------------------------------------------------------------------------------

function buildTunnel(world: Asm, t: TunnelSpec, heightAt: HeightFn): void {
  const r = t.radius;
  const gy = heightAt((t.ax + t.bx) / 2, (t.az + t.bz) / 2);
  // Both ends are sunk into the hulls (see tunnelPlan); collars sit where the axis meets the skin.
  const plan = tunnelPlan(t, gy);
  const ja = { skin: plan.skinA };
  const jb = { skin: plan.skinB };
  const A = plan.a;
  const B = plan.b;
  const len = A.distanceTo(B);
  const dir = new Vector3().subVectors(B, A).normalize();
  // Corrugated tube as a closed lathe along Y (capped ends, buried in the hulls), aligned A→B.
  const prof: [number, number][] = [[0, -len / 2]];
  const n = Math.round(len / 0.11);
  for (let i = 0; i <= n; i++) prof.push([r + (i % 2 ? 0.035 : -0.01), -len / 2 + (i / n) * len]);
  prof.push([0, len / 2]);
  const g = lathe(prof, 28);
  const m = facing(A.clone().add(B).multiplyScalar(0.5), dir, new Vector3(0, 1, 0));
  // facing() points +Z along dir; the lathe runs along Y → rotate Y onto Z first.
  g.rotateX(Math.PI / 2);
  world.hard(g, { ...paint('#aaa69c', 0.55), scale: 1.4 }, m);
  // Docking collars where the tube enters each hull: a bolted flange ring half sunk into the skin.
  for (const [j, out] of [
    [ja, dir],
    [jb, dir.clone().negate()],
  ] as [{ skin: Vector3 }, Vector3][]) {
    const c = j.skin.clone().addScaledVector(out, 0.06);
    const ring = lathe([[0, -0.2], [r + 0.16, -0.2], [r + 0.2, -0.15], [r + 0.2, 0.12], [r + 0.13, 0.2], [0, 0.2]], 32);
    ring.rotateX(Math.PI / 2);
    world.hard(ring, metal('#5a5d60', 0.45), facing(c, out, new Vector3(0, 1, 0)));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      world.small(bcyl(0.035, 0.05, 6), metal('#3a3d42'), facing(c, out, new Vector3(0, 1, 0)).multiply(T(Math.cos(a) * (r + 0.09), Math.sin(a) * (r + 0.09), 0.2, Math.PI / 2, 0, 0)));
    }
  }
  // Supports every ~2.6 m along the exposed span: saddle + two legs.
  const side = new Vector3(-dir.z, 0, dir.x);
  for (const p of plan.supports) {
    const base = heightAt(p.x, p.z);
    const yaw = Math.atan2(dir.x, dir.z);
    world.hard(rbox(2 * r + 0.3, 0.18, 0.3, 0.04), metal(), TY(p.x, p.y - r - 0.06, p.z, yaw));
    for (const s of [-1, 1]) {
      const top = p.clone().addScaledVector(side, s * (r - 0.1)).setY(p.y - r - 0.1);
      const foot = p.clone().addScaledVector(side, s * (r + 0.35)).setY(base);
      world.hard(strut(foot, top, 0.07, 6), metal());
      world.small(rbox(0.35, 0.05, 0.35, 0.015), metal(GUN), TY(foot.x, base + 0.02, foot.z, yaw));
    }
  }
}

// ---- comms mast and dish -------------------------------------------------------------------------

function buildMast(world: Asm, dish: PartBuilder, glows: GlowSet, atlas: DecalAtlas, heightAt: HeightFn): Vector3 {
  const gy = heightAt(MAST.x, MAST.z);
  const a = world.sub(T(MAST.x, gy, MAST.z));
  const H = MAST.height;
  // Footing.
  a.hard(rbox(2.4, 0.5, 2.4, 0.08), plain('#6d6a64', 0.9), T(0, 0.15, 0));
  // Triangular lattice tower, tapering.
  const leg = (i: number, y: number) => {
    const ang = (i / 3) * Math.PI * 2 + 0.9;
    const r = 0.62 - (y / H) * 0.3;
    return new Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r);
  };
  const tower = { color: '#8b8d8f', metal: 0.75, rough: 0.45, panel: 0.2 };
  for (let i = 0; i < 3; i++) a.hard(strut(leg(i, 0.4), leg(i, H), 0.055, 6), tower);
  const step = 1.15;
  for (let y = 0.4; y < H - 0.1; y += step) {
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      a.small(strut(leg(i, y), leg(j, y), 0.025, 4), tower);
      a.small(strut(leg(i, y), leg(j, Math.min(y + step, H)), 0.02, 4), tower);
    }
  }
  // Platform near the top, antennas, beacon.
  a.hard(bcyl(0.75, 0.08, 12), metal('#55585b'), T(0, H - 1.2, 0));
  a.small(cyl(0.015, 0.03, 3.0, 6), plain('#222', 0.4), T(0.2, H + 1.5, 0.1));
  a.small(cyl(0.015, 0.025, 2.2, 6), plain('#222', 0.4), T(-0.25, H + 1.1, -0.1));
  a.small(cyl(0.12, 0.14, 0.26, 12), { color: '#ff2a1a', rough: 0.2, panel: 0, glow: 2 }, T(0, H + 0.12, 0));
  glows.add(a.pt(0, H + 0.3, 0), '#ff2a1a', 24, 0.9, GlowMode.Beacon, 0.9, 2.5);
  // Guy wires.
  mastGuyAnchors().forEach((g, i) => {
    const foot = new Vector3(g.x - MAST.x, 0.05, g.z - MAST.z);
    a.small(strut(foot, leg(i, H * 0.72), 0.012, 4), plain('#555', 0.4));
    a.small(rbox(0.4, 0.2, 0.4, 0.05), plain('#5d5a54', 0.9), T(foot.x, 0.05, foot.z));
  });
  // Equipment cabinet (west of the mast).
  const cab = world.sub(TY(MAST_CABINET.x, heightAt(MAST_CABINET.x, MAST_CABINET.z), MAST_CABINET.z, Math.PI / 2 + 0.1));
  cab.hard(rbox(1.2, 1.7, 0.75, 0.05), paint(WHITE2, 0.55), T(0, 0.85, 0));
  cab.hard(rbox(1.35, 0.1, 0.9, 0.03), metal(GUN), T(0, 1.75, 0));
  for (let k = 0; k < 6; k++) cab.small(rbox(0.7, 0.03, 0.04, 0.01), metal(GUN), T(0, 0.35 + k * 0.08, 0.385));
  addDecal(cab.kit, atlas, 'DANGER', 0.95, '#161616', cab.m.clone().multiply(T(0, 1.35, 0.38)));
  cab.small(rbox(1.05, 0.17, 0.02, 0.01), plain(YEL, 0.5), T(0, 1.35, 0.376));
  cab.small(rbox(0.1, 0.06, 0.03, 0.01), { color: '#3aff6a', rough: 0.3, panel: 0, glow: 3 }, T(0.45, 1.6, 0.385));
  cab.small(rbox(0.1, 0.06, 0.03, 0.01), { color: '#ffb020', rough: 0.3, panel: 0, glow: 3 }, T(0.3, 1.6, 0.385));

  // Side boom carrying the dish head; the head turns slowly about its own vertical axis.
  const bx = -0.55;
  const bz = 0.835;
  const boomY = H - 3.4;
  const boomLen = 2.5;
  a.hard(strut(new Vector3(bx * 0.3, boomY, bz * 0.3), new Vector3(bx * boomLen, boomY, bz * boomLen), 0.09, 8), metal());
  a.small(strut(new Vector3(bx * 0.3, boomY + 1.4, bz * 0.3), new Vector3(bx * (boomLen - 0.2), boomY + 0.05, bz * (boomLen - 0.2)), 0.035, 6), metal());
  a.hard(bcyl(0.2, 0.35, 12), metal(GUN), T(bx * boomLen, boomY + 0.2, bz * boomLen));
  const pivot = new Vector3(MAST.x + bx * boomLen, gy + boomY + 0.38, MAST.z + bz * boomLen);
  const d = new Asm({ hard: dish, small: dish, decal: dish }, T(0, 0, 0));
  d.hard(bcyl(0.14, 0.4, 12), metal(), T(0, 0.2, 0));
  d.hard(rbox(0.9, 0.12, 0.3, 0.04), metal(), T(0, 0.42, 0));
  for (const sx of [-1, 1]) d.hard(rbox(0.1, 0.7, 0.22, 0.03), metal(), T(sx * 0.42, 0.75, 0));
  const dm = T(0, 0.95, 0.05, -0.55, 0, 0); // dish tilted up toward the sky
  const dd = new Asm(d.kit, d.m.clone().multiply(dm));
  const R = 1.25;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const r = (i / 10) * R;
    prof.push([r, (r * r) / (4 * 0.9)]);
  }
  const rimY = (R * R) / (4 * 0.9);
  // Back shell closes onto the axis (no hole behind the feed hub).
  prof.push([R + 0.05, rimY + 0.02], [R + 0.05, rimY - 0.06], [R * 0.6, -0.02], [0.3, -0.1], [0, -0.12]);
  const bowl = lathe(prof.slice().reverse(), 36);
  bowl.rotateX(Math.PI / 2); // bowl opens toward +Z
  dd.hard(bowl, paint('#d2cfc6', 0.45));
  dd.hard(bcyl(0.22, 0.3, 12), metal(), T(0, 0, -0.15, Math.PI / 2, 0, 0));
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + Math.PI / 2;
    dd.small(strut(new Vector3(Math.cos(ang) * R * 0.92, Math.sin(ang) * R * 0.92, rimY), new Vector3(0, 0, 0.9), 0.02, 4), metal());
  }
  dd.small(bcyl(0.08, 0.2, 10), metal('#555'), T(0, 0, 0.95, Math.PI / 2, 0, 0));
  return pivot;
}

// ---- solar array ---------------------------------------------------------------------------------

function buildSolar(world: Asm, solar: PartBuilder, heightAt: HeightFn, atlas: DecalAtlas): void {
  const sunYaw = SOLAR_YAW; // panel normal azimuth (toward the Hollow)
  const tilt = 0.95; // radians from horizontal
  for (const p of solarPanels()) {
    const gy = heightAt(p.x, p.z);
    const a = world.sub(TY(p.x, gy, p.z, sunYaw));
    // local: +Z toward the sun (horizontal), panel long side along X.
    const pw = SOLAR.panelW;
    const pl = SOLAR.panelL;
    a.hard(rbox(0.5, 0.25, 0.5, 0.05), plain('#6d6a64', 0.9), T(0, 0.08, 0));
    if (!p.fallen) {
      a.hard(bcyl(0.08, 1.5, 10), metal('#8a8c8e'), T(0, 0.8, 0));
      a.small(rbox(0.25, 0.2, 0.25, 0.04), metal(), T(0, 1.55, 0));
      const pm = T(0, 1.62, 0, tilt, 0, 0); // tilt the cell face toward +Z (the Hollow)
      a.hard(rbox(pw + 0.08, 0.07, pl + 0.08, 0.02), metal('#9a9c9e', 0.4), pm);
      a.small(rbox(0.1, 0.12, pl, 0.02), metal('#7a7c7e'), pm.clone().multiply(T(0, -0.08, 0)));
      const r = { u0: p.cracked ? 0.5 : 0, u1: p.cracked ? 1 : 0.5, v0: 0, v1: 1 };
      const q = solarQuad(pw, pl, r);
      solar.add(q, { color: '#ffffff', rough: 0.22, metal: 0.2, panel: 0 }, a.m.clone().multiply(pm).multiply(T(0, 0.04, 0)));
    } else {
      // Snapped post, panel lying in the dust with one edge propped on the stump.
      a.hard(bcyl(0.08, 0.55, 10), metal('#8a8c8e'), T(0, 0.3, 0));
      a.hard(bcyl(0.08, 1.0, 10), metal('#8a8c8e'), T(0.9, 0.08, 0.6, 0, 0.4, Math.PI / 2 - 0.08));
      const pm = T(0.4, 0.3, 1.3, 0.16, 0.25, 0.06);
      a.hard(rbox(pw + 0.08, 0.07, pl + 0.08, 0.02), metal('#9a9c9e', 0.4), pm);
      const q = solarQuad(pw, pl, { u0: 0.5, u1: 1, v0: 1, v1: 0 });
      solar.add(q, { color: '#ffffff', rough: 0.3, metal: 0.2, panel: 0 }, a.m.clone().multiply(pm).multiply(T(0, 0.04, 0)));
      dustMound(a, 0.4, 2.8, 1.2, 0.12, 3.3);
    }
  }
  // Inverter box at the row end with a warning stencil.
  const inv = solarInverter();
  const box = world.sub(TY(inv.x, heightAt(inv.x, inv.z), inv.z, inv.yaw));
  box.hard(rbox(1.0, 1.2, 0.6, 0.05), paint(WHITE2), T(0, 0.6, 0));
  addDecal(box.kit, atlas, 'DANGER', 0.8, '#161616', box.m.clone().multiply(T(0, 0.95, 0.305)));
  box.small(rbox(0.86, 0.15, 0.02, 0.01), plain(YEL, 0.5), T(0, 0.95, 0.302));
}

function solarQuad(w: number, l: number, r: { u0: number; u1: number; v0: number; v1: number }) {
  // Flat panel in XZ facing +Y; uv u across X, v along Z.
  const g = rbox(w, 0.02, l, 0.008);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / w + 0.5;
    const v = pos.getZ(i) / l + 0.5;
    uv.setXY(i, r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v);
  }
  return g;
}

// ---- fuel tanks ---------------------------------------------------------------------------------

function buildTank(world: Asm, x: number, z: number, yaw: number, L: number, R: number, label: string, atlas: DecalAtlas, heightAt: HeightFn): void {
  const a = world.sub(TY(x, heightAt(x, z), z, yaw));
  const cy = R + 0.55;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * (Math.PI / 2);
    prof.push([R * Math.sin(p), -L / 2 + R * 0.7 * (1 - Math.cos(p))]);
  }
  for (let i = 8; i >= 0; i--) {
    const p = (i / 8) * (Math.PI / 2);
    prof.push([R * Math.sin(p), L / 2 - R * 0.7 * (1 - Math.cos(p))]);
  }
  const g = lathe(prof, 40);
  g.rotateZ(-Math.PI / 2);
  a.hard(g, { ...paint('#bbb8ae', 0.45), scale: 1.5 }, T(0, cy, 0));
  const bandCol = label === 'LOX' ? '#5b7a8c' : YEL;
  for (const bx of [-L * 0.28, L * 0.28]) {
    // Strap band: a solid ring (closed profile) hugging the shell.
    a.hard(lathe([[0, -0.12], [R + 0.04, -0.12], [R + 0.06, -0.1], [R + 0.06, 0.1], [R + 0.04, 0.12], [0, 0.12]], 40), paint(bandCol, 0.5), T(bx, cy, 0, 0, 0, -Math.PI / 2));
    // Saddle: its top is cut to the tank's curve (sunk 4 cm into the shell), so the tank sits in it.
    const outline: [number, number][] = [
      [-R * 0.95, 0.12],
      [R * 0.95, 0.12],
    ];
    for (let k = 0; k <= 16; k++) {
      const zz = R * 0.95 - (k / 16) * R * 1.9;
      outline.push([zz, cy - Math.sqrt(R * R - zz * zz) + 0.04]);
    }
    const saddle = extrude(outline, 0.35, 0.02, 1);
    saddle.rotateY(Math.PI / 2);
    a.hard(saddle, metal(), T(bx, 0, 0));
  }
  a.hard(rbox(L * 0.9, 0.18, 2 * R * 0.95, 0.04), metal(GUN), T(0, 0.06, 0));
  // Valves and plumbing at one end.
  const ex = L / 2 + 0.25;
  a.hard(rbox(0.6, 1.0, 0.7, 0.05), metal('#4d5055'), T(ex, 0.55, 0.3));
  a.small(tube([new Vector3(L / 2 - 0.2, cy, 0), new Vector3(ex, cy, 0.0), new Vector3(ex, 1.0, 0.3)], 0.07, 12, 6), metal('#8b8d8f', 0.35));
  a.small(bcyl(0.16, 0.05, 12), plain('#b33a1a', 0.5), T(ex + 0.32, 0.75, 0.3, 0, 0, Math.PI / 2));
  a.small(tube([new Vector3(ex, 0.3, 0.3), new Vector3(ex + 0.5, 0.06, 0.6), new Vector3(ex + 1.6, 0.06, 1.2)], 0.06, 12, 6), plain(RUBBER, 0.7));
  // Ladder up the south side, held off the shell by brackets, with grab rails over the top.
  const lx = -L * 0.1;
  const lz = R + 0.2;
  const top = cy + R - 0.15;
  const steel = metal('#7a7c7e');
  for (const s of [-1, 1]) {
    const rx = lx + s * 0.22;
    a.small(cyl(0.025, 0.025, top, 5), steel, T(rx, top / 2, lz));
    for (const yy of [cy, cy + R * 0.6]) {
      const zs = Math.sqrt(Math.max(R * R - (yy - cy) ** 2, 0)) - 0.04;
      a.small(strut(new Vector3(rx, yy, zs), new Vector3(rx, yy, lz), 0.02, 5), steel);
    }
    a.small(tube([new Vector3(rx, top - 0.05, lz), new Vector3(rx, cy + R + 0.22, lz - 0.12), new Vector3(rx, cy + R + 0.3, 0.5), new Vector3(rx, cy + R - 0.02, 0.12)], 0.025, 12, 5), steel);
  }
  for (let k = 0; k < 8; k++) a.small(cyl(0.018, 0.018, 0.44, 4), steel, T(lx, 0.3 + k * 0.33, lz, 0, 0, Math.PI / 2));
  // Labels on the side facing south (+Z local), wrapped onto the shell.
  addCylinderDecal(a.kit.decal, atlas, label, 1.3, '#2b2e33', a.m.clone().multiply(T(L * 0.08, cy, 0)), R, 0.16);
  addCylinderDecal(a.kit.decal, atlas, 'FLAMMABLE', 1.5, '#9b2a14', a.m.clone().multiply(T(L * 0.08, cy, 0)), R, -0.38);
}

// ---- cargo containers ----------------------------------------------------------------------------

function buildContainer(world: Asm, c: ContainerSpec, atlas: DecalAtlas, heightAt: HeightFn): void {
  const a = world.sub(TY(c.x, heightAt(c.x, c.z) + c.y, c.z, c.yaw));
  const { length: L, width: W, height: H } = CONTAINER;
  const body = { color: c.color, metal: 0.25, rough: 0.6, panel: 0.35 };
  const frame = { color: new Color(c.color).multiplyScalar(0.7).getStyle(), metal: 0.4, rough: 0.55, panel: 0.4 };
  const inner = { color: new Color(c.color).multiplyScalar(0.45).getStyle(), metal: 0.25, rough: 0.7, panel: 0 };
  // Closed core box just behind the corrugated skins: the skins are single-sided sheets, so any
  // seam between panels shows painted steel instead of the ground behind the container.
  a.hard(new BoxGeometry(L - 0.2, H - 0.16, W - 0.2), inner, T(0, H / 2, 0));
  // Bottom and top rails as full slabs (floor and roof frame); posts and castings at the corners.
  a.hard(rbox(L, 0.16, W, 0.03), frame, T(0, 0.08, 0));
  a.hard(rbox(L, 0.12, W, 0.03), frame, T(0, H - 0.06, 0));
  a.hard(rbox(L - 0.3, 0.05, W - 0.2, 0.015), body, T(0, H - 0.01, 0));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      a.hard(rbox(0.16, H, 0.16, 0.02), frame, T(sx * (L / 2 - 0.08), H / 2, sz * (W / 2 - 0.08)));
      for (const y of [0.09, H - 0.09]) a.small(rbox(0.19, 0.18, 0.19, 0.02), metal('#3a3632'), T(sx * (L / 2 - 0.08), y, sz * (W / 2 - 0.08)));
    }
  // Wall skins run from inside the bottom rail to inside the top rail and into the corner posts,
  // so no edge is left hanging in the open.
  const wallH = H - 0.24;
  const wallY = 0.12 + wallH / 2;
  const sideW = L - 0.24;
  for (const s of [-1, 1]) {
    const wm = T(0, wallY, s * (W / 2 - 0.06), 0, s > 0 ? 0 : Math.PI, 0);
    a.hard(corrugated(sideW, wallH, 0.28, 0.05), { ...body, open: true }, wm);
    // Stencils follow the corrugation (painted on, not floating in front of it).
    const label = atlas.rect(c.label);
    const orrin = atlas.rect('ORRIN');
    a.kit.decal.add(corrugatedDecal(sideW, 0.28, 0.05, 1.3, H * 0.66 - wallY, 1.9, label), { color: '#e2ddd0', rough: 0.62, panel: 0, metal: 0 }, a.m.clone().multiply(wm));
    a.kit.decal.add(corrugatedDecal(sideW, 0.28, 0.05, -1.2, H * 0.4 - wallY, 2.2, orrin), { color: '#e2ddd0', rough: 0.62, panel: 0, metal: 0 }, a.m.clone().multiply(wm));
  }
  // Blind end (-X): corrugated. Door end (+X): two leaves with locking bars.
  a.hard(corrugated(W - 0.24, wallH, 0.28, 0.04), { ...body, open: true }, T(-L / 2 + 0.06, wallY, 0, 0, -Math.PI / 2, 0));
  const leafW = W / 2 - 0.12 + 0.035; // from the centre seam into the corner post
  const seam = 0.004;
  for (const s of [-1, 1]) {
    const lz = s * (seam + leafW / 2);
    a.hard(rbox(0.06, wallH + 0.04, leafW, 0.012), body, T(L / 2 - 0.04, wallY, lz));
    for (const b of [0.18, 0.5]) {
      const z = s * (W / 4 - 0.04) + (b - 0.34) * (W / 2 - 0.2);
      a.small(cyl(0.022, 0.022, H - 0.35, 6), metal('#5a5d60', 0.35), T(L / 2 + 0.01, H / 2, z));
      a.small(rbox(0.05, 0.05, 0.22, 0.01), metal('#5a5d60', 0.35), T(L / 2 + 0.03, H * 0.42, z - 0.1));
    }
    for (const y of [0.45, H / 2, H - 0.45]) a.small(rbox(0.06, 0.12, 0.1, 0.01), metal('#3a3632'), T(L / 2 + 0.02, y, s * (W / 2 - 0.14)));
  }
  // Data plate painted on the right-hand door (behind the locking bars).
  addDecal(a.kit, atlas, 'GROSS', 0.75, '#e2ddd0', a.m.clone().multiply(T(L / 2 - 0.01 + 0.004, H * 0.72, seam + leafW / 2, 0, Math.PI / 2, 0)));
  if (c.y === 0) {
    dustMound(a, L / 2 - 0.5, W / 2 + 0.1, 0.9, 0.14, c.x);
    dustMound(a, -L / 2 + 0.6, -W / 2 - 0.1, 1.0, 0.16, c.z);
  }
}

// ---- crates and drums ----------------------------------------------------------------------------

function buildCrates(world: Asm, heightAt: HeightFn): void {
  for (const c of CRATES) {
    const a = world.sub(TY(c.x, heightAt(c.x, c.z) + c.y, c.z, c.yaw));
    if (c.kind === 'drum') {
      const r = 0.3;
      a.hard(lathe([[0, 0], [r - 0.02, 0], [r, 0.03], [r, 0.12], [r + 0.015, 0.14], [r, 0.16], [r, c.h * 0.5 - 0.02], [r + 0.015, c.h * 0.5], [r, c.h * 0.5 + 0.02], [r, c.h - 0.16], [r + 0.015, c.h - 0.14], [r, c.h - 0.12], [r, c.h - 0.03], [r - 0.02, c.h], [0, c.h]], 18), { color: c.color, metal: 0.3, rough: 0.55, panel: 0.4 });
      a.small(bcyl(0.04, 0.03, 8), metal('#555'), T(0.15, c.h + 0.01, 0.05));
      continue;
    }
    a.hard(rbox(c.w, c.h, c.d, Math.min(c.w, c.h, c.d) * 0.08, 2), { color: c.color, metal: 0.15, rough: 0.6, panel: 0.8 }, T(0, c.h / 2, 0));
    if (c.kind === 'crate') {
      for (const x of [-c.w * 0.3, c.w * 0.3]) a.small(rbox(0.07, c.h + 0.02, c.d + 0.02, 0.01), plain('#1c1c1c', 0.7), T(x, c.h / 2, 0));
      for (const s of [-1, 1]) a.small(rbox(0.12, 0.08, 0.04, 0.01), metal('#6a6d70'), T(0, c.h * 0.7, s * (c.d / 2 + 0.01)));
    } else {
      for (const x of [-c.w * 0.36, 0, c.w * 0.36]) a.small(rbox(0.04, c.h + 0.015, c.d + 0.015, 0.01), { color: c.color, metal: 0.1, rough: 0.55, panel: 0.5 }, T(x, c.h / 2, 0));
      a.small(rbox(0.22, 0.04, 0.05, 0.01), plain('#1c1c1c', 0.6), T(0, c.h + 0.02, 0));
    }
  }
}

// ---- rover -----------------------------------------------------------------------------------------

function buildRover(world: Asm, glows: GlowSet, heightAt: HeightFn): void {
  const a = world.sub(TY(ROVER.x, heightAt(ROVER.x, ROVER.z), ROVER.z, ROVER.yaw));
  // local: +Z = rear, -Z = front, X = width.
  const body = { color: '#c79a22', metal: 0.12, rough: 0.5, panel: 1 };
  const wr = 0.58;
  for (const z of [-2.05, 0, 2.05]) {
    for (const s of [-1, 1]) {
      const w = a.sub(T(s * 1.32, wr - 0.03, z, 0, 0, Math.PI / 2));
      w.hard(lathe([[0, -0.24], [0.48, -0.24], [wr - 0.02, -0.2], [wr, -0.12], [wr, 0.12], [wr - 0.02, 0.2], [0.48, 0.24], [0, 0.24]], 28), plain(RUBBER, 0.85));
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        w.small(rbox(0.1, 0.42, 0.06, 0.015), plain(RUBBER, 0.85), T(Math.cos(ang) * (wr + 0.02), 0, Math.sin(ang) * (wr + 0.02), 0, -ang, 0));
      }
      w.hard(bcyl(0.32, 0.5, 16), metal('#4a4d52', 0.4), T(0, s * 0.02, 0));
      w.small(bcyl(0.12, 0.56, 10), metal('#2b2e33'), T(0, s * 0.02, 0));
      // Swing arm and damper to the chassis.
      a.small(strut(new Vector3(s * 1.05, wr, z), new Vector3(s * 0.75, 0.95, z - 0.35), 0.07, 6), metal());
      a.small(strut(new Vector3(s * 1.05, wr + 0.1, z + 0.2), new Vector3(s * 0.8, 1.25, z + 0.35), 0.05, 6), metal('#8a8c8e'));
    }
  }
  // Chassis, fenders, cabin, bed.
  a.hard(rbox(1.9, 0.42, 5.9, 0.06), metal(GUN), T(0, 0.98, 0));
  for (const z of [-2.05, 0, 2.05]) for (const s of [-1, 1]) a.hard(rbox(0.55, 0.06, 1.35, 0.02), metal('#2b2e33'), T(s * 1.3, 1.24, z, 0, 0, s * 0.1));
  const cabin = extrude(
    [
      [-2.95, 1.15],
      [-2.95, 1.75],
      [-2.45, 2.75],
      [-0.3, 2.85],
      [-0.2, 1.15],
    ],
    2.5,
    0.12,
    2,
  );
  cabin.rotateY(-Math.PI / 2);
  a.hard(cabin, body);
  // Windshield and side windows (dark glass).
  const glassS = { color: '#0c1014', rough: 0.06, metal: 0.3, panel: 0 };
  {
    const p = new Vector3(0, 2.25, -2.7);
    const n = new Vector3(0, 0.5, -1).normalize();
    a.small(rbox(2.1, 0.95, 0.04, 0.05), glassS, facing(p.addScaledVector(n, 0.14), n));
    for (const s of [-1, 1]) a.small(rbox(0.04, 0.62, 1.4, 0.04), glassS, T(s * 1.265, 2.25, -1.25));
  }
  a.hard(rbox(2.6, 0.32, 0.4, 0.06), metal(GUN), T(0, 1.15, -3.05));
  for (const s of [-1, 1]) {
    a.small(rbox(0.32, 0.14, 0.06, 0.02), { color: '#e8eef5', rough: 0.2, panel: 0, glow: 0.4 }, T(s * 0.85, 1.55, -2.98));
  }
  a.hard(rbox(2.5, 0.12, 2.9, 0.03), metal('#4a4d52'), T(0, 1.25, 1.45));
  for (const s of [-1, 1]) a.hard(rbox(0.08, 0.45, 2.9, 0.02), body, T(s * 1.2, 1.5, 1.45));
  // Roll cage and roof light bar.
  for (const s of [-1, 1]) a.small(tube([new Vector3(s * 1.1, 1.3, 0.1), new Vector3(s * 1.1, 2.4, 0.15), new Vector3(s * 0.9, 2.55, 0.3)], 0.045, 10, 6), metal('#3a3d42'));
  a.small(strut(new Vector3(-0.9, 2.55, 0.3), new Vector3(0.9, 2.55, 0.3), 0.045, 6), metal('#3a3d42'));
  a.hard(rbox(1.7, 0.14, 0.3, 0.04), metal(GUN), T(0, 3.06, -1.5));
  for (let k = 0; k < 4; k++) a.small(rbox(0.28, 0.1, 0.04, 0.02), { color: '#e8eef5', rough: 0.2, panel: 0, glow: 0 }, T(-0.6 + k * 0.4, 3.06, -1.66));
  a.small(cyl(0.1, 0.12, 0.16, 10), { color: '#ffa020', rough: 0.2, panel: 0, glow: 1.2 }, T(0.7, 3.06, -0.6));
  glows.add(a.pt(0.7, 3.2, -0.6), '#ffa020', 6, 0.5, GlowMode.Beacon, 0.2, 1.5);
  a.small(cyl(0.012, 0.02, 1.8, 6), plain('#202020', 0.4), T(-0.9, 3.85, -0.7));
  // Bed cargo: gas bottles, winch, toolbox, drill rig.
  for (let k = 0; k < 4; k++) a.hard(bcyl(0.16, 1.1, 12), { color: k % 2 ? '#3d6b4a' : '#8d8a80', metal: 0.4, rough: 0.45, panel: 0.3 }, T(-0.75 + k * 0.36, 1.86, 2.6));
  a.small(strut(new Vector3(-1.0, 2.2, 2.6), new Vector3(0.45, 2.2, 2.6), 0.03, 5), metal('#222'));
  a.hard(bcyl(0.32, 0.9, 16), metal('#3a3d42'), T(0.55, 1.68, 0.9, 0, 0, Math.PI / 2));
  a.hard(rbox(0.9, 0.45, 0.55, 0.04), { color: '#9b2a14', metal: 0.2, rough: 0.5, panel: 0.8 }, T(-0.6, 1.53, 0.9));
  a.hard(rbox(0.3, 1.9, 0.3, 0.04), metal('#5a5d60'), T(0.75, 2.25, 2.0));
  a.small(strut(new Vector3(0.75, 3.2, 2.0), new Vector3(0.75, 1.35, 3.0), 0.04, 6), metal('#5a5d60'));
  dustMound(a, 1.4, -2.05, 0.8, 0.1, 4.1);
  dustMound(a, -1.4, 2.05, 0.8, 0.12, 2.7);
}

// ---- floodlights -----------------------------------------------------------------------------------

function buildFloodlights(world: Asm, glows: GlowSet, cones: ConeSet, heightAt: HeightFn): OutpostBuild['spots'] {
  const spots: OutpostBuild['spots'] = [];
  for (const f of FLOODLIGHTS) {
    const gy = heightAt(f.x, f.z);
    const aim = new Vector3(f.aimX, heightAt(f.aimX, f.aimZ), f.aimZ);
    const yaw = Math.atan2(f.aimX - f.x, f.aimZ - f.z);
    const a = world.sub(TY(f.x, gy, f.z, yaw));
    a.hard(rbox(0.9, 0.12, 0.9, 0.03), plain('#6d6a64', 0.9), T(0, 0.04, 0));
    for (const [x, z] of [
      [-0.32, -0.32],
      [0.32, -0.32],
      [-0.32, 0.32],
      [0.32, 0.32],
    ])
      a.small(bcyl(0.035, 0.06, 6), metal('#555'), T(x, 0.12, z));
    // Pole: closed (capped) taper with a cap plate on top.
    a.hard(lathe([[0, 0], [0.17, 0], [0.15, 0.25], [0.11, f.height], [0, f.height]], 12), paint('#8a8c8e', 0.45));
    a.small(bcyl(0.14, 0.05, 12), metal(), T(0, f.height + 0.075, 0));
    a.hard(rbox(0.45, 0.6, 0.3, 0.04), paint(WHITE2), T(0, 1.2, -0.2));
    a.hard(rbox(2.4, 0.12, 0.14, 0.03), metal(), T(0, f.height, 0.06));
    const lamps = [-0.8, 0, 0.8];
    lamps.forEach((lx, i) => {
      const lp = a.pt(lx, f.height - 0.2, 0.32);
      const dir = aim.clone().add(new Vector3(lx * 1.6, 0, 0)).sub(lp).normalize();
      const m = facing(lp, dir);
      world.hard(rbox(0.6, 0.42, 0.26, 0.05), metal(GUN), m);
      const dead = f.deadLamp === i;
      world.small(rbox(0.5, 0.33, 0.04, 0.03), { color: dead ? '#30302e' : '#dbe8ff', rough: 0.2, panel: 0, glow: dead ? 0 : 7 }, m.clone().multiply(T(0, 0, 0.13)));
      for (let k = 0; k < 4; k++) world.small(rbox(0.6, 0.02, 0.12, 0.005), metal(GUN), m.clone().multiply(T(0, -0.15 + k * 0.1, -0.16)));
      // Yoke: two arms from the cross-bar down to pivot bosses on the housing's flanks.
      const right = new Vector3(1, 0, 0).transformDirection(m);
      for (const s of [-1, 1]) {
        const pivot = lp.clone().addScaledVector(right, s * 0.33);
        world.small(strut(a.pt(lx + s * 0.33, f.height - 0.02, 0.1), pivot, 0.028, 6), metal());
        world.small(bcyl(0.055, 0.06, 10), metal(GUN), facing(pivot, right.clone().multiplyScalar(s)).multiply(T(0, 0, -0.01, Math.PI / 2, 0, 0)));
      }
      if (dead) return;
      const front = lp.clone().addScaledVector(dir, 0.2);
      glows.add(front, '#d8e6ff', 8, 0.55, GlowMode.Steady, i * 0.3, 1.5);
      const far = lp.clone().addScaledVector(dir, lp.distanceTo(aim) * 1.05);
      cones.add(front, far, 0.24, 3.1);
    });
    if (f.realLight) spots.push({ pos: a.pt(0, f.height - 0.25, 0.4), target: aim });
    // Cable down the pole into the junction box.
    a.small(tube([new Vector3(0.12, f.height - 0.1, 0.1), new Vector3(0.16, f.height * 0.5, 0.12), new Vector3(0.12, 1.5, -0.1)], 0.025, 10, 4), plain(RUBBER, 0.7));
  }
  return spots;
}

// ---- sign ------------------------------------------------------------------------------------------

function buildSign(world: Asm, atlas: DecalAtlas, heightAt: HeightFn): void {
  const a = world.sub(TY(SIGN.x, heightAt(SIGN.x, SIGN.z), SIGN.z, SIGN.yaw));
  for (const s of [-1, 1]) {
    a.hard(rbox(0.14, 2.7, 0.14, 0.02), metal('#5a5d60'), T(s * 1.9, 1.35, 0));
    a.small(rbox(0.4, 0.1, 0.4, 0.02), plain('#6d6a64', 0.9), T(s * 1.9, 0.03, 0));
  }
  a.hard(rbox(4.3, 1.32, 0.08, 0.02), paint('#2b2e33', 0.55), T(0, 2.0, 0.08));
  a.small(rbox(4.3, 0.12, 0.085, 0.01), plain(YEL, 0.5), T(0, 1.28, 0.08));
  addDecal(a.kit, atlas, 'SIGN', 4.0, '#d8d4c8', a.m.clone().multiply(T(0, 2.02, 0.125)));
  a.small(rbox(0.5, 0.08, 0.2, 0.02), metal(GUN), T(0, 2.74, 0.25));
}

// ---- cables ------------------------------------------------------------------------------------------

/**
 * A cable lying on the ground from `from` to `to`, wandering a little. Ends that are raised (a
 * plug on a box, a junction on a pole) drop straight down to the ground right next to their
 * socket, so the cable never hangs across a walkway at knee height.
 */
function groundCable(world: Asm, from: Vector3, to: Vector3, heightAt: HeightFn, r: number, seed: number): void {
  const flatFrom = from.clone().setY(0);
  const flatTo = to.clone().setY(0);
  const len = flatFrom.distanceTo(flatTo);
  const dir = flatTo.clone().sub(flatFrom).normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  const onGround = (p: Vector3) => p.setY(heightAt(p.x, p.z) + r * 0.8);
  const pts: Vector3[] = [from.clone()];
  const rise = (p: Vector3) => p.y - heightAt(p.x, p.z) > 0.15;
  if (rise(from)) pts.push(onGround(from.clone().addScaledVector(dir, 0.18)));
  const n = Math.max(4, Math.round(len / 1.4));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = flatFrom.clone().lerp(flatTo, t);
    const wig = (fbm2(t * len * 0.35, seed, 3, 5) - 0.5) * Math.min(2.2, len * 0.12);
    p.addScaledVector(side, wig * Math.sin(Math.PI * t));
    pts.push(onGround(p));
  }
  if (rise(to)) pts.push(onGround(to.clone().addScaledVector(dir, -0.18)));
  pts.push(to.clone());
  world.small(tube(pts, r, n * 6 + 8, 5), plain(RUBBER, 0.7));
}

function buildCables(world: Asm, heightAt: HeightFn): void {
  const g = (x: number, z: number, y = 0.06) => new Vector3(x, heightAt(x, z) + y, z);
  const hab1 = HABS[0];
  const lab = HABS[1];
  const panels = solarPanels();
  const sk = lab.radius * 0.64; // skid offset from the hull axis
  // Solar → LAB-2 (north skid) and mast cabinet → LAB-2 (south skid), into junction boxes.
  groundCable(world, g(panels[0].x + 0.4, panels[0].z, 0.3), g(lab.x - 2.5, lab.z - sk - 0.18, 0.2), heightAt, 0.05, 1);
  groundCable(world, g(MAST_CABINET.x, MAST_CABINET.z + 0.4, 0.3), g(lab.x + 1.0, lab.z + sk + 0.18, 0.2), heightAt, 0.045, 2);
  for (const [x, s] of [
    [lab.x - 2.5, -1],
    [lab.x + 1.0, 1],
  ])
    world.small(rbox(0.3, 0.22, 0.14, 0.03), metal('#4a4d52'), T(x, heightAt(x, lab.z) + 0.2, lab.z + s * (sk + 0.2)));
  // HAB-1 → floodlight 1 → pad pedestal.
  const f1 = FLOODLIGHTS[0];
  groundCable(world, g(hab1.x + hab1.radius * 0.7, hab1.z - 3.5, 0.6), g(f1.x - 0.2, f1.z - 0.25, 1.0), heightAt, 0.045, 3);
  groundCable(world, g(f1.x + 0.3, f1.z + 0.1, 0.4), g(PEDESTAL.x - 0.3, PEDESTAL.z, 0.5), heightAt, 0.055, 4);
  // HAB-1 → sign lamp / rover charger past the containers.
  groundCable(world, g(hab1.x + 1.2, hab1.z + hab1.length / 2 - 0.6, 0.2), g(-9.5, 20.45, 0.3), heightAt, 0.04, 5);
  // Fuel farm → pad edge.
  const t = TANKS[0];
  groundCable(world, g(t.x - t.length * 0.45 + 0.15, t.z + 0.6, 0.1), g(18.5, -5.6, 0.08), heightAt, 0.06, 6);
  // Floodlight 2 feed.
  const f2 = FLOODLIGHTS[1];
  groundCable(world, g(f2.x, f2.z - 0.4, 0.4), g(25.5, 8, 0.05), heightAt, 0.04, 7);

  // Ground power pedestal and the umbilical over to the Wren's flank.
  const pa = world.sub(TY(PEDESTAL.x, heightAt(PEDESTAL.x, PEDESTAL.z), PEDESTAL.z, PEDESTAL_YAW));
  pa.hard(rbox(0.75, 1.1, 0.55, 0.05), paint('#c3bfb4'), T(0, 0.55, 0));
  pa.small(rbox(0.8, 0.12, 0.6, 0.02), plain(YEL, 0.5), T(0, 1.12, 0));
  pa.small(rbox(0.1, 0.06, 0.03, 0.01), { color: '#3aff6a', rough: 0.3, panel: 0, glow: 3 }, T(0.2, 0.9, 0.29));
  pa.hard(bcyl(0.32, 0.25, 16), metal(GUN), T(0, 0.75, -0.42, Math.PI / 2, 0, 0));
  // Cable gland on the cabinet front where the umbilical leaves it.
  pa.small(bcyl(0.1, 0.1, 12), metal(GUN), T(0, 1.0, 0.3, Math.PI / 2, 0, 0));
  const path = umbilicalPath().map((p) => p.clone().setY(p.y + heightAt(p.x, p.z)));
  world.small(tube(path, 0.07, 60, 6), plain('#2a2a2a', 0.65));
}

// ---- ground clutter ---------------------------------------------------------------------------------

function buildClutter(world: Asm, heightAt: HeightFn): void {
  // Cargo trolley parked on the pad with two strapped crates.
  {
    const a = world.sub(TY(TROLLEY.x, heightAt(TROLLEY.x, TROLLEY.z) + PAD_TOP, TROLLEY.z, TROLLEY.yaw));
    a.hard(rbox(1.4, 0.1, 2.5, 0.03), metal('#4a4d52'), T(0, 0.42, 0));
    a.small(rbox(1.5, 0.12, 0.08, 0.02), plain(YEL, 0.5), T(0, 0.42, 1.27));
    a.small(rbox(1.5, 0.12, 0.08, 0.02), plain(YEL, 0.5), T(0, 0.42, -1.27));
    for (const x of [-0.6, 0.6])
      for (const z of [-0.95, 0.95]) {
        a.small(bcyl(0.17, 0.12, 14), plain(RUBBER, 0.85), T(x, 0.17, z, 0, 0, Math.PI / 2));
        a.small(rbox(0.06, 0.25, 0.08, 0.01), metal(), T(x * 0.9, 0.3, z));
      }
    a.small(strut(new Vector3(0, 0.38, -1.3), new Vector3(0, 0.12, -2.3), 0.035, 6), metal(GUN));
    a.small(bcyl(0.08, 0.04, 10), metal(GUN), T(0, 0.1, -2.32));
    a.hard(rbox(1.2, 0.8, 1.0, 0.05, 2), { color: '#566466', metal: 0.15, rough: 0.6, panel: 0.8 }, T(0, 0.87, 0.55));
    a.hard(rbox(1.0, 0.55, 0.85, 0.05, 2), { color: '#6b6248', metal: 0.15, rough: 0.6, panel: 0.8 }, T(0.05, 0.75, -0.6, 0, 0.12, 0));
    a.small(rbox(1.26, 0.04, 0.06, 0.01), plain('#c46a1a', 0.8), T(0, 1.28, 0.55));
  }
  // Fuel hose reel cart.
  {
    const a = world.sub(TY(REEL_CART.x, heightAt(REEL_CART.x, REEL_CART.z), REEL_CART.z, REEL_CART.yaw));
    a.hard(rbox(1.5, 0.12, 1.0, 0.03), metal('#4a4d52'), T(0, 0.35, 0));
    for (const s of [-1, 1]) {
      a.small(bcyl(0.2, 0.12, 14), plain(RUBBER, 0.85), T(s * 0.62, 0.2, 0, 0, 0, Math.PI / 2));
      a.hard(rbox(0.08, 0.9, 0.5, 0.02), paint('#c79a22'), T(s * 0.55, 0.8, 0));
    }
    a.hard(bcyl(0.48, 0.95, 20), plain('#1d1d1d', 0.7), T(0, 0.98, 0, 0, 0, Math.PI / 2));
    a.small(bcyl(0.56, 0.04, 20), paint('#c79a22'), T(0.5, 0.98, 0, 0, 0, Math.PI / 2));
    a.small(bcyl(0.56, 0.04, 20), paint('#c79a22'), T(-0.5, 0.98, 0, 0, 0, Math.PI / 2));
    a.small(tube([new Vector3(0, 1.3, 0.35), new Vector3(0.2, 0.4, 0.9), new Vector3(0.6, 0.05, 1.6), new Vector3(1.8, 0.05, 2.4)], 0.05, 20, 5), plain(RUBBER, 0.7));
  }
  // Tarp-covered pile of supplies, roped down.
  {
    const a = world.sub(TY(TARP.x, heightAt(TARP.x, TARP.z), TARP.z, TARP.yaw));
    const g = paramSurface(
      (u, v, out) => {
        const ang = v * Math.PI * 2;
        const n = fbm2(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 + u * 3, 3, 21);
        const rr = 1 - u * u;
        const boxy = Math.pow(Math.abs(Math.cos(ang)), 0.3) * Math.sign(Math.cos(ang));
        const boxz = Math.pow(Math.abs(Math.sin(ang)), 0.3) * Math.sign(Math.sin(ang));
        out.set(boxy * 1.6 * Math.sqrt(rr) * (0.92 + 0.12 * n), 1.25 * u * (0.9 + 0.2 * n) - 0.04 * (1 - u), boxz * 1.2 * Math.sqrt(rr) * (0.92 + 0.12 * n));
      },
      8,
      28,
      { flip: true },
    );
    a.hard(g, { color: '#4a4f3e', metal: 0, rough: 0.9, panel: 0, open: true });
    for (const x of [-0.8, 0.1, 0.9]) a.small(tube([new Vector3(x, 0.02, -1.35), new Vector3(x, 1.0, -0.8), new Vector3(x, 1.27, 0), new Vector3(x, 1.0, 0.8), new Vector3(x, 0.02, 1.35)], 0.02, 16, 4), plain('#b8a37a', 0.8));
    dustMound(a, 1.5, 0.6, 0.8, 0.12, 5.5);
  }
  // Survey stakes with orange tips along the lane north.
  for (const p of laneStakes()) {
    const y = heightAt(p.x, p.z);
    world.small(cyl(0.025, 0.03, 1.5, 6), plain('#8a8c8e', 0.5), T(p.x, y + 0.75, p.z));
    world.small(rbox(0.06, 0.25, 0.06, 0.01), { color: '#ff7a1a', rough: 0.4, panel: 0, glow: 0.6 }, T(p.x, y + 1.45, p.z));
  }
}

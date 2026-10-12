import { Box3, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { Avatar } from '../../src/characters';
import { DIM } from '../../src/characters/rig';

const WALK = 5.2;
const SPRINT = 8.4;

function finiteTransforms(o: Object3D): boolean {
  let ok = true;
  o.traverse((c) => {
    for (const n of [...c.position.toArray(), ...c.quaternion.toArray(), ...c.scale.toArray()]) if (!Number.isFinite(n)) ok = false;
    for (const n of c.matrixWorld.elements) if (!Number.isFinite(n)) ok = false;
  });
  return ok;
}

/** World-space soles of both boots: heel and toe points on the bottom of the tread. */
function soles(a: Avatar): { heel: Vector3; toe: Vector3 }[] {
  a.root.updateMatrixWorld(true);
  return [a.bones.footL, a.bones.footR].map((f) => ({
    heel: new Vector3(0, -DIM.ankleY, DIM.heelZ + 0.006).applyMatrix4(f.matrixWorld),
    toe: new Vector3(0, -DIM.ankleY, DIM.toeZ - 0.012).applyMatrix4(f.matrixWorld),
  }));
}

describe('Avatar', () => {
  it('keeps the public API and stays within budget', () => {
    for (const role of ['vanguard', 'tether'] as const) {
      const a = new Avatar(role);
      expect(a.role).toBe(role);
      expect(a.root.children.length).toBeGreaterThan(0);
      expect(a.triangles).toBeLessThanOrEqual(25_000);
      let meshes = 0;
      a.root.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) meshes++;
      });
      expect(meshes).toBeLessThanOrEqual(25);
    }
  });

  it('is 1.8 m tall standing', () => {
    const a = new Avatar('vanguard');
    for (let i = 0; i < 30; i++) a.animate(new Vector3(), 0, 0, 1 / 60);
    a.root.updateMatrixWorld(true);
    const head = new Vector3(0, 1.812 - 1.535, 0.012).applyMatrix4(a.bones.head.matrixWorld);
    expect(head.y).toBeGreaterThan(1.74);
    expect(head.y).toBeLessThan(1.84);
  });

  it('never produces NaN transforms over speeds and time steps', () => {
    const a = new Avatar('tether');
    const pos = new Vector3(3, 0.5, -2);
    const dts = [0, 1 / 240, 1 / 60, 1 / 30, 0.1, 0.5, 2, -1, Number.NaN];
    const speeds = [0, 0.05, 0.5, 1.4, 2.2, WALK, 6.5, SPRINT, 12, 40, -3, Number.NaN, Infinity];
    let yaw = 0;
    for (const dt of dts) {
      for (const sp of speeds) {
        for (let k = 0; k < 20; k++) {
          yaw += 0.37 * (k % 3 === 0 ? -1 : 1);
          a.animate(pos, yaw, sp, dt);
        }
        a.root.updateMatrixWorld(true);
        expect(finiteTransforms(a.root), `dt=${dt} speed=${sp}`).toBe(true);
      }
    }
    // Recovers to a sane pose after garbage input.
    for (let i = 0; i < 120; i++) a.animate(pos, 1, 0, 1 / 60);
    a.root.updateMatrixWorld(true);
    expect(finiteTransforms(a.root)).toBe(true);
  });

  it('root follows the given position and yaw', () => {
    const a = new Avatar('vanguard');
    const p = new Vector3(12.5, 3.25, -7);
    a.animate(p, 1.2, WALK, 1 / 60);
    expect(a.root.position.distanceTo(p)).toBeLessThan(1e-9);
    expect(a.root.rotation.y).toBeCloseTo(1.2, 9);
    // Facing: the pelvis forward axis points along (sin yaw, 0, cos yaw).
    a.root.updateMatrixWorld(true);
    const fwd = new Vector3(0, 0, 1).transformDirection(a.root.matrixWorld);
    expect(fwd.x).toBeCloseTo(Math.sin(1.2), 6);
    expect(fwd.z).toBeCloseTo(Math.cos(1.2), 6);
  });

  for (const [label, speed] of [
    ['walk', 1.4],
    ['lope', WALK],
    ['sprint', SPRINT],
  ] as const) {
    it(`keeps feet on the ground during a ${label} cycle`, () => {
      const a = new Avatar('tether');
      const ground = 2.0;
      const pos = new Vector3(0, ground, 0);
      const dt = 1 / 120;
      for (let i = 0; i < 240; i++) {
        pos.z += speed * dt;
        a.animate(pos, 0, speed, dt);
      }
      let minLow = Infinity;
      let maxLowest = -Infinity;
      const plantedSlide: number[] = [];
      const prev: ({ p: Vector3; toe: boolean } | null)[] = [null, null];
      for (let i = 0; i < 360; i++) {
        pos.z += speed * dt;
        a.animate(pos, 0, speed, dt);
        const s = soles(a);
        const lows = s.map((f) => Math.min(f.heel.y, f.toe.y));
        const lowest = Math.min(...lows);
        minLow = Math.min(minLow, lowest);
        maxLowest = Math.max(maxLowest, lowest);
        // Planted feet must not slide along the ground.
        for (let k = 0; k < 2; k++) {
          const f = a.feet[k];
          const toe = f.pitch >= 0;
          const contact = toe ? s[k].toe : s[k].heel;
          const last = prev[k];
          if (f.planted > 0.99 && last && last.toe === toe) plantedSlide.push(contact.distanceTo(last.p));
          prev[k] = f.planted > 0.99 ? { p: contact.clone(), toe } : null;
        }
      }
      // Never through the ground...
      expect(minLow).toBeGreaterThan(ground - 0.012);
      if (speed < 2) {
        // ...and when walking, always one boot on it.
        expect(maxLowest).toBeLessThan(ground + 0.015);
      } else {
        // When running there is a flight phase, but feet come back down to the ground.
        expect(maxLowest).toBeLessThan(ground + 0.3);
      }
      expect(plantedSlide.length).toBeGreaterThan(10);
      const maxSlide = Math.max(...plantedSlide);
      expect(maxSlide).toBeLessThan(0.012);
    });
  }

  it('stands with both boots flat on the ground when idle', () => {
    const a = new Avatar('vanguard');
    const pos = new Vector3(1, -0.5, 1);
    for (let i = 0; i < 600; i++) {
      a.animate(pos, 0.3, 0, 1 / 60);
      if (i % 50 === 0) {
        for (const f of soles(a)) {
          expect(Math.abs(f.heel.y - pos.y)).toBeLessThan(0.01);
          expect(Math.abs(f.toe.y - pos.y)).toBeLessThan(0.01);
        }
      }
    }
  });

  /** Head position in the character's own frame (x = its left, z = forward). */
  function headLocal(a: Avatar): Vector3 {
    a.root.updateMatrixWorld(true);
    const w = new Vector3().setFromMatrixPosition(a.bones.head.matrixWorld);
    return a.root.worldToLocal(w);
  }

  it('leans into turns', () => {
    for (const dir of [1, -1]) {
      const a = new Avatar('vanguard');
      let yaw = 0;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 240; i++) {
        yaw += dir * 1.2 * (1 / 60);
        a.animate(new Vector3(), yaw, WALK, 1 / 60);
        if (i > 120) {
          sum += headLocal(a).x;
          n++;
        }
      }
      // A left turn (yaw increasing) tilts the body toward its left (+X), and vice versa.
      expect(dir * (sum / n)).toBeGreaterThan(0.06);
    }
  });

  it('leans forward when accelerating and back when stopping', () => {
    const a = new Avatar('tether');
    for (let i = 0; i < 60; i++) a.animate(new Vector3(), 0, 0, 1 / 60);
    const rest = headLocal(a).z;
    let speed = 0;
    let maxAccel = -Infinity;
    for (let i = 0; i < 30; i++) {
      speed = Math.min(WALK, speed + 38 / 60);
      a.animate(new Vector3(), 0, speed, 1 / 60);
      maxAccel = Math.max(maxAccel, headLocal(a).z);
    }
    let steady = 0;
    for (let i = 0; i < 120; i++) {
      a.animate(new Vector3(), 0, WALK, 1 / 60);
      steady += headLocal(a).z / 120;
    }
    let minStop = Infinity;
    for (let i = 0; i < 30; i++) {
      speed *= Math.exp(-12 / 60);
      a.animate(new Vector3(), 0, speed, 1 / 60);
      minStop = Math.min(minStop, headLocal(a).z);
    }
    expect(steady).toBeGreaterThan(rest + 0.05); // running leans forward
    expect(maxAccel).toBeGreaterThan(steady + 0.03); // pushing off leans further
    expect(minStop).toBeLessThan(steady - 0.08); // braking rocks back
  });

  it('decelerates smoothly to idle without popping', () => {
    const a = new Avatar('tether');
    const pos = new Vector3();
    let speed = WALK;
    let prevPelvis: Vector3 | null = null;
    let maxJump = 0;
    for (let i = 0; i < 240; i++) {
      if (i > 60) speed *= Math.exp(-12 / 60);
      pos.z += (speed / 60);
      a.animate(pos, 0, speed, 1 / 60);
      a.root.updateMatrixWorld(true);
      const p = new Vector3().setFromMatrixPosition(a.bones.pelvis.matrixWorld).sub(pos);
      if (prevPelvis) maxJump = Math.max(maxJump, p.distanceTo(prevPelvis));
      prevPelvis = p;
    }
    expect(maxJump).toBeLessThan(0.04);
    // Ends upright and still.
    const box = new Box3().setFromObject(a.visor);
    expect(box.max.y).toBeGreaterThan(1.6);
  });
});

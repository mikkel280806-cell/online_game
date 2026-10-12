// Procedural animation for the EVA suit: idle (breathing, weight shift, look-around),
// walk/lope/sprint driven by speed, leaning into turns and acceleration, springy secondary
// motion on the backpack and antenna.
//
// Everything is a continuous function of a smoothed speed, so there are no states to blend:
// cadence and stance length are chosen so that cadence x stride = speed (no foot sliding),
// planted feet are solved with two-bone IK onto the ground, and boots roll heel-to-toe
// around their real heel/toe pivots. Above ~1.7 m/s the duty factor drops below 0.5 and a
// flight phase appears: a loping run with a touch of low-gravity hang time.

import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { DIM, JOINTS, type Bones } from './rig';

const TAU = Math.PI * 2;
const clamp = MathUtils.clamp;
const lerp = MathUtils.lerp;
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (cur: number, target: number, lambda: number, dt: number) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const fract = (x: number) => x - Math.floor(x);

/** Small deterministic PRNG so look-dev shots are repeatable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scratch objects.
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _m = new Matrix4();
const _Y = new Vector3(0, 1, 0);
const _X = new Vector3(1, 0, 0);

interface Spring {
  x: number;
  v: number;
}
function stepSpring(s: Spring, target: number, omega: number, zeta: number, dt: number): void {
  // Semi-implicit Euler, sub-stepped for stability.
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = omega * omega * (target - s.x) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

export interface FootState {
  /** Ground anchor (root space): the point under the ankle when the boot is flat. */
  anchor: Vector3;
  /** 0 in the air, 1 planted. */
  planted: number;
  /** Boot pitch (positive = toes down). */
  pitch: number;
}

/** Drives a rig from (yaw, speed, dt). */
export class Locomotion {
  /** Smoothed speed (m/s). */
  speed = 0;
  /** Gait cycle phase in [0, 1); the left foot touches down at 0. */
  phase = 0;
  time = 0;
  readonly feet: [FootState, FootState] = [
    { anchor: new Vector3(), planted: 1, pitch: 0 },
    { anchor: new Vector3(), planted: 1, pitch: 0 },
  ];

  private init = false;
  private lastYaw = 0;
  private lastSpeed = 0;
  private yawRate = 0;
  private accel = 0;
  private exertion = 0;
  private rng: () => number;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookTarget = { yaw: 0, pitch: 0.05 };
  private nextLook = 1.5;
  private gesture = 0;
  private nextGesture: number;
  private gestureUntil = -1;
  private pelvisY = DIM.hipY + 0.03;
  private pelvisVY = 0;
  private vertAccel = 0;
  private pack = { pitch: { x: 0, v: 0 } as Spring, roll: { x: 0, v: 0 } as Spring };
  private antenna = { pitch: { x: 0, v: 0 } as Spring, roll: { x: 0, v: 0 } as Spring };
  private ankles = [new Vector3(), new Vector3()];
  private footQ = [new Quaternion(), new Quaternion()];

  constructor(seed: number) {
    this.rng = mulberry32(seed);
    this.time = this.rng() * 10;
    this.nextGesture = this.time + 12 + this.rng() * 8;
  }

  /** Glance at the wrist computer now (only shows while standing still). */
  triggerGesture(): void {
    this.gestureUntil = this.time + 2.6;
    this.nextGesture = this.time + 14 + this.rng() * 10;
  }

  update(yawIn: number, speedIn: number, dtIn: number, bones: Bones): void {
    const dt = Number.isFinite(dtIn) ? clamp(dtIn, 0, 0.25) : 0;
    const speed = Number.isFinite(speedIn) ? clamp(speedIn, 0, 14) : 0;
    const yaw = Number.isFinite(yawIn) ? yawIn : this.lastYaw;
    if (!this.init) {
      this.init = true;
      this.speed = speed;
      this.lastYaw = yaw;
      this.lastSpeed = speed;
    }

    // ---- state ---------------------------------------------------------------------------
    if (dt > 0) {
      this.time += dt;
      const rawRate = clamp(wrapAngle(yaw - this.lastYaw) / dt, -10, 10);
      this.yawRate = damp(this.yawRate, rawRate, 9, dt);
      const rawAcc = clamp((speed - this.lastSpeed) / dt, -60, 60);
      this.accel = damp(this.accel, rawAcc, 7, dt);
      this.speed = damp(this.speed, speed, 9, dt);
    }
    this.lastYaw = yaw;
    this.lastSpeed = speed;
    const v = this.speed;

    const m = smoothstep(0.12, 1.1, v); // moving
    const r = smoothstep(1.4, 3.4, v); // running style
    const sp = smoothstep(5.6, 8.2, v); // sprinting
    const idle = 1 - m;

    // Gait: cadence (cycles/s) rises with speed; stride = speed / cadence.
    const cadence = 0.85 + 0.11 * v;
    const stride = v / cadence;
    const stanceLen = Math.min(lerp(0.76, 0.9, sp), 0.62 * stride);
    const duty = stride > 1e-4 ? clamp(stanceLen / stride, 0.12, 0.62) : 0.62;
    this.phase = fract(this.phase + cadence * dt);

    this.exertion = clamp(this.exertion + dt * (r * 0.05 + sp * 0.12 - idle * 0.035), 0, 1);

    // ---- idle life -----------------------------------------------------------------------
    const t = this.time;
    const breathRate = lerp(0.24, 0.5, this.exertion);
    const breath = Math.sin(t * TAU * breathRate);
    const breathAmp = 1 + this.exertion * 1.6;
    const shift = (Math.sin((t * TAU) / 7.3) * 0.75 + Math.sin((t * TAU) / 3.1 + 1.3) * 0.25) * idle;

    if (t > this.nextLook) {
      const roll = this.rng();
      if (roll < 0.3) this.lookTarget = { yaw: 0, pitch: 0.04 };
      else this.lookTarget = { yaw: (this.rng() * 2 - 1) * 0.75, pitch: -0.12 + this.rng() * 0.3 };
      this.nextLook = t + 2.2 + this.rng() * 3.8;
    }
    // Occasional glance at the wrist computer while standing.
    if (idle > 0.95 && t > this.nextGesture && this.gestureUntil < t) {
      this.gestureUntil = t + 2.6;
      this.nextGesture = t + 14 + this.rng() * 10;
    }
    const wantGesture = idle > 0.9 && t < this.gestureUntil ? 1 : 0;
    this.gesture = dt > 0 ? damp(this.gesture, wantGesture, 5, dt) : wantGesture * idle;
    const g = this.gesture * idle;

    let tYaw = this.lookTarget.yaw * idle;
    let tPitch = this.lookTarget.pitch * idle;
    tYaw += clamp(this.yawRate * 0.22, -0.55, 0.55) * m;
    tPitch += 0.06 * m;
    tYaw = lerp(tYaw, 0.42, g);
    tPitch = lerp(tPitch, 0.62, g);
    if (dt > 0) {
      this.lookYaw = damp(this.lookYaw, tYaw, 5, dt);
      this.lookPitch = damp(this.lookPitch, tPitch, 5, dt);
    } else {
      this.lookYaw = tYaw;
      this.lookPitch = tPitch;
    }

    // ---- feet ----------------------------------------------------------------------------
    const center = -0.1 * r - 0.05 * sp; // stance centre relative to the hips
    const lift = lerp(0.05 + 0.025 * v, 0.08 + 0.04 * v, r) * m;
    const pitchHS = lerp(-0.3, -0.12, r);
    const pitchTO = lerp(0.42, 0.62, r);
    const pitchMid = lerp(0.12, 0.85, r);
    const footZ: number[] = [0, 0];
    const footLift: number[] = [0, 0];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const ph = fract(this.phase + i * 0.5);
      let z: number;
      let y: number;
      let pitch: number;
      let planted: number;
      if (ph < duty) {
        const s = ph / duty;
        z = center + stanceLen / 2 - stanceLen * s;
        y = 0;
        pitch = pitchHS * (1 - smoothstep(0, lerp(0.2, 0.12, r), s)) + pitchTO * Math.pow(smoothstep(lerp(0.5, 0.42, r), 1, s), 1.5);
        planted = 1;
      } else {
        const s = (ph - duty) / (1 - duty);
        const e = smoothstep(lerp(0, 0.1, r), lerp(1, 0.9, r), s);
        z = center - stanceLen / 2 + stanceLen * e + r * 0.07 * Math.sin(Math.PI * clamp((s - 0.5) / 0.5, 0, 1));
        // Rise fast (heel kick), come down early so the foot skims in for the landing.
        y = lift * Math.pow(Math.sin(Math.PI * Math.pow(s, lerp(1, 0.62, r))), lerp(1, 1.6, r));
        pitch = lerp(pitchTO, pitchMid, smoothstep(0, 0.3, s));
        pitch = lerp(pitch, pitchHS, smoothstep(0.45, 0.97, s));
        planted = 0;
      }
      // Blend to the idle stance.
      const idleZ = 0.015 + (side > 0 ? 0.02 : -0.015);
      const f = this.feet[i];
      f.anchor.set(side * lerp(0.13, lerp(0.125, 0.1, r), m), y * m, lerp(idleZ, z, m));
      f.pitch = pitch * m;
      f.planted = lerp(1, planted, m);
      footZ[i] = z;
      footLift[i] = y;
    }

    // ---- pelvis --------------------------------------------------------------------------
    const stepPhase = fract(this.phase * 2);
    const duty2 = duty * 2;
    let bobRun: number;
    if (duty2 >= 1) bobRun = 0;
    else if (stepPhase < duty2) bobRun = -0.018 * Math.sin((Math.PI * stepPhase) / duty2);
    else bobRun = lerp(0.045, 0.055, sp) * Math.sin((Math.PI * (stepPhase - duty2)) / (1 - duty2));
    const bobWalk = 0.016 * Math.cos(TAU * 2 * (this.phase - duty / 2));
    const bob = lerp(bobWalk, bobRun, r) * m;

    const legDiff = stanceLen > 0 ? clamp((footZ[0] - footZ[1]) / stanceLen, -1.2, 1.2) : 0;
    const pelvisYaw = -lerp(0.09, 0.14, r) * legDiff * m;
    const stanceSide = Math.cos(TAU * (this.phase - duty / 2));
    const pelvisRoll = 0.045 * (1 - 0.6 * r) * stanceSide * m + 0.03 * shift;
    const accelLean = clamp(this.accel * 0.018, -0.2, 0.24);
    const lean = (lerp(0.04, 0.22, r) + 0.12 * sp) * m + accelLean;
    const bank = clamp((v * this.yawRate) / 9.81, -0.4, 0.4) * 0.75;

    const pelvis = bones.pelvis;
    const px = 0.022 * (1 - r) * stanceSide * m + 0.018 * shift + Math.sin(bank) * 0.55;
    const pz = 0.02 * accelLean;
    let py = JOINTS.pelvis.y - lerp(0.012, lerp(0.022, 0.018, r), m) - 0.012 * sp + bob + 0.0025 * breath * breathAmp * idle;
    py -= (1 - Math.cos(bank)) * 0.5;
    pelvis.rotation.set(lean * 0.4, pelvisYaw, pelvisRoll - bank, 'YXZ');
    pelvis.position.set(px, py, pz);
    pelvis.updateMatrix();

    // Feet: ankle positions and boot orientations in root space.
    const ankles = this.ankles;
    const footQ = this.footQ;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const f = this.feet[i];
      const fy = side * lerp(0.1, 0.02, m);
      footQ[i].setFromAxisAngle(_Y, fy).multiply(_q1.setFromAxisAngle(_X, f.pitch));
      // Pivot on the toe (toes down) or the heel (toes up) so the boot never cuts the ground.
      const pivotZ = f.pitch >= 0 ? DIM.toeZ - 0.012 : DIM.heelZ + 0.006;
      _v1.set(0, 0, pivotZ).applyAxisAngle(_Y, fy).add(f.anchor); // pivot on the ground
      _v2.set(0, DIM.ankleY, -pivotZ).applyQuaternion(footQ[i]);
      ankles[i].copy(_v1).add(_v2);
    }

    // Keep the planted feet reachable: lower the pelvis if needed.
    const legMax = (DIM.thigh + DIM.shin) * 0.995;
    for (let i = 0; i < 2; i++) {
      const weight = this.feet[i].planted;
      if (weight < 0.01) continue;
      const hipOff = i === 0 ? _v3.set(DIM.hipX, DIM.hipY - JOINTS.pelvis.y, 0) : _v3.set(-DIM.hipX, DIM.hipY - JOINTS.pelvis.y, 0);
      hipOff.applyQuaternion(pelvis.quaternion);
      const hx = pelvis.position.x + hipOff.x - ankles[i].x;
      const hz = pelvis.position.z + hipOff.z - ankles[i].z;
      const h2 = legMax * legMax - hx * hx - hz * hz;
      const limit = ankles[i].y + Math.sqrt(Math.max(h2, 0.01)) - hipOff.y;
      if (pelvis.position.y > limit) pelvis.position.y = lerp(pelvis.position.y, limit, weight);
    }
    // Track vertical acceleration for secondary motion.
    if (dt > 0) {
      const vy = (pelvis.position.y - this.pelvisY) / dt;
      const ay = clamp((vy - this.pelvisVY) / dt, -60, 60);
      this.vertAccel = damp(this.vertAccel, ay, 18, dt);
      this.pelvisVY = vy;
    }
    this.pelvisY = pelvis.position.y;
    pelvis.updateMatrix();

    // Leg IK.
    const legs = [
      [bones.thighL, bones.shinL, bones.footL],
      [bones.thighR, bones.shinR, bones.footR],
    ] as const;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const [thigh, shin, foot] = legs[i];
      const hip = _v1.copy(thigh.position).applyMatrix4(pelvis.matrix);
      const fy = side * lerp(0.1, 0.02, m);
      const pole = _v2.set(side * 0.12, 0.05, 1).applyAxisAngle(_Y, fy * 0.5).normalize();
      solveTwoBone(hip, ankles[i], pole, DIM.thigh, DIM.shin, _q1, _q2);
      // Root-space -> local.
      thigh.quaternion.copy(pelvis.quaternion).invert().multiply(_q1);
      shin.quaternion.copy(_q1).invert().multiply(_q2);
      foot.quaternion.copy(_q2).invert().multiply(footQ[i]);
    }

    // ---- spine, head ---------------------------------------------------------------------
    const breathe = breath * breathAmp;
    const runBob = (bob / 0.07) * r * m;
    bones.spine.rotation.set(lean * 0.3 - 0.004 * breathe + 0.02 * runBob, -pelvisYaw * 0.55, -pelvisRoll * 0.55 + bank * 0.15, 'YXZ');
    bones.chest.rotation.set(lean * 0.3 - 0.012 * breathe - 0.025 * runBob + 0.08 * g, -pelvisYaw * 0.8 + 0.12 * g, -pelvisRoll * 0.3 + bank * 0.2, 'YXZ');
    const bodyPitch = lean + 0.08 * g;
    const bodyYaw = pelvisYaw * (1 - 0.55 - 0.8) + 0.12 * g;
    const headPitch = this.lookPitch - bodyPitch * 0.6;
    const headYaw = this.lookYaw - bodyYaw;
    const headRoll = bank * 0.35 - pelvisRoll * 0.2;
    bones.neck.rotation.set(headPitch * 0.4, headYaw * 0.4, headRoll * 0.4, 'YXZ');
    bones.head.rotation.set(headPitch * 0.6, headYaw * 0.6, headRoll * 0.6, 'YXZ');

    // ---- arms ----------------------------------------------------------------------------
    const armAmp = m * (lerp(0.3, 0.62, r) + 0.26 * sp);
    const elbowBase = lerp(0.3, lerp(0.42, 0.95, r) + 0.35 * sp, m);
    const arms = [
      [bones.clavL, bones.armL, bones.foreL, bones.handL],
      [bones.clavR, bones.armR, bones.foreR, bones.handR],
    ] as const;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const [clav, arm, fore, hand] = arms[i];
      // Arm swings opposite the leg on the same side, lagging slightly.
      const fwd = -Math.cos(TAU * (fract(this.phase + i * 0.5) - 0.04));
      const swing = armAmp * fwd + 0.06 * r * m;
      const idleSway = 0.02 * Math.sin(t * TAU * 0.21 + i * 1.7) * idle + 0.01 * breathe * idle;
      const gest = i === 0 ? g : 0;
      const abd = 0.17 + 0.04 * r + 0.012 * breathe * idle - 0.02 * shift * side;
      // Upper arm: twist about its own axis first, then abduct, then swing (XZY).
      arm.rotation.set(
        lerp(-swing - idleSway - 0.05, -0.62, gest),
        -side * lerp(0.15 + 0.25 * r * m, 0.95, gest),
        side * lerp(abd, 0.42, gest),
        'XZY',
      );
      const elbow = elbowBase + lerp(0.12, 0.45, r) * Math.max(0, fwd) * m;
      fore.rotation.set(-lerp(elbow, 1.95, gest), -side * lerp(0.2, -0.9, gest), 0, 'XYZ');
      hand.rotation.set(lerp(-0.08 - 0.12 * r * m, 0.15, gest), 0, side * lerp(0.06, 0.0, gest), 'XYZ');
      clav.rotation.set(0, 0, side * (0.01 * breathe * (0.6 + idle) + 0.03 * r * m * Math.max(0, fwd)), 'XYZ');
    }

    // ---- secondary motion ----------------------------------------------------------------
    if (dt > 0) {
      const latAcc = v * this.yawRate;
      stepSpring(this.pack.pitch, clamp(-this.accel * 0.0012 + this.vertAccel * 0.0009, -0.04, 0.04), 22, 0.45, dt);
      stepSpring(this.pack.roll, clamp(latAcc * 0.0015, -0.03, 0.03), 22, 0.45, dt);
      stepSpring(this.antenna.pitch, clamp(-this.accel * 0.012 + this.vertAccel * 0.01 - v * 0.02, -0.5, 0.5), 10, 0.14, dt);
      stepSpring(this.antenna.roll, clamp(latAcc * 0.02, -0.45, 0.45), 10, 0.14, dt);
    }
    bones.pack.rotation.set(this.pack.pitch.x, 0, this.pack.roll.x);
    bones.antenna.rotation.set(clamp(this.antenna.pitch.x, -0.6, 0.6), 0, clamp(this.antenna.roll.x, -0.6, 0.6));
  }
}

/**
 * Two-bone IK in the plane of the pole vector. Writes root-space rotations for the upper and
 * lower bone (bind pose: bones point down -Y, knee/elbow front is +Z).
 */
export function solveTwoBone(hip: Vector3, target: Vector3, pole: Vector3, a: number, b: number, upper: Quaternion, lower: Quaternion): void {
  const h = _ikH.copy(hip);
  const d = _ikD.copy(target).sub(h);
  let dist = d.length();
  if (dist < 1e-5) {
    d.set(0, -1, 0);
    dist = 1e-5;
  }
  const u = d.divideScalar(dist);
  dist = clamp(dist, Math.abs(a - b) + 1e-3, (a + b) * 0.9999);
  // In-plane direction toward the pole, perpendicular to the hip->target line.
  const w = _ikW.copy(pole).addScaledVector(u, -pole.dot(u));
  if (w.lengthSq() < 1e-8) w.set(0, 0, 1).addScaledVector(u, -u.z);
  w.normalize();
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const knee = _ikK.copy(h).addScaledVector(u, a * cosA).addScaledVector(w, a * sinA);
  const end = _ikE.copy(h).addScaledVector(u, dist);
  basisQuat(knee, h, w, upper);
  basisQuat(end, knee, w, lower);
}
const _ikH = new Vector3();
const _ikD = new Vector3();
const _ikW = new Vector3();
const _ikK = new Vector3();
const _ikE = new Vector3();

/** Rotation whose +Y points from `from` to `to` and whose +Z leans toward `front`. */
function basisQuat(from: Vector3, to: Vector3, front: Vector3, out: Quaternion): void {
  const y = _xA.copy(to).sub(from).normalize();
  const z = _xB.copy(front).addScaledVector(y, -front.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = _xC.crossVectors(y, z);
  _m.makeBasis(x, y, z);
  out.setFromRotationMatrix(_m);
}
const _xA = new Vector3();
const _xB = new Vector3();
const _xC = new Vector3();

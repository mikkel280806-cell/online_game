// Look-dev for the EVA suit characters: both roles, standing, walking and sprinting.
//   node scripts/lookdev.mjs character front back threequarter close walk run
import { Vector3 } from 'three';
import { Avatar } from '../characters';
import { runLookdev, type LookdevView } from './harness';

const view = new URLSearchParams(location.search).get('view') ?? 'front';

/** The low sun is toward -X/-Z; characters turned this way get a 3/4 key light on the front. */
const STAGE = -1.35;
const dir = (yaw: number, d = 1) => new Vector3(Math.sin(yaw) * d, 0, Math.cos(yaw) * d);

function orbit(az: number, dist: number, height: number, target: Vector3, fov = 38): LookdevView {
  const p = target.clone().add(dir(az, dist));
  p.y = height;
  return { position: p.toArray() as [number, number, number], target: target.toArray() as [number, number, number], fov };
}

const center = new Vector3(0, 0.92, 0);
const camAz = STAGE + 0.3;
const camRight = new Vector3(Math.cos(camAz), 0, -Math.sin(camAz)).multiplyScalar(-1);

interface Actor {
  avatar: Avatar;
  pos: Vector3;
  yaw: number;
  speed: number;
  /** Extra simulated time before the shot (seconds), to vary the stride phase. */
  lead: number;
  /** Optional circular path: turn rate (rad/s, + = left) around the actor's start position. */
  turn?: number;
  t?: number;
}
const actors: Actor[] = [];
const add = (role: 'vanguard' | 'tether', pos: Vector3, yaw: number, speed = 0, lead = 0) =>
  actors.push({ avatar: new Avatar(role), pos, yaw, speed, lead });

/** Advance an actor one frame (circular path for turning actors). */
function step(a: Actor, dt: number): void {
  if (a.turn) {
    a.t = (a.t ?? 0) + dt;
    // Keep the actor in place but rotate its heading, so the shot stays framed.
    a.yaw += a.turn * dt;
  }
  a.avatar.animate(a.pos, a.yaw, a.speed, dt);
}

/** Lead time that lands an actor at gait phase `phase` (0 = left touchdown) for the shot frame. */
function leadFor(phase: number, speed: number): number {
  const cadence = 0.85 + 0.11 * speed;
  const frames = 3 * 60 + 5;
  const now = (cadence * frames) / 60;
  return ((((phase - now) % 1) + 1) % 1) / cadence;
}

const headPos = new Vector3();
switch (view) {
  case 'threequarter':
    add('vanguard', new Vector3(-1.6, 0, 1.2), 0.35, 0);
    add('tether', new Vector3(1.4, 0, 0.6), -0.5, 0, 3.1);
    add('vanguard', new Vector3(-2.2, 0, -2.4), Math.PI - 0.5, 5.2, 0.2);
    add('tether', new Vector3(2.3, 0, -2.1), Math.PI / 2 + 0.3, 8.4, 0.4);
    break;
  case 'walk':
    add('tether', new Vector3(0, 0, -1.0), 0, 5.0, leadFor(0.33, 5.0));
    add('vanguard', new Vector3(0, 0, 1.0), 0, 5.0, leadFor(0.6, 5.0));
    break;
  case 'run':
    add('tether', new Vector3(0, 0, -1.1), 0, 8.4, leadFor(0.3, 8.4));
    add('vanguard', new Vector3(0, 0, 1.1), 0, 8.4, leadFor(0.58, 8.4));
    break;
  case 'cyclewalk':
  case 'cyclerun': {
    const speed = view === 'cyclewalk' ? 5.2 : 8.4;
    const cadence = 0.85 + 0.11 * speed;
    for (let k = 0; k < 6; k++) add(k % 2 ? 'vanguard' : 'tether', new Vector3(0, 0, (k - 2.5) * 1.15), 0, speed, k / (6 * cadence));
    break;
  }
  case 'cycleslow': {
    const speed = 1.5;
    const cadence = 0.85 + 0.11 * speed;
    for (let k = 0; k < 6; k++) add(k % 2 ? 'vanguard' : 'tether', new Vector3(0, 0, (k - 2.5) * 1.0), 0, speed, k / (6 * cadence));
    break;
  }
  case 'turn':
    add('vanguard', new Vector3(-0.9, 0, 0), -0.6, 5.2, 0);
    add('tether', new Vector3(0.9, 0, 0), 0.6, 8.4, 0.3);
    actors[0].turn = 1.1;
    actors[1].turn = -1.0;
    break;
  case 'side':
    add('vanguard', new Vector3(0, 0, -0.75), 0, 0);
    add('tether', new Vector3(0, 0, 0.75), 0, 0, 2.2);
    break;
  case 'gesture':
    add('vanguard', new Vector3(), STAGE + 0.5, 0);
    break;
  case 'boots':
    add('vanguard', new Vector3(-0.35, 0, 0), STAGE + 0.25, 0);
    add('tether', new Vector3(0.45, 0, -0.3), STAGE - 0.2, 0, 1.3);
    break;
  case 'detail':
  case 'close':
    add('vanguard', new Vector3(), STAGE, 0);
    break;
  case 'closet':
    add('tether', new Vector3(), STAGE, 0);
    break;
  default:
    add('vanguard', camRight.clone().multiplyScalar(-0.58), STAGE + 0.12, 0);
    add('tether', camRight.clone().multiplyScalar(0.58), STAGE - 0.12, 0, 4.2);
}

/** Head height for the close-ups (after settling into the idle pose). */
function settle(): void {
  for (const a of actors) {
    const steps = Math.round((3 + a.lead) * 60);
    for (let i = 0; i < steps; i++) {
      if (view === 'gesture' && i === steps - 70) a.avatar.lookAtWrist();
      step(a, 1 / 60);
    }
  }
  const first = actors[0].avatar;
  first.root.updateMatrixWorld(true);
  headPos.setFromMatrixPosition(first.bones.head.matrixWorld).add(new Vector3(0, 0.12, 0));
}
settle();

const closeTarget = headPos.clone();

void runLookdev({
  ground: true,
  shadowExtent: 12,
  time: 0,
  views: {
    front: orbit(camAz, 4.3, 1.25, center),
    back: orbit(STAGE + Math.PI - 0.45, 4.3, 1.45, center),
    threequarter: { position: [0, 9.2, 13.1], target: [0, 0.9, 0], fov: 38 },
    close: orbit(STAGE + 0.45, 0.95, closeTarget.y + 0.1, closeTarget, 32),
    closet: orbit(STAGE + 0.45, 0.95, closeTarget.y + 0.1, closeTarget, 32),
    walk: { position: [-5.4, 1.05, 0], target: [0, 0.88, 0], fov: 36 },
    cyclewalk: { position: [-9.5, 1.0, 0], target: [0, 0.85, 0], fov: 36 },
    cyclerun: { position: [-9.5, 1.0, 0], target: [0, 0.85, 0], fov: 36 },
    cycleslow: { position: [-8.6, 1.0, 0], target: [0, 0.85, 0], fov: 36 },
    gesture: orbit(STAGE + 0.5 + 0.5, 2.0, 1.55, new Vector3(0, 1.2, 0), 36),
    detail: orbit(STAGE + 0.35, 0.85, 1.3, new Vector3(0, 1.2, 0), 34),
    run: { position: [-5.4, 1.05, 0], target: [0, 0.88, 0], fov: 36 },
    turn: { position: [0, 1.3, 5.5], target: [0, 0.9, 0], fov: 36 },
    side: { position: [-4.6, 1.15, 0], target: [0, 0.92, 0], fov: 36 },
    boots: orbit(STAGE + 0.3, 1.6, 0.55, new Vector3(0, 0.25, 0), 36),
  },
  setup({ scene }) {
    for (const a of actors) scene.add(a.avatar.root);
  },
  update() {
    for (const a of actors) step(a, 1 / 60);
  },
});

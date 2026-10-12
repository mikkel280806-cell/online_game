import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/orbitron/latin-700.css';
import { Vector3 } from 'three';
import { FollowCamera } from './engine/camera';
import { Input } from './engine/input';
import { FixedStepper, Loop, SIM_DT } from './engine/loop';
import { Renderer, type Quality } from './engine/renderer';
import { FrameStats } from './engine/stats';
import { Game, roleFor, type GameDebugState } from './game/game';
import { Avatar, ROLES } from './game/player';
import { createWorld } from './game/world';
import { createRoom, joinRoom, type NetOptions, type Session } from './net';
import { FeedbackBox } from './ui/feedback';
import { Hud } from './ui/hud';
import { Lobby } from './ui/lobby';
import { PerfOverlay } from './ui/perf';
import {
  deviceInfo,
  initTelemetry,
  reportPerf,
  reportSession,
  sendFeedback,
  setTelemetryContext,
} from './telemetry/telemetry';

declare global {
  interface Window {
    /** Live game state for automated tests. */
    __hs?: GameDebugState;
    /** Set when a ?shot= render is complete. */
    __shotReady?: boolean;
  }
}

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const netOptions: NetOptions = {
  signaling: params.get('net') === 'local' ? 'broadcast' : 'supabase',
  forceRelay: params.get('relay') === '1',
  ...(params.get('ice') === 'none' ? { iceServers: [] } : {}),
};
const telemetryParam = params.get('telemetry');
initTelemetry(!shot && (telemetryParam ? telemetryParam === '1' : !isLocalHost));

// ---------- Engine + world ----------

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
const follow = new FollowCamera(innerWidth / innerHeight);
const camera = follow.camera;
const renderer = new Renderer(canvas, camera);
const world = createWorld(renderer.gl);
renderer.setScene(world.scene);
renderer.onResize = (w, h) => follow.setAspect(w / h);
renderer.resize();
const quality = params.get('quality') as Quality | null;
if (quality && ['low', 'medium', 'high'].includes(quality)) renderer.setQuality(quality);

const input = new Input();
const game = new Game(world, world.scene, input);
const stats = new FrameStats();
const hud = new Hud(uiRoot);
const perf = new PerfOverlay(uiRoot);

// ---------- Screenshot capture (feedback box) ----------

let captureRequest: ((url: string | null) => void) | null = null;
function captureScreenshot(): Promise<string | null> {
  return new Promise((resolve) => (captureRequest = resolve));
}
function fulfilCapture(): void {
  if (!captureRequest) return;
  const resolve = captureRequest;
  captureRequest = null;
  try {
    const w = Math.min(960, canvas.width);
    const h = Math.round((canvas.height / canvas.width) * w);
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    small.getContext('2d')!.drawImage(canvas, 0, 0, w, h);
    resolve(small.toDataURL('image/jpeg', 0.72));
  } catch {
    resolve(null);
  }
}

const feedback = new FeedbackBox(uiRoot, {
  captureScreenshot,
  submit: (note, screenshot) => sendFeedback(note, screenshot, { state: game.debugState(), fps: Math.round(stats.fps()) }),
  toast: (t) => hud.toast(t),
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    e.preventDefault();
    perf.toggle();
  } else if (e.code === 'F8') {
    e.preventDefault();
    void feedback.open();
  }
});

// ---------- Game start ----------

type Mode = 'menu' | 'transition' | 'play';
let mode: Mode = 'menu';
let transitionT = 0;
const orbitCenter = new Vector3(0, 0, -2);
const camFrom = new Vector3();
const lookFrom = new Vector3();

function beginPlay(roomCode: string | null, role: 'host' | 'guest' | 'solo'): void {
  lobby.hide();
  hud.show(roomCode);
  setTelemetryContext({ room: roomCode, role });
  reportSession({ ...deviceInfo(renderer.gl.getContext()), quality: renderer.getQuality(), transport: netOptions.signaling });
  camFrom.copy(camera.position);
  camera.getWorldDirection(lookFrom).multiplyScalar(20).add(camera.position);
  mode = 'transition';
  transitionT = 0;
}

function startSession(session: Session): void {
  game.attachSession(session);
  session.onStatus((s) => {
    if (s.phase === 'connected') hud.toast('Your partner is here');
    if (s.phase === 'disconnected') hud.toast('Your partner lost connection');
  });
  beginPlay(session.roomCode, session.role);
}

const lobby = new Lobby({
  async create() {
    startSession(await createRoom(netOptions));
  },
  async join(code) {
    startSession(await joinRoom(code, netOptions));
  },
  solo() {
    game.spawnLocal(roleFor('solo'));
    beginPlay(null, 'solo');
  },
});
uiRoot.prepend(lobby.el);
window.addEventListener('pagehide', () => game.detachSession());

// ---------- Main loop ----------

let perfTimer = 0;
const stepper = new FixedStepper();
const ease = (t: number) => t * t * (3 - 2 * t);
const look = new Vector3();

function updateCamera(dt: number, time: number): void {
  if (mode === 'menu') {
    follow.orbit(orbitCenter, 27, 8.5, time * 0.045 + 0.5);
    return;
  }
  const target = game.local?.position ?? orbitCenter;
  if (mode === 'transition') {
    transitionT = Math.min(1, transitionT + dt / 1.8);
    follow.snapTo(target);
    const goalPos = camera.position.clone();
    const k = ease(transitionT);
    camera.position.lerpVectors(camFrom, goalPos, k);
    look.lerpVectors(lookFrom, target.clone().setY(0.8), k);
    camera.lookAt(look);
    if (transitionT >= 1) mode = 'play';
    return;
  }
  follow.follow(target, dt);
}

const loop = new Loop(({ dt, time, frameMs }) => {
  const now = performance.now();
  stats.push(frameMs);
  const steps = stepper.steps(dt);
  if (!feedback.isOpen) for (let i = 0; i < steps; i++) game.update(SIM_DT, now - (steps - 1 - i) * SIM_DT * 1000);
  updateCamera(dt, time);
  world.update(time, camera.position, renderer.getPixelRatio());

  const state = game.debugState();
  window.__hs = state;
  if (mode !== 'menu') hud.update(state);
  const myRole = game.localRole;
  if (myRole && game.local && mode !== 'menu') hud.label('me', ROLES[myRole].name, ROLES[myRole].css, game.local.position, camera);
  if (game.remote) {
    const r = game.remote.avatar.role;
    hud.label('partner', ROLES[r].name, ROLES[r].css, game.remote.visible ? game.remote.position : null, camera);
  }

  renderer.render(dt, frameMs);
  fulfilCapture();
  perf.update(now, stats, renderer.gl, renderer.getPixelRatio(), renderer.getQuality(), state);
  input.endFrame();

  if (mode !== 'menu') {
    perfTimer += dt;
    if (perfTimer >= 30) {
      perfTimer = 0;
      reportPerf({
        fps: Math.round(stats.fps()),
        avgMs: +stats.avgMs().toFixed(2),
        p95Ms: +stats.p95Ms().toFixed(2),
        pixelRatio: renderer.getPixelRatio(),
        quality: renderer.getQuality(),
        draws: renderer.gl.info.render.calls,
        transport: state.transport,
        rttMs: state.rttMs,
      });
    }
  }
});

// ---------- Photo mode (?shot=name) ----------

async function runShot(name: string): Promise<void> {
  renderer.setDynamicResolution(false);
  const T = 12.5; // fixed time so animated shaders look the same every run
  lobby.el.classList.toggle('hidden', name !== 'title');
  const place = (role: 'vanguard' | 'tether', x: number, z: number, yaw: number) => {
    const a = new Avatar(role);
    a.animate(new Vector3(x, 0, z), yaw, 0, 0);
    world.scene.add(a.root);
  };
  switch (name) {
    case 'title':
      follow.orbit(orbitCenter, 27, 8.5, 0.5);
      break;
    case 'deck':
      place('vanguard', -1.6, 1.5, 2.6);
      place('tether', 1.4, 0.8, -2.5);
      follow.snapTo(new Vector3(0, 0, 1.5));
      break;
    case 'vista':
      place('vanguard', -0.8, -9.5, 3.6);
      place('tether', 0.8, -9.8, 2.9);
      camera.position.set(3.5, 2.4, -2);
      camera.lookAt(-14, 5, -40);
      break;
    case 'edge':
      place('tether', 15.5, 2, 1.2);
      camera.position.set(9, 6, 9);
      camera.lookAt(30, -18, -10);
      break;
    default:
      follow.snapTo(new Vector3());
  }
  for (let i = 0; i < 6; i++) {
    world.update(T, camera.position, renderer.getPixelRatio());
    renderer.render(1 / 60, 16);
    await new Promise((r) => requestAnimationFrame(r));
  }
  window.__shotReady = true;
}

if (shot) void runShot(shot);
else loop.run();

import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/orbitron/latin-700.css';
import { Quaternion, Vector3 } from 'three';
import { Avatar } from './characters';
import { CameraRig } from './engine/camera';
import { Input } from './engine/input';
import { FixedStepper, Loop, SIM_DT } from './engine/loop';
import { Renderer, type Quality } from './engine/renderer';
import { FrameStats } from './engine/stats';
import { LANDING_PAD, PLANET_DIR, SUN_DIR, WRECK } from './env/layout';
import { Game, roleFor, type GameDebugState } from './game/game';
import { NO_CONTROL, type PlayerControl } from './game/player';
import { ROLES } from './game/roles';
import { MissionFx } from './game/missionFx';
import { ObjectiveUi } from './ui/objective';
import { createWorld, type WorldDebug } from './game/world';
import { createRoom, joinRoom, type NetOptions, type Session } from './net';
import { FeedbackBox } from './ui/feedback';
import { Hud } from './ui/hud';
import { Lobby } from './ui/lobby';
import { PerfOverlay } from './ui/perf';
import {
  deviceInfo,
  initTelemetry,
  reportDiagnostics,
  reportError,
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
    /** Rendering health report (used by the smoke test and sent to telemetry). */
    __diag?: () => Promise<Record<string, unknown>>;
    /** Photo-mode profiler (?shot=<name>&prof=1), driven by scripts/profile.mjs. */
    __prof?: Profiler;
  }
}

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const netOptions: NetOptions = {
  signaling: params.get('net') === 'local' ? 'broadcast' : 'supabase',
  forceRelay: params.get('relay') === '1',
  ...(params.get('ice') === 'none' ? { iceServers: [] } : {}),
  // Tests on slow software-rendered machines give WebRTC longer before falling back to relay.
  ...(Number(params.get('p2ptimeout')) > 0 ? { p2pTimeoutMs: Number(params.get('p2ptimeout')) } : {}),
};
const telemetryParam = params.get('telemetry');
initTelemetry(!shot && (telemetryParam ? telemetryParam === '1' : !isLocalHost));

// ---------- Engine + world ----------

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
const qualityParam = params.get('quality') as Quality | null;
const quality: Quality = qualityParam && ['low', 'medium', 'high'].includes(qualityParam) ? qualityParam : 'high';

const rig = new CameraRig(innerWidth / innerHeight);
const camera = rig.camera;
const renderer = new Renderer(canvas, camera);
renderer.setQuality(quality);
if (params.get('drs') === '0') renderer.setDynamicResolution(false);
const scale = Number(params.get('scale'));
if (scale > 0) renderer.setScaleCap(Math.max(0.25, Math.min(2, scale)));

// Let the loading screen paint before the (synchronous) world build.
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const world = createWorld(renderer.gl, camera, quality);
rig.groundAt = world.heightAt;
rig.setObstacles([world.props.group]);
rig.attach(canvas);
renderer.setScene(world.scene);
const toneMap = params.get('tm');
renderer.configurePost({
  quality,
  minimal: params.get('post') === 'min',
  ao: params.get('ao') !== '0',
  godRays: params.get('rays') !== '0',
  sunMesh: world.sky.sunMesh,
  exposure: Number(params.get('exposure')) || 1.25,
  ...(toneMap === 'agx' || toneMap === 'aces' || toneMap === 'neutral' ? { toneMap } : {}),
});
renderer.onResize = (w, h) => {
  rig.setAspect(w / h);
  world.lighting.updateFrustums();
};
// Dynamic resolution stepped the quality tier down: cheaper shadow cascades too.
renderer.onQualityChange = (q) => world.setQuality(q);
renderer.resize();

const input = new Input();
const game = new Game(world);
const stats = new FrameStats();
const hud = new Hud(uiRoot);
const objective = new ObjectiveUi(uiRoot);
const missionFx = new MissionFx(world.scene, world.heightAt);
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

// ---------- Game start ----------

type Mode = 'menu' | 'transition' | 'play';
let mode: Mode = 'menu';
let transitionT = 0;
let solo = false;
const titleCenter = new Vector3(LANDING_PAD.x - 2, 0, LANDING_PAD.z);
const camFrom = new Vector3();
const quatFrom = new Quaternion();

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'F3') {
    e.preventDefault();
    perf.toggle();
  } else if (e.code === 'F8') {
    e.preventDefault();
    void feedback.open();
  } else if (mode === 'play' && e.code === 'KeyH') {
    uiRoot.classList.toggle('hide-hud');
  } else if (mode === 'play' && solo && e.code === 'KeyB') {
    if (game.bot) {
      game.removeBot();
      hud.toast('Bot partner dismissed');
    } else {
      game.spawnBot();
      hud.toast('Bot partner joined');
    }
  }
});

function beginPlay(roomCode: string | null, role: 'host' | 'guest' | 'solo'): void {
  lobby.hide();
  hud.show(roomCode);
  setTelemetryContext({ room: roomCode, role });
  reportSession({ ...deviceInfo(renderer.gl.getContext()), quality: renderer.getQuality(), transport: netOptions.signaling });
  camFrom.copy(camera.position);
  quatFrom.copy(camera.quaternion);
  rig.setView(0, 0.42, 12);
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
    solo = true;
    game.spawnLocal(roleFor('solo'));
    if (params.get('bot') !== '0') game.spawnBot();
    beginPlay(null, 'solo');
  },
});
uiRoot.prepend(lobby.el);
window.addEventListener('pagehide', () => game.detachSession());

// ---------- Main loop ----------

let perfTimer = 0;
const stepper = new FixedStepper();
const ease = (t: number) => t * t * (3 - 2 * t);

/** Turn keys into a world-space move direction relative to where the camera looks. */
function playerControl(): PlayerControl {
  if (mode !== 'play' || feedback.isOpen) return NO_CONTROL;
  const a = input.moveAxis();
  const yaw = rig.viewYaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return {
    x: rx * a.x + fx * a.y,
    z: rz * a.x + fz * a.y,
    sprint: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
    act: input.isDown('KeyF'),
  };
}

function updateCamera(dt: number, time: number): void {
  if (mode === 'menu') {
    rig.orbit(titleCenter, 34, 7, time * 0.03 + 2.4, 3);
    return;
  }
  rig.update(dt, game.local?.display ?? null, input);
  if (mode === 'transition') {
    transitionT = Math.min(1, transitionT + dt / 2.2);
    const k = ease(transitionT);
    camera.position.lerpVectors(camFrom, camera.position, k);
    camera.quaternion.slerpQuaternions(quatFrom, camera.quaternion, k);
    if (transitionT >= 1) mode = 'play';
  }
}

/** Main-thread time of the previous frame (game + render submission), for dynamic resolution. */
let lastCpuMs: number | undefined;

const loop = new Loop(({ dt, time, frameMs }) => {
  const now = performance.now();
  stats.push(frameMs);
  const steps = stepper.steps(dt);
  const control = playerControl();
  for (let i = 0; i < steps; i++) game.update(SIM_DT, now - (steps - 1 - i) * SIM_DT * 1000, control);
  game.present(stepper.alpha, dt, now);
  updateCamera(dt, time);
  world.update(time, camera);
  missionFx.update(time, game.mission);

  const state = game.debugState();
  window.__hs = state;
  if (mode !== 'menu') hud.update(state);
  objective.update(mode === 'play', game.mission, game.localRole, game.local?.position ?? null);
  const myRole = game.localRole;
  if (myRole && game.local && mode !== 'menu') hud.label('me', ROLES[myRole].name, ROLES[myRole].css, game.local.display, camera);
  const partner = game.partner();
  hud.label(
    'partner',
    partner ? ROLES[partner.role].name + (partner.isBot ? ' · bot' : '') : '',
    partner ? ROLES[partner.role].css : '',
    partner?.position ?? null,
    camera,
  );

  renderer.render(dt, frameMs, lastCpuMs);
  fulfilCapture();
  perf.update(now, stats, renderer, state);
  input.endFrame();
  lastCpuMs = performance.now() - now;

  // Perf samples on the title screen too (it sees the whole outpost: often the heaviest view).
  perfTimer += dt;
  if (perfTimer >= 30) {
    perfTimer = 0;
    const drs = renderer.resolutionInfo();
    reportPerf({
      fps: Math.round(stats.fps()),
      avgMs: +stats.avgMs().toFixed(2),
      p50Ms: +stats.medianMs().toFixed(2),
      p95Ms: +stats.p95Ms().toFixed(2),
      cpuMs: lastCpuMs !== undefined ? +lastCpuMs.toFixed(2) : null,
      pixelRatio: renderer.getPixelRatio(),
      quality: renderer.getQuality(),
      drs: drs.reason,
      drsRange: [drs.min, drs.max],
      draws: renderer.gl.info.render.calls,
      triangles: renderer.gl.info.render.triangles,
      mode,
      transport: state.transport,
      rttMs: state.rttMs,
    });
  }
});

// ---------- Photo mode (?shot=name) ----------

async function runShot(name: string): Promise<void> {
  renderer.setDynamicResolution(false);
  const T = 12.5; // fixed time so animated shaders look the same every run
  lobby.el.classList.toggle('hidden', name !== 'title');
  const avatars: Avatar[] = [];
  const place = (role: 'vanguard' | 'tether', x: number, z: number, yaw: number, speed: number) => {
    const a = new Avatar(role);
    avatars.push(a);
    const p = new Vector3(x, world.heightAt(x, z), z);
    // Advance the procedural animation into a natural mid-stride pose.
    for (let i = 0; i < 40; i++) a.animate(p, yaw, speed, 1 / 60);
    world.add(a.root);
    return p;
  };
  const look = (from: Vector3, to: Vector3, fov = 42) => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.position.copy(from);
    camera.lookAt(to);
    world.lighting.updateFrustums();
  };
  const [sx, , sz] = world.spawnPoints[0].toArray();
  switch (name) {
    case 'title':
      rig.orbit(titleCenter, 34, 7, 2.4 + T * 0.03, 3);
      break;
    case 'play': {
      const p = place('vanguard', sx, sz - 3, Math.PI * 0.9, 4.5);
      place('tether', sx + 2.2, sz - 0.8, Math.PI * 0.95, 4.5);
      rig.setView(0.25, 0.42, 12);
      rig.snapTo(p);
      break;
    }
    case 'vista': {
      place('vanguard', -6, -30, Math.PI * 1.05, 0);
      place('tether', -4.4, -31, Math.PI * 0.95, 0);
      const wreck = new Vector3(WRECK.x, world.heightAt(WRECK.x, WRECK.z) + 20, WRECK.z);
      look(new Vector3(-5, world.heightAt(-5, -24) + 3.2, -24), wreck, 38);
      break;
    }
    case 'sun': {
      const from = new Vector3(-48, world.heightAt(-48, 14) + 2.2, 14);
      look(from, from.clone().addScaledVector(SUN_DIR, 100).setY(from.y + 8), 50);
      break;
    }
    case 'planet': {
      const from = new Vector3(-10, world.heightAt(-10, 20) + 1.8, 20);
      look(from, from.clone().addScaledVector(PLANET_DIR, 100), 55);
      break;
    }
    case 'ship': {
      place('vanguard', sx - 1, sz + 1, 2.4, 0);
      place('tether', sx + 1.5, sz + 2, 3.6, 0);
      look(new Vector3(sx - 9, 1.6, sz + 12), new Vector3(LANDING_PAD.x, 4, LANDING_PAD.z), 40);
      break;
    }
    default:
      rig.snapTo(world.spawnPoints[0]);
  }
  const gl = renderer.gl.getContext();
  const pixel = new Uint8Array(4);
  if (params.get('prof') === '1') {
    window.__prof = createProfiler(T, avatars);
    window.__shotReady = true;
    return;
  }
  for (let i = 0; i < 6; i++) {
    world.update(T + i / 60, camera);
    renderer.render(1 / 60, 16);
    // Wait for the GPU to finish (software renderers queue a lot of work).
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    await new Promise((r) => requestAnimationFrame(r));
  }
  const info = renderer.gl.info.render;
  console.info(`[shot] ${name} draws=${info.calls} triangles=${info.triangles}`);
  window.__shotReady = true;
}

// ---------- Profiler (photo mode) ----------

/** Everything scripts/profile.mjs can switch. Unset fields take the game's defaults. */
interface ProfSpec extends WorldDebug {
  ao?: boolean;
  rays?: boolean;
  bloom?: boolean;
  grain?: boolean;
  smaa?: boolean;
  post?: 'full' | 'min';
  scale?: number;
  chars?: boolean;
}

interface ProfResult {
  /** Wall time per frame, GPU work included (render + 1-pixel readback). */
  ms: number[];
  /** CPU time per frame up to the end of command submission. */
  cpuMs: number[];
  draws: number;
  triangles: number;
  width: number;
  height: number;
}

interface Profiler {
  set(spec: ProfSpec): Promise<void>;
  measure(frames: number, warm?: number): Promise<ProfResult>;
  /** Triangles and draw calls per object for one frame, split into camera and shadow passes. */
  breakdown(): Promise<Record<string, { tris: number; shadowTris: number; calls: number; shadowCalls: number }>>;
}

function createProfiler(T: number, avatars: Avatar[]): Profiler {
  const gl = renderer.gl.getContext();
  const pixel = new Uint8Array(4);
  const defaults: Required<Omit<ProfSpec, 'cascades' | 'shadowSize' | 'scale'>> & Pick<ProfSpec, 'cascades' | 'shadowSize' | 'scale'> = {
    ao: true, rays: true, bloom: true, grain: true, smaa: true, post: 'full', chars: true,
    sky: true, props: true, terrainNear: true, terrainFar: true, rocks: true, pebbles: true,
    terrainFlat: false, nearStride: 1, shadows: true,
    cascades: world.lighting.shadowSettings.cascades, shadowSize: world.lighting.shadowSettings.size,
    scale: renderer.getPixelRatio(),
  };
  let current = { ...defaults };
  let frame = 0;
  const step = async () => {
    world.update(T + frame++ / 60, camera);
    renderer.render(1 / 60, 16);
  };
  return {
    async set(spec) {
      const next = { ...defaults, ...spec };
      const postKeys = ['ao', 'rays', 'bloom', 'grain', 'smaa', 'post'] as const;
      if (postKeys.some((k) => next[k] !== current[k])) {
        renderer.configurePost({
          minimal: next.post === 'min',
          ao: next.ao,
          godRays: next.rays,
          bloom: next.bloom,
          grain: next.grain,
          smaa: next.smaa,
        });
      }
      if (next.scale !== current.scale) renderer.setScaleCap(next.scale!);
      for (const a of avatars) a.root.visible = next.chars;
      world.setDebug(next);
      current = next;
    },
    async measure(frames, warm = 2) {
      for (let i = 0; i < warm; i++) {
        await step();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        await new Promise((r) => setTimeout(r, 0));
      }
      const ms: number[] = [];
      const cpuMs: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        await step();
        const t1 = performance.now();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        ms.push(performance.now() - t0);
        cpuMs.push(t1 - t0);
        await new Promise((r) => setTimeout(r, 0));
      }
      const info = renderer.gl.info.render;
      return { ms, cpuMs, draws: info.calls, triangles: info.triangles, width: canvas.width, height: canvas.height };
    },
    async breakdown() {
      type Row = { tris: number; shadowTris: number; calls: number; shadowCalls: number };
      const rows: Record<string, Row> = {};
      const r = renderer.gl as unknown as { renderBufferDirect: (...a: unknown[]) => void };
      const orig = r.renderBufferDirect;
      r.renderBufferDirect = function (cam, scn, geometry, material, object, group) {
        const g = geometry as { index: { count: number } | null; attributes: { position: { count: number } }; drawRange: { count: number } };
        const o = object as { name: string; count?: number; isInstancedMesh?: boolean; parent: { name: string } | null; isMesh?: boolean };
        const n = Math.min(g.index ? g.index.count : g.attributes.position.count, g.drawRange.count) / 3;
        const tris = n * (o.isInstancedMesh ? (o.count ?? 0) : 1);
        const shadow = (cam as { isOrthographicCamera?: boolean }).isOrthographicCamera && o.isMesh && !(material as { isShaderMaterial?: boolean }).isShaderMaterial;
        const key = o.name || `${o.parent?.name ?? '?'}/(unnamed)`;
        const row = (rows[key] ??= { tris: 0, shadowTris: 0, calls: 0, shadowCalls: 0 });
        if (shadow) {
          row.shadowTris += tris;
          row.shadowCalls++;
        } else {
          row.tris += tris;
          row.calls++;
        }
        return orig.call(this, cam, scn, geometry, material, object, group);
      };
      try {
        await step();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      } finally {
        r.renderBufferDirect = orig;
      }
      return rows;
    },
  };
}

// ---------- Shader prewarm ----------

/** Keeps the prewarm avatar's material (and so its compiled program) alive for the first real one. */
let prewarmed: Avatar | null = null;

/**
 * Compile every material while the loading screen is up, instead of as things first come into
 * view (each first sighting is a frame-time hitch). Includes an astronaut, who otherwise
 * compiles at the moment play starts. Uses KHR_parallel_shader_compile where available.
 */
async function prewarmShaders(): Promise<void> {
  const t0 = performance.now();
  try {
    Avatar.prewarm(renderer.gl);
    prewarmed = new Avatar('vanguard');
    prewarmed.root.position.copy(world.spawnPoints[0]);
    world.add(prewarmed.root);
    // compileAsync can wait forever on some browsers (it never resolved in WebKit): never let the
    // prewarm hold the game on the loading screen. Shaders it didn't finish compile on first use.
    const timedOut = await Promise.race([
      renderer.gl.compileAsync(world.scene, camera).then(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), 5000)),
    ]);
    if (timedOut) console.info('[prewarm] gave up waiting for shader compiles');
  } catch (e) {
    console.warn('[prewarm]', e);
  } finally {
    prewarmed?.root.removeFromParent();
  }
  console.info(`[prewarm] shaders compiled in ${(performance.now() - t0).toFixed(0)} ms`);
}

// ---------- Diagnostics ----------

/** Mean brightness (0-255) of the current frame: ~0 means the screen is black. */
async function measureFrame(): Promise<number | null> {
  const url = await captureScreenshot();
  if (!url) return null;
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 27;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, c.width, c.height);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  return Math.round((sum / (px.length / 4)) * 10) / 10;
}

async function diagnostics(): Promise<Record<string, unknown>> {
  const ctx = renderer.gl.getContext() as WebGL2RenderingContext;
  // three's internal program objects carry compile diagnostics when a shader fails.
  type Program = { name: string; diagnostics?: { runnable: boolean; programLog: string; vertexShader: { log: string }; fragmentShader: { log: string } } };
  const programs = (renderer.gl.info.programs ?? []) as unknown as Program[];
  const failing = programs
    .filter((p) => p.diagnostics && p.diagnostics.runnable === false)
    .map((p) => ({
      name: p.name,
      log: `${p.diagnostics!.programLog}\n${p.diagnostics!.vertexShader.log}\n${p.diagnostics!.fragmentShader.log}`.slice(0, 1500),
    }));
  return {
    brightness: await measureFrame(),
    contextLost: ctx.isContextLost(),
    programs: programs.length,
    failing,
    maxTextureUnits: ctx.getParameter(ctx.MAX_TEXTURE_IMAGE_UNITS),
    maxVaryings: ctx.getParameter(ctx.MAX_VARYING_VECTORS),
    maxFragmentUniforms: ctx.getParameter(ctx.MAX_FRAGMENT_UNIFORM_VECTORS),
    floatBuffers: !!ctx.getExtension('EXT_color_buffer_float'),
    pixelRatio: renderer.getPixelRatio(),
    draws: renderer.gl.info.render.calls,
    triangles: renderer.gl.info.render.triangles,
    post: params.get('post') ?? 'full',
  };
}
window.__diag = diagnostics;
(window as unknown as { __teleport: (x: number, z: number) => void }).__teleport = (x, z) => game.teleport(x, z);
(window as unknown as { __setScale: (s: number) => void }).__setScale = (s: number) => renderer.setScaleCap(s);
canvas.addEventListener('webglcontextlost', () => reportError('WebGL context lost'));

const loading = document.getElementById('loading');
if (shot) {
  loading?.remove();
  void runShot(shot);
} else {
  await prewarmShaders();
  loop.run();
  // One health report per visit, once shaders have compiled and a few frames have run.
  setTimeout(() => void diagnostics().then(reportDiagnostics).catch(() => {}), 6000);
  // Fade out once the first frames (and the post-processing shader compiles) are done.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 900);
  }));
}

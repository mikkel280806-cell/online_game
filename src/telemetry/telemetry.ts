import { BUILD_VERSION } from '../config';
import { getSupabase } from '../services/supabase';

/**
 * Sends performance samples, errors and playtest feedback to Supabase so the developer
 * can see how the game runs on the players' real machines. Fire-and-forget: failures
 * never affect the game.
 */

export interface TelemetryContext {
  room: string | null;
  role: 'host' | 'guest' | 'solo' | null;
}

const sessionId = crypto.randomUUID();
let enabled = false;
let context: TelemetryContext = { room: null, role: null };
let errorsSent = 0;

export function initTelemetry(on: boolean): void {
  enabled = on;
  if (!on) return;
  window.addEventListener('error', (e) => reportError(e.message, e.error?.stack));
  window.addEventListener('unhandledrejection', (e) => reportError(String(e.reason?.message ?? e.reason), e.reason?.stack));
  // Rendering problems (e.g. a shader a browser rejects) are logged, not thrown: forward them too.
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    try {
      const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      const errorLines = text.split('\n').filter((l) => /error/i.test(l)).slice(0, 25).join('\n');
      reportError(`console: ${text.slice(0, 400)}\n${errorLines}`.slice(0, 4000));
    } catch {
      /* never let telemetry break the game */
    }
  };
}

/** One-off health report a few seconds after start: WebGL limits, failed shaders, context state. */
export function reportDiagnostics(data: Record<string, unknown>): void {
  void insert('telemetry', { kind: 'session', data: { type: 'diag', ...data } });
}

export function setTelemetryContext(ctx: Partial<TelemetryContext>): void {
  context = { ...context, ...ctx };
}

function row() {
  return { session_id: sessionId, room: context.room, role: context.role, build: BUILD_VERSION.slice(0, 64) };
}

function insert(table: 'telemetry' | 'feedback', data: Record<string, unknown>): Promise<boolean> {
  if (!enabled) return Promise.resolve(false);
  return Promise.resolve(getSupabase().from(table).insert({ ...row(), ...data }))
    .then((r) => !r.error)
    .catch(() => false);
}

export function reportSession(info: Record<string, unknown>): void {
  void insert('telemetry', { kind: 'session', data: info });
}

export function reportPerf(sample: Record<string, unknown>): void {
  void insert('telemetry', { kind: 'perf', data: sample });
}

export function reportError(message: string, stack?: string): void {
  if (errorsSent >= 12) return;
  errorsSent++;
  void insert('telemetry', { kind: 'error', data: { message: message.slice(0, 500), stack: stack?.slice(0, 4000) } });
}

export function sendFeedback(note: string, screenshot: string | null, extra: Record<string, unknown>): Promise<boolean> {
  return insert('feedback', { note: note.slice(0, 2000), screenshot, context: extra });
}

export function telemetryEnabled(): boolean {
  return enabled;
}

/** GPU, screen and browser details for the session row. */
export function deviceInfo(gl: WebGL2RenderingContext | WebGLRenderingContext): Record<string, unknown> {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    ua: navigator.userAgent,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`,
    dpr: devicePixelRatio,
    cores: navigator.hardwareConcurrency,
  };
}

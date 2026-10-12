import { describe, expect, it } from 'vitest';
import { ResolutionController, windowStats, type DrsConfig, type DrsDecision } from '../../src/engine/resolution';

const VSYNC = 1000 / 60;

/** Deterministic jitter in [-0.5, 0.5). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/** A browser that presents on vsync (Safari): a frame takes a whole number of refresh intervals. */
const onVsync = (workMs: number) => Math.max(1, Math.ceil(workMs / VSYNC - 0.02)) * VSYNC;

/** GPU-bound cost model: fixed part + per-pixel part (pixels ∝ scale²). */
const gpuBound = (fixed: number, perPixelAt1: number) => (scale: number) => fixed + perPixelAt1 * scale * scale;

interface SimOptions {
  config?: Partial<DrsConfig>;
  initialScale?: number;
  seconds: number;
  /** Work per frame at a given scale and time (ms of GPU/CPU work). */
  work: (scale: number, t: number) => number;
  /** Frame interval from work (default: vsync-quantised). */
  present?: (workMs: number, t: number) => number;
  /** Extra one-off frame times injected at given times, e.g. shader-compile hitches. */
  hitches?: (t: number) => number | undefined;
  cpu?: (scale: number, t: number) => number | undefined;
  /** What the caller does on a quality-down request. */
  onQualityDown?: (c: ResolutionController, t: number) => void;
}

interface SimResult {
  c: ResolutionController;
  decisions: { t: number; d: DrsDecision }[];
  /** [time ms, scale] after every frame. */
  trace: [number, number][];
  frames: number[];
}

function simulate(o: SimOptions): SimResult {
  const c = new ResolutionController({ maxScale: 1.5, minScale: 0.8, ...o.config }, o.initialScale);
  const jitter = rng(42);
  const decisions: SimResult['decisions'] = [];
  const trace: [number, number][] = [];
  const frames: number[] = [];
  let t = 0;
  let resized = false;
  while (t < o.seconds * 1000) {
    const scale = c.scale;
    const hitch = o.hitches?.(t);
    let dt = hitch ?? (o.present ?? onVsync)(o.work(scale, t), t) + jitter() * 0.6;
    // A resize reallocates render targets: the next frame is a bit slower.
    if (resized) dt += 12;
    resized = false;
    t += dt;
    frames.push(dt);
    const d = c.frame({ dtMs: dt, cpuMs: o.cpu?.(scale, t) });
    if (d.type !== 'none') {
      decisions.push({ t, d });
      if (d.type === 'scale') resized = true;
      if (d.type === 'quality-down') o.onQualityDown?.(c, t);
    }
    trace.push([t, c.scale]);
  }
  return { c, decisions, trace, frames };
}

/** Does this much work still present every vsync? */
const holds = (workMs: number) => onVsync(workMs) <= VSYNC + 1e-9;

const fractionAt = (trace: [number, number][], pred: (s: number) => boolean, from = 0) => {
  const pts = trace.filter(([t]) => t >= from);
  return pts.filter(([, s]) => pred(s)).length / pts.length;
};

describe('windowStats', () => {
  it('ignores hitches and the slowest tail', () => {
    const dts = [16, 17, 16, 17, 16, 900, 16, 17, 40, 16];
    const s = windowStats(dts, [], 250);
    expect(s.median).toBeCloseTo(16, 0);
    expect(s.hitches).toBeCloseTo(0.1);
    // 9 non-hitch frames; the slowest one (40 ms) is trimmed.
    expect(s.mean).toBeCloseTo(16.375, 3);
  });
});

describe('ResolutionController', () => {
  it('ignores shader-compile hitches at startup and never lowers a scene that runs at 60 fps', () => {
    const r = simulate({
      seconds: 30,
      work: () => 9,
      // Startup: a few seconds of compile stalls, then sporadic hitches (new materials coming into view, GC).
      hitches: (t) => (t < 1500 ? 400 : t < 4000 && Math.floor(t / 97) % 9 === 0 ? 180 : t % 5000 < 17 ? 120 : undefined),
    });
    expect(r.decisions.filter((x) => x.d.type !== 'none')).toEqual([]);
    expect(r.c.scale).toBe(1.5);
  });

  it('a startup hitch storm right after a step down does not make it give up', () => {
    // Heavy at 1.5 (the player's case), with compile stalls continuing past the warm-up.
    const work = gpuBound(3, 22); // 1.5 -> 52.5 ms, 1.0 -> 25 ms, 0.8 -> 17 ms
    const r = simulate({
      seconds: 40,
      work,
      config: { minScale: 0.6 },
      hitches: (t) => (t < 6000 && Math.floor(t / 211) % 4 === 0 ? 300 + (t % 200) : undefined),
    });
    // It got the frame rate to target and stayed there; no "resolution doesn't help".
    expect(r.decisions.some((x) => x.d.type === 'scale' && /doesn't help/.test(x.d.reason))).toBe(false);
    expect(holds(work(r.c.scale))).toBe(true);
    expect(fractionAt(r.trace, (s) => holds(work(s)), 20_000)).toBeGreaterThan(0.85);
  });

  it('steady overload: steps down in bounded, proportional steps until 60 fps holds', () => {
    const work = gpuBound(2, 20); // needs scale <= ~0.84
    const r = simulate({ seconds: 30, work, config: { minScale: 0.6 } });
    const scales = r.decisions.filter((x) => x.d.type === 'scale').map((x) => (x.d as { scale: number }).scale);
    // Bounded steps: never more than 25% per step.
    let prev = 1.5;
    for (const s of scales) {
      if (s < prev) expect(s / prev).toBeGreaterThanOrEqual(0.75 - 1e-9);
      prev = s;
    }
    // Reached the target within a few seconds of warm-up, and holds it.
    const firstGood = r.trace.find(([, s]) => holds(work(s)))![0];
    expect(firstGood).toBeLessThan(9000);
    expect(fractionAt(r.trace, (s) => holds(work(s)), 10_000)).toBeGreaterThan(0.9);
    // Not needlessly blurry: within ~15% of the best scale that holds 60 fps.
    expect(r.c.scale).toBeGreaterThan(0.84 * 0.85);
  });

  it('steps the quality tier down when even the floor is too slow, then settles', () => {
    let tier = 2; // 2 high, 1 medium, 0 low
    const tierCost = [0.45, 0.7, 1];
    const work = (s: number) => tierCost[tier] * (8 + 24 * s * s); // high @0.8: 23 ms; medium @0.8: 16.4 ms
    const r = simulate({
      seconds: 40,
      work,
      onQualityDown: (c) => {
        tier = Math.max(0, tier - 1);
        c.retarget({ minScale: [0.55, 0.7, 0.8][tier], maxScale: [1, 1.25, 1.5][tier] }, 1500);
      },
    });
    const downs = r.decisions.filter((x) => x.d.type === 'quality-down');
    expect(downs.length).toBe(1);
    expect(tier).toBe(1);
    // Resolution first: the quality step happened only at the floor.
    const before = r.trace.filter(([t]) => t < downs[0].t).at(-1)![1];
    expect(before).toBe(0.8);
    expect(holds(work(r.c.scale))).toBe(true);
  });

  it('30-fps cap (Low Power Mode): resolution does not help, so it restores sharpness and backs off', () => {
    const r = simulate({ seconds: 120, work: () => 6, present: () => 2 * VSYNC });
    expect(r.decisions.some((x) => x.d.type === 'quality-down')).toBe(false);
    const restores = r.decisions.filter((x) => x.d.type === 'scale' && /doesn't help/.test(x.d.reason));
    expect(restores.length).toBeGreaterThanOrEqual(1);
    // Backing off: few attempts in two minutes, and full resolution almost all the time.
    expect(restores.length).toBeLessThanOrEqual(4);
    expect(fractionAt(r.trace, (s) => s === 1.5)).toBeGreaterThan(0.8);
    // It never gives up for good: it tries again later.
    expect(restores.length).toBeGreaterThanOrEqual(2);
  });

  it('CPU-bound frames do not lower the resolution', () => {
    const r = simulate({ seconds: 20, work: () => 30, cpu: () => 28 });
    expect(r.decisions).toEqual([]);
  });

  it('recovers sharpness after a heavy stretch ends', () => {
    // Heavy for 15 s (e.g. the whole outpost in view), then light.
    const work = (s: number, t: number) => (t < 15_000 ? gpuBound(2, 20)(s) : gpuBound(2, 5)(s));
    const r = simulate({ seconds: 75, work, config: { minScale: 0.6 } });
    const low = Math.min(...r.trace.filter(([t]) => t < 15_000).map(([, s]) => s));
    expect(low).toBeLessThan(0.95);
    expect(r.c.scale).toBe(1.5);
  });

  it('probes upward with backoff when the budget is just under full scale', () => {
    // 60 fps holds up to scale ~1.0 only.
    const work = gpuBound(4, 12.5); // 1.0 -> 16.5 ms, 1.08 -> 18.6 ms
    const r = simulate({ seconds: 180, work, initialScale: 1.0 });
    const probes = r.decisions.filter((x) => x.d.type === 'scale' && x.d.reason === 'headroom probe');
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.length).toBeLessThanOrEqual(8);
    // Time spent over budget (failed probes) is small.
    expect(fractionAt(r.trace, (s) => !holds(work(s)))).toBeLessThan(0.06);
  });

  it('a single slow window does not change anything', () => {
    // A burst of slow frames (e.g. a GC pause and a texture upload) inside one window.
    const r = simulate({ seconds: 20, work: (_s, t) => (t > 8000 && t < 8150 ? 30 : 8) });
    expect(r.decisions).toEqual([]);
  });

  it('starts again after the tab was hidden', () => {
    const c = new ResolutionController({ maxScale: 1.5, minScale: 0.8 });
    for (let i = 0; i < 400; i++) c.frame({ dtMs: VSYNC });
    expect(c.frame({ dtMs: 30_000 })).toEqual({ type: 'none' });
    // Slow frames during the post-resume warm-up (1 s) are ignored.
    for (let i = 0; i < 9; i++) expect(c.frame({ dtMs: 100 }).type).toBe('none');
  });
});

// Dynamic resolution: keeps the frame rate at the target by changing the render scale (the
// renderer's pixel ratio), and asks for a lower quality tier when even the smallest scale
// can't hold it. Pure logic (no DOM, no clock): fed one sample per frame, so it is unit-tested
// with synthetic frame-time sequences (tests/unit/resolution.test.ts).
//
// Design:
// - Warm-up: the first seconds (shader compiles, texture uploads) are ignored entirely.
// - Robust statistics: decisions are made once per window (~0.5 s) from the median and a
//   trimmed mean of the frame times. Hitches (single frames over `hitchMs`, e.g. a shader
//   compile or GC pause) are left out; a window that is mostly hitches is skipped.
// - Settling: after every change the next few frames are discarded (frames in flight were
//   rendered at the old size, and the resize itself costs a frame), and a new window starts.
// - Going down is fast and proportional: GPU time scales with pixel count, so the step is
//   sqrt(target / measured), bounded to [0.75, 0.93] per window.
// - Going up has hysteresis: frame times can't show headroom on a vsync-locked display
//   (a 5 ms frame and a 16 ms frame both arrive every 16.7 ms), so after a stable stretch the
//   controller probes one small step up. A probe that overloads is reverted at once, the scale
//   it tried becomes a temporary ceiling, and the wait before the next probe doubles.
// - Resolution-insensitive load (a browser capping rAF at 30 fps, Low Power Mode, or a CPU-bound
//   frame): if cutting the pixel count roughly in half didn't make frames any faster, the
//   controller restores the scale it started from and stops trying for a while (backing off).
//   It never gives up for good, and a single noisy window can't trigger it.
// - Quality: when the scale is at the tier's floor and frames are still too slow for a few
//   seconds, it asks for the next lower quality tier (the caller rebuilds and calls retarget()).

export interface DrsConfig {
  /** Frame time to hold (ms). */
  targetMs: number;
  /** Lowest scale for the current quality tier. */
  minScale: number;
  /** Highest scale (tier cap, device pixel ratio, user cap). */
  maxScale: number;
  /** Ignore this long after start / retarget (ms). */
  warmupMs: number;
  /** Evaluation window (ms of frames). */
  windowMs: number;
  /** ...and at least this many frames. */
  minFrames: number;
  /** Frames longer than this are hitches, not load (ms). */
  hitchMs: number;
  /** Stable time before the first upward probe (ms); doubles after each failed probe. */
  probeWaitMs: number;
  /** Longest wait between probes (ms). */
  maxProbeWaitMs: number;
  /** Multiplicative scale step for upward probes. */
  probeStep: number;
  /** How long to stop lowering the scale after it proved useless (ms); doubles each time. */
  insensitiveHoldMs: number;
  maxInsensitiveHoldMs: number;
  /** Overloaded time at the floor before asking for a lower quality tier (ms). */
  qualityDownAfterMs: number;
  /** False when there is no lower quality tier left. */
  canLowerQuality: boolean;
  /** Frames ignored after each change. */
  settleFrames: number;
}

export const DEFAULT_DRS: DrsConfig = {
  targetMs: 1000 / 60,
  minScale: 0.6,
  maxScale: 1.5,
  warmupMs: 2500,
  windowMs: 500,
  minFrames: 10,
  hitchMs: 250,
  probeWaitMs: 3000,
  maxProbeWaitMs: 60_000,
  probeStep: 1.08,
  insensitiveHoldMs: 20_000,
  maxInsensitiveHoldMs: 160_000,
  qualityDownAfterMs: 2500,
  canLowerQuality: true,
  settleFrames: 3,
};

export interface FrameSample {
  /** Time since the previous frame (requestAnimationFrame interval), ms. */
  dtMs: number;
  /** Main-thread time spent on the previous frame (game + render submission), ms. Optional. */
  cpuMs?: number;
}

export type DrsDecision =
  | { type: 'none' }
  | { type: 'scale'; scale: number; reason: string }
  | { type: 'quality-down'; reason: string };

export interface WindowStats {
  median: number;
  /** Mean of the frames with the slowest 10% removed. */
  mean: number;
  p90: number;
  cpuMedian: number;
  /** Fraction of frames that were hitches. */
  hitches: number;
  frames: number;
  /** Duration of the window (ms). */
  duration: number;
}

const NONE: DrsDecision = { type: 'none' };

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Robust statistics of one window of frames (exported for tests and the perf overlay). */
export function windowStats(dts: number[], cpus: number[], hitchMs: number): WindowStats {
  const duration = dts.reduce((a, b) => a + b, 0);
  const ok = dts.filter((d) => d <= hitchMs).sort((a, b) => a - b);
  const keep = ok.slice(0, Math.max(1, ok.length - Math.ceil(ok.length * 0.1)));
  const cpu = cpus.filter((c) => Number.isFinite(c)).sort((a, b) => a - b);
  return {
    median: quantile(ok, 0.5),
    mean: keep.length ? keep.reduce((a, b) => a + b, 0) / keep.length : NaN,
    p90: quantile(ok, 0.9),
    cpuMedian: cpu.length ? quantile(cpu, 0.5) : NaN,
    hitches: dts.length ? (dts.length - ok.length) / dts.length : 0,
    frames: dts.length,
    duration,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export class ResolutionController {
  private cfg: DrsConfig;
  private _scale: number;
  /** Time since construction (sum of frame intervals), ms. */
  private now = 0;
  private warmupUntil: number;
  private dts: number[] = [];
  private cpus: number[] = [];
  private windowTime = 0;
  /** Frames still to skip after a change. */
  private skip = 0;
  /** An active sequence of downward steps: where it started, to judge whether it helps. */
  private dropSeq: { startScale: number; startMedian: number } | null = null;
  private insensitiveUntil = 0;
  private insensitiveHold: number;
  /** An upward probe awaiting its verdict. */
  private probe: { from: number; to: number } | null = null;
  private probeWait: number;
  private stableMs = 0;
  private ceiling = Infinity;
  private ceilingUntil = 0;
  private floorOverloadMs = 0;
  /** Consecutive overloaded windows (the first step down needs two: one slow window is noise). */
  private overloadStreak = 0;
  /** Last evaluated window (for the perf overlay). */
  last: WindowStats | null = null;
  /** Why the last change happened (for the perf overlay and telemetry). */
  lastReason = '';

  constructor(config: Partial<DrsConfig> = {}, initialScale?: number) {
    this.cfg = { ...DEFAULT_DRS, ...config };
    this._scale = this.clamp(initialScale ?? this.cfg.maxScale);
    this.warmupUntil = this.cfg.warmupMs;
    this.probeWait = this.cfg.probeWaitMs;
    this.insensitiveHold = this.cfg.insensitiveHoldMs;
  }

  get scale(): number {
    return this._scale;
  }

  get config(): Readonly<DrsConfig> {
    return this.cfg;
  }

  /**
   * New limits (quality tier changed, window moved to another screen, user cap) and a fresh
   * warm-up. The current scale is kept if it is inside the new limits.
   */
  retarget(limits: Partial<Pick<DrsConfig, 'minScale' | 'maxScale' | 'targetMs' | 'canLowerQuality'>>, warmupMs = this.cfg.warmupMs): number {
    this.cfg = { ...this.cfg, ...limits };
    this._scale = this.clamp(this._scale);
    this.restart(warmupMs);
    this.ceiling = Infinity;
    this.ceilingUntil = 0;
    return this._scale;
  }

  /** Forget the current window and wait a little (e.g. the tab was hidden, or a big scene change). */
  restart(warmupMs = 1000): void {
    this.warmupUntil = this.now + warmupMs;
    this.dts = [];
    this.cpus = [];
    this.windowTime = 0;
    this.skip = 0;
    this.dropSeq = null;
    this.probe = null;
    this.stableMs = 0;
    this.floorOverloadMs = 0;
    this.overloadStreak = 0;
  }

  frame(sample: FrameSample): DrsDecision {
    const dt = sample.dtMs;
    if (!(dt > 0) || !Number.isFinite(dt)) return NONE;
    this.now += dt;
    // A very long gap means the tab was hidden or the machine slept: start over.
    if (dt > 2000) {
      this.restart(1000);
      return NONE;
    }
    if (this.now < this.warmupUntil) return NONE;
    if (this.skip > 0) {
      this.skip--;
      return NONE;
    }
    this.dts.push(dt);
    this.cpus.push(sample.cpuMs ?? NaN);
    this.windowTime += dt;
    if (this.windowTime < this.cfg.windowMs || this.dts.length < this.cfg.minFrames) return NONE;
    const stats = windowStats(this.dts, this.cpus, this.cfg.hitchMs);
    this.dts = [];
    this.cpus = [];
    this.windowTime = 0;
    return this.evaluate(stats);
  }

  private evaluate(s: WindowStats): DrsDecision {
    this.last = s;
    const { targetMs: target, minScale, maxScale } = this.cfg;
    if (s.hitches > 0.25 || !Number.isFinite(s.median)) return NONE; // noisy: no evidence either way
    const overloaded = s.median > target * 1.12 || s.mean > target * 1.2;
    const good = s.median <= target * 1.06 && s.mean <= target * 1.1;

    // Verdict on an upward probe.
    if (this.probe) {
      const { from, to } = this.probe;
      this.probe = null;
      if (!good) {
        this.probeWait = Math.min(this.probeWait * 2, this.cfg.maxProbeWaitMs);
        this.ceiling = to;
        this.ceilingUntil = this.now + this.probeWait * 3;
        return this.setScale(from, `probe to ${to.toFixed(2)} too slow (${s.median.toFixed(1)} ms)`);
      }
      this.probeWait = this.cfg.probeWaitMs;
    }

    if (overloaded) {
      this.stableMs = 0;
      this.overloadStreak++;
      // Did the previous steps down help at all? If the pixel count is roughly halved and frames
      // are no faster, the bottleneck is elsewhere (a frame-rate cap or the CPU): undo.
      if (this.dropSeq) {
        const pixels = (this._scale / this.dropSeq.startScale) ** 2;
        if (pixels <= 0.55 && s.median > this.dropSeq.startMedian * 0.9) {
          const back = this.dropSeq.startScale;
          this.dropSeq = null;
          this.insensitiveUntil = this.now + this.insensitiveHold;
          this.insensitiveHold = Math.min(this.insensitiveHold * 2, this.cfg.maxInsensitiveHoldMs);
          return this.setScale(back, `resolution doesn't help (${s.median.toFixed(1)} ms): restored`);
        }
      }
      if (this.now < this.insensitiveUntil) return NONE;
      // CPU-bound: the main thread alone takes most of the frame; fewer pixels won't help.
      if (Number.isFinite(s.cpuMedian) && s.cpuMedian > s.median * 0.8) return NONE;
      if (this._scale > minScale + 1e-3) {
        if (!this.dropSeq && this.overloadStreak < 2) return NONE;
        const factor = Math.min(0.93, Math.max(0.75, Math.sqrt((target * 0.92) / s.median)));
        const next = Math.max(minScale, round2(this._scale * factor));
        if (next < this._scale) {
          if (!this.dropSeq) this.dropSeq = { startScale: this._scale, startMedian: s.median };
          this.floorOverloadMs = 0;
          return this.setScale(next, `slow (${s.median.toFixed(1)} ms)`);
        }
      }
      // At the floor and still too slow: a cheaper quality tier is the next lever.
      this.floorOverloadMs += s.duration;
      if (this.cfg.canLowerQuality && this.floorOverloadMs >= this.cfg.qualityDownAfterMs) {
        this.floorOverloadMs = 0;
        this.dropSeq = null;
        this.lastReason = `still slow at minimum scale (${s.median.toFixed(1)} ms)`;
        return { type: 'quality-down', reason: this.lastReason };
      }
      return NONE;
    }

    this.floorOverloadMs = 0;
    this.overloadStreak = 0;
    if (good) {
      this.dropSeq = null;
      this.stableMs += s.duration;
    } else {
      this.stableMs = 0;
    }
    if (this.stableMs >= this.probeWait && this._scale < maxScale - 1e-3) {
      let to = Math.min(maxScale, round2(this._scale * this.cfg.probeStep));
      if (this.now < this.ceilingUntil) to = Math.min(to, round2(this.ceiling - 0.02));
      // Not worth a probe (and its risk of a stutter) for less than a few percent.
      if (to >= this._scale + 0.03 || (to === maxScale && to > this._scale)) {
        this.stableMs = 0;
        this.probe = { from: this._scale, to };
        return this.setScale(to, 'headroom probe');
      }
    }
    return NONE;
  }

  private setScale(scale: number, reason: string): DrsDecision {
    const next = this.clamp(round2(scale));
    if (next === this._scale) return NONE;
    this.skip = this.cfg.settleFrames;
    this.dts = [];
    this.cpus = [];
    this.windowTime = 0;
    this._scale = next;
    this.lastReason = reason;
    return { type: 'scale', scale: next, reason };
  }

  private clamp(v: number): number {
    return Math.min(this.cfg.maxScale, Math.max(Math.min(this.cfg.minScale, this.cfg.maxScale), v));
  }
}

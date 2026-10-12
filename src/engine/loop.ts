export interface FrameInfo {
  /** Seconds since last frame, clamped to 0.25 so a backgrounded tab doesn't teleport things. */
  dt: number;
  /** Seconds since the loop started. */
  time: number;
  /** Real milliseconds the last frame took, unclamped (for perf stats). */
  frameMs: number;
}

/** requestAnimationFrame loop with clamped delta time. */
export class Loop {
  private running = false;
  private last = 0;
  private start = 0;

  constructor(private readonly tick: (f: FrameInfo) => void) {}

  run(): void {
    if (this.running) return;
    this.running = true;
    this.start = this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const frameMs = now - this.last;
      this.last = now;
      this.tick({ dt: Math.min(frameMs / 1000, 0.25), time: (now - this.start) / 1000, frameMs });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
  }
}

/** Fixed simulation step: gameplay runs at the same speed whatever the frame rate. */
export const SIM_DT = 1 / 60;

/** Splits frame time into fixed simulation steps, carrying the remainder to the next frame. */
export class FixedStepper {
  private acc = 0;

  steps(dt: number): number {
    this.acc += dt;
    const n = Math.min(Math.floor(this.acc / SIM_DT), 15);
    this.acc = n === 15 ? 0 : this.acc - n * SIM_DT;
    return n;
  }
}

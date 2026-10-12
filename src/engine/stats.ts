/** Rolling frame-time statistics for the perf overlay and telemetry. */
export class FrameStats {
  private samples: number[] = [];
  private i = 0;

  constructor(private readonly capacity = 240) {}

  push(frameMs: number): void {
    if (this.samples.length < this.capacity) this.samples.push(frameMs);
    else this.samples[this.i] = frameMs;
    this.i = (this.i + 1) % this.capacity;
  }

  get count(): number {
    return this.samples.length;
  }

  avgMs(): number {
    if (!this.samples.length) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  fps(): number {
    const avg = this.avgMs();
    return avg > 0 ? 1000 / avg : 0;
  }

  /** The frame time that 95% of frames beat: shows stutter that averages hide. */
  p95Ms(): number {
    return this.quantile(0.95);
  }

  /** Typical frame time, unaffected by the odd hitch. */
  medianMs(): number {
    return this.quantile(0.5);
  }

  private quantile(q: number): number {
    if (!this.samples.length) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  }

  reset(): void {
    this.samples = [];
    this.i = 0;
  }
}

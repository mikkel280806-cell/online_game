/** One received state of the remote player, stamped with the sender's clock (ms). */
export interface Snapshot {
  ts: number;
  x: number;
  z: number;
  ry: number;
  speed: number;
}

const MAX_BUFFER = 32;
const MAX_EXTRAPOLATE_MS = 150;

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Buffers remote snapshots and samples them slightly in the past, so motion stays smooth
 * even when packets arrive unevenly.
 *
 * Clocks differ between machines, so we track `offset = localReceiveTime - senderTs`.
 * The smallest offset seen is the one with the least network delay; we follow it,
 * letting it creep upward slowly in case the clocks drift apart.
 */
export class SnapshotBuffer {
  private buf: Snapshot[] = [];
  private offset: number | null = null;

  push(s: Snapshot, localNow: number): void {
    const o = localNow - s.ts;
    this.offset = this.offset === null ? o : Math.min(o, this.offset + 0.05);
    const last = this.buf[this.buf.length - 1];
    if (last && s.ts <= last.ts) return; // late or duplicate (state channel is unordered)
    this.buf.push(s);
    if (this.buf.length > MAX_BUFFER) this.buf.shift();
  }

  get size(): number {
    return this.buf.length;
  }

  /** Sample at `localNow - delayMs`, in the sender's timeline. */
  sample(localNow: number, delayMs: number): Snapshot | null {
    if (this.buf.length === 0 || this.offset === null) return null;
    const t = localNow - this.offset - delayMs;
    const b = this.buf;
    if (t <= b[0].ts) return { ...b[0] };
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1];
      const c = b[i];
      if (t >= a.ts && t <= c.ts) {
        const k = (t - a.ts) / Math.max(1, c.ts - a.ts);
        return {
          ts: t,
          x: a.x + (c.x - a.x) * k,
          z: a.z + (c.z - a.z) * k,
          ry: lerpAngle(a.ry, c.ry, k),
          speed: a.speed + (c.speed - a.speed) * k,
        };
      }
    }
    // Past the newest snapshot: extrapolate briefly along the last velocity, then hold.
    const last = b[b.length - 1];
    const prev = b[b.length - 2];
    if (!prev) return { ...last };
    const ahead = Math.min(t - last.ts, MAX_EXTRAPOLATE_MS);
    const span = Math.max(1, last.ts - prev.ts);
    return {
      ts: t,
      x: last.x + ((last.x - prev.x) / span) * ahead,
      z: last.z + ((last.z - prev.z) / span) * ahead,
      ry: last.ry,
      speed: last.speed,
    };
  }

  clear(): void {
    this.buf = [];
    this.offset = null;
  }
}

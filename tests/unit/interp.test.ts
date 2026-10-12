import { describe, expect, it } from 'vitest';
import { lerpAngle, SnapshotBuffer } from '../../src/game/interp';

const snap = (ts: number, x: number) => ({ ts, x, z: 0, ry: 0, speed: 0 });

describe('SnapshotBuffer', () => {
  it('returns null when empty', () => {
    expect(new SnapshotBuffer().sample(1000, 100)).toBeNull();
  });

  it('interpolates between snapshots in the sender timeline', () => {
    const b = new SnapshotBuffer();
    // Sender clock is 5000 ms behind ours; 50 ms network delay.
    b.push(snap(0, 0), 5050);
    b.push(snap(50, 1), 5100);
    b.push(snap(100, 2), 5150);
    // At local 5175 with 100 ms delay we want sender time 25 -> x = 0.5.
    expect(b.sample(5175, 100)!.x).toBeCloseTo(0.5);
  });

  it('ignores late and duplicate snapshots', () => {
    const b = new SnapshotBuffer();
    b.push(snap(100, 2), 1100);
    b.push(snap(50, 1), 1101);
    b.push(snap(100, 9), 1102);
    expect(b.size).toBe(1);
  });

  it('extrapolates a little past the newest snapshot, then holds', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 0), 1000);
    b.push(snap(100, 1), 1100);
    // 50 ms past newest: continue at 1 unit / 100 ms.
    expect(b.sample(1250, 100)!.x).toBeCloseTo(1.5);
    // Way past: capped at 150 ms of extrapolation.
    expect(b.sample(5000, 100)!.x).toBeCloseTo(2.5);
  });
});

describe('lerpAngle', () => {
  it('takes the short way around', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
  });
});

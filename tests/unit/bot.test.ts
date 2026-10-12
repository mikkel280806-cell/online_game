import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Avatar } from '../../src/characters';
import { Bot } from '../../src/game/bot';
import type { Collider } from '../../src/game/collision';
import { LocalPlayer, NO_CONTROL, type Ground } from '../../src/game/player';

// The bot's brain doesn't need a real 3D model.
const fakeAvatar = { role: 'tether', root: {}, animate() {} } as unknown as Avatar;
const flat = (colliders: Collider[] = []): Ground => ({
  colliders,
  bounds: { cx: 0, cz: 0, radius: 200 },
  heightAt: () => 0,
});
const dist = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

function simulate(bot: Bot, leader: LocalPlayer, ground: Ground, seconds: number, onStep?: () => void) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    leader.update(NO_CONTROL, dt, ground);
    bot.update(dt, leader, ground);
    onStep?.();
  }
}

describe('Bot', () => {
  it('catches up with a distant leader and stops nearby', () => {
    const leader = new LocalPlayer(fakeAvatar, new Vector3(0, 0, 0));
    const bot = new Bot(new LocalPlayer(fakeAvatar, new Vector3(40, 0, 25)));
    simulate(bot, leader, flat(), 15);
    const d = dist(bot.player.position, leader.position);
    expect(d).toBeLessThan(5);
    expect(d).toBeGreaterThan(1.2);
  });

  it('never walks into the leader', () => {
    const leader = new LocalPlayer(fakeAvatar, new Vector3(0, 0, 0));
    const bot = new Bot(new LocalPlayer(fakeAvatar, new Vector3(0, 0, 12)));
    let closest = Infinity;
    simulate(bot, leader, flat(), 20, () => {
      closest = Math.min(closest, dist(bot.player.position, leader.position));
    });
    expect(closest).toBeGreaterThan(1.0);
  });

  it('gets around a wall between it and the leader', () => {
    const wall: Collider = { kind: 'box', minX: -6, maxX: 6, minZ: 9, maxZ: 10 };
    const leader = new LocalPlayer(fakeAvatar, new Vector3(0, 0, 0));
    const bot = new Bot(new LocalPlayer(fakeAvatar, new Vector3(0, 0, 18)));
    simulate(bot, leader, flat([wall]), 25);
    expect(dist(bot.player.position, leader.position)).toBeLessThan(6);
  });

  it('wanders off to explore when the leader stands still', () => {
    const leader = new LocalPlayer(fakeAvatar, new Vector3(0, 0, 0));
    const bot = new Bot(new LocalPlayer(fakeAvatar, new Vector3(3, 0, 0)));
    const states = new Set<string>();
    simulate(bot, leader, flat(), 30, () => states.add(bot.state));
    expect(states.has('explore')).toBe(true);
  });
});

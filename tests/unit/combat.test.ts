import { describe, expect, it } from 'vitest';
import { Combat, DRONE_HP, PLAYER_HP, type Fighter } from '../../src/game/combat';

const flat = () => 0;
const fighter = (role: Fighter['role'], x = 0, z = 0, yaw = 0, extra: Partial<Fighter> = {}): Fighter => ({ role, x, z, yaw, act: false, blocking: false, ...extra });
const step = (c: Combat, fs: Fighter[], seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) c.update(1 / 60, fs);
};

describe('Combat', () => {
  it('starts a wave of drones that close in and shoot', () => {
    const c = new Combat(flat, [], { x: 0, z: -30 });
    c.start();
    expect(c.drones.length).toBe(3);
    const v = fighter('vanguard');
    step(c, [v], 12);
    expect(c.vitals.vanguard.hp).toBeLessThan(PLAYER_HP);
    expect(Math.hypot(c.drones[0].x, c.drones[0].z)).toBeLessThan(15);
  });

  it('the Vanguard strike hits only what is in front and in reach', () => {
    const c = new Combat(flat, [], { x: 0, z: 2 });
    c.start();
    c.drones = c.drones.slice(0, 1);
    Object.assign(c.drones[0], { x: 0, y: 1.5, z: 2 });
    c.attack(fighter('vanguard', 0, 0, Math.PI)); // facing away
    expect(c.drones[0].hp).toBe(DRONE_HP);
    c.vitals.vanguard.attackCd = 0; // the swing above started the cooldown
    c.attack(fighter('vanguard', 0, 0, 0));
    expect(c.drones[0]?.hp ?? 0).toBeLessThan(DRONE_HP);
  });

  it('the Tether auto-aims, and the pulse stuns everything near', () => {
    const c = new Combat(flat, [], { x: 0, z: 10 });
    c.start();
    const t = fighter('tether', 0, 0, 0);
    const target = c.aim(t)!;
    c.attack(t);
    expect(target.hp).toBe(DRONE_HP - 1);
    c.drones.forEach((d) => Object.assign(d, { x: d.x * 0.2, z: 5 }));
    c.skill(t);
    expect(c.drones.every((d) => d.stun > 0)).toBe(true);
  });

  it('the shield blocks bolts from the front only', () => {
    const c = new Combat(flat, []);
    c.active = true;
    c.addBolt({ x: 0, y: 1.2, z: 3, vx: 0, vy: 0, vz: -10 });
    // Hand-made bolts live in the drawn list: run them through the host path.
    step(c, [fighter('vanguard', 0, 0, 0, { blocking: true })], 0.5);
    expect(c.vitals.vanguard.hp).toBe(PLAYER_HP);
    c.addBolt({ x: 0, y: 1.2, z: -3, vx: 0, vy: 0, vz: 10 });
    step(c, [fighter('vanguard', 0, 0, 0, { blocking: true })], 0.5);
    expect(c.vitals.vanguard.hp).toBeLessThan(PLAYER_HP);
  });

  it('a downed player is revived by a partner holding F', () => {
    const c = new Combat(flat, []);
    c.vitals.tether.hp = 0;
    c.vitals.tether.downed = true;
    step(c, [fighter('tether', 0, 0), fighter('vanguard', 1, 0, 0, { act: true })], 2.7);
    expect(c.vitals.tether.downed).toBe(false);
    expect(c.vitals.tether.hp).toBeGreaterThan(0);
  });

  it('round-trips its snapshot for the guest', () => {
    const host = new Combat(flat, [], { x: 0, z: -20 });
    host.start();
    const guest = new Combat(flat, []);
    guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
    expect(guest.active).toBe(true);
    expect(guest.drones.map((d) => d.id)).toEqual(host.drones.map((d) => d.id));
  });
});

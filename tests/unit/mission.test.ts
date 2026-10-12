import { describe, expect, it } from 'vitest';
import { Mission, STATIONS, STEPS, type Actor } from '../../src/game/mission';

const at = (role: Actor['role'], s: keyof typeof STATIONS, act = true): Actor => ({ role, x: STATIONS[s].x, z: STATIONS[s].z, act });
const run = (m: Mission, actors: Actor[], seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) m.update(1 / 60, actors);
};

describe('Mission: restart the beacon', () => {
  it('needs the right role at each station', () => {
    const m = new Mission();
    run(m, [at('tether', 'cabinet')], 5);
    expect(m.step).toBe(0);
    expect(m.prompt('tether', STATIONS.cabinet.x, STATIONS.cabinet.z)?.allowed).toBe(false);
    run(m, [at('vanguard', 'cabinet')], STEPS[0].hold + 0.1);
    expect(m.step).toBe(1);
    run(m, [at('tether', 'terminal')], STEPS[1].hold + 0.1);
    expect(m.step).toBe(2);
  });

  it('the breakers need both players at once', () => {
    const m = new Mission();
    m.apply(2, 0);
    run(m, [at('vanguard', 'cabinet'), at('tether', 'cabinet', false)], 5);
    expect(m.step).toBe(2);
    run(m, [at('vanguard', 'cabinet'), at('tether', 'terminal')], STEPS[2].hold + 0.1);
    expect(m.done).toBe(true);
  });

  it('progress drains when the key is released', () => {
    const m = new Mission();
    run(m, [at('vanguard', 'cabinet')], 0.6);
    const p = m.progress;
    run(m, [at('vanguard', 'cabinet', false)], 0.5);
    expect(m.progress).toBeLessThan(p);
  });

  it('sends a bot to its own step, or to the breaker its partner is not at', () => {
    const m = new Mission();
    expect(m.botStation('tether', STATIONS.cabinet)).toBeNull();
    m.apply(1, 0);
    expect(m.botStation('tether', STATIONS.cabinet)).toBe('terminal');
    m.apply(2, 0);
    expect(m.botStation('vanguard', STATIONS.terminal)).toBe('cabinet');
  });
});

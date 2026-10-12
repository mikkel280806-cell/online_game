import { describe, expect, it } from 'vitest';
import { buildSuit } from '../../src/characters/suit';

describe('EVA suit geometry', () => {
  for (const role of ['vanguard', 'tether'] as const) {
    it(`${role}: fits the triangle budget`, () => {
      const s = buildSuit(role);
      console.info(`[suit] ${role} triangles=${s.triangles}`, JSON.stringify(Object.fromEntries(s.stats)));
      expect(s.triangles).toBeLessThanOrEqual(25_000);
      // Skin weights are normalised and reference real bones.
      const w = s.body.getAttribute('skinWeight');
      const idx = s.body.getAttribute('skinIndex');
      for (let i = 0; i < w.count; i += 7) {
        const sum = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
        expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
        expect(idx.getX(i)).toBeLessThan(21);
        expect(idx.getY(i)).toBeLessThan(21);
      }
    });
  }
});

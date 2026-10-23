import { describe, expect, it } from 'vitest';
import { pickSpawnValue, seededRng, spawnRange } from '../src/core/spawn';

describe('spawn', () => {
  it('faixa inicial é 2..8', () => {
    expect(spawnRange(0)).toEqual({ min: 1, max: 3 });
  });

  it('faixa cresce com o maior bloco e respeita o teto', () => {
    expect(spawnRange(1024)).toEqual({ min: 1, max: 6 });
    expect(spawnRange(2 ** 20)).toEqual({ min: 4, max: 9 });
  });

  it('valores gerados ficam sempre dentro da faixa', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 2000; i++) {
      const v = pickSpawnValue(4096, rng);
      const e = Math.log2(v);
      expect(e).toBeGreaterThanOrEqual(2);
      expect(e).toBeLessThanOrEqual(8);
    }
  });
});

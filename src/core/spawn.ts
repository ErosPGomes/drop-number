/** Gerador de valores dos próximos blocos. RNG injetável para testes determinísticos. */

export type Rng = () => number;

export interface SpawnRange {
  /** Expoentes inclusivos: valores 2^min .. 2^max. */
  readonly min: number;
  readonly max: number;
}

const MIN_TOP = 3; // 8: começo do jogo oferece 2, 4, 8
const MAX_TOP = 9; // 512: teto de spawn mesmo em tabuleiros muito altos
const SPREAD = 5; // largura da faixa: evita spawns pequenos demais que travam o fim de jogo

export function spawnRange(maxOnBoard: number): SpawnRange {
  const exp = Math.floor(Math.log2(Math.max(2, maxOnBoard)));
  const max = Math.min(MAX_TOP, Math.max(MIN_TOP, exp - 4));
  const min = Math.max(1, max - SPREAD);
  return { min, max };
}

/** Peso linear decrescente: valores menores são mais frequentes, o maior ainda aparece. */
export function pickSpawnValue(maxOnBoard: number, rng: Rng): number {
  const { min, max } = spawnRange(maxOnBoard);
  const weights: number[] = [];
  for (let e = min; e <= max; e++) weights.push(max - e + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return 2 ** (min + i);
  }
  return 2 ** max;
}

/** mulberry32: PRNG de 32 bits, período 2^32, suficiente para testes e replays. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

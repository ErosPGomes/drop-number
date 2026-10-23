import { describe, expect, it } from 'vitest';
import { Board, COLS, ROWS, type BoardSnapshot } from '../src/core/board';

const empty = (): BoardSnapshot => Array.from({ length: COLS }, () => []);
const withCols = (cols: Record<number, number[]>): BoardSnapshot => {
  const s = empty();
  for (const [c, v] of Object.entries(cols)) s[Number(c)] = v;
  return s;
};

describe('Board.drop', () => {
  it('empilha sem fundir valores diferentes', () => {
    const b = new Board(withCols({ 0: [4] }));
    const res = b.drop(0, 8);
    expect(res.landing).toEqual({ col: 0, row: 1 });
    expect(res.steps).toHaveLength(0);
    expect(b.snapshot()[0]).toEqual([4, 8]);
  });

  it('funde com o bloco de baixo e ocupa a posição de baixo', () => {
    const b = new Board(withCols({ 2: [8] }));
    const res = b.drop(2, 8);
    expect(b.snapshot()[2]).toEqual([16]);
    const merge = res.steps[0];
    expect(merge.kind).toBe('merge');
    if (merge.kind === 'merge') {
      expect(merge.to).toEqual({ col: 2, row: 0 });
      expect(merge.value).toBe(16);
    }
    expect(res.scoreGained).toBe(16);
  });

  it('funde três blocos (esquerda + direita) em v*4', () => {
    const b = new Board(withCols({ 0: [8], 2: [8] }));
    b.drop(1, 8);
    expect(b.snapshot()).toEqual(withCols({ 1: [32] }));
  });

  it('funde quatro blocos (esquerda + direita + baixo) em v*8', () => {
    const b = new Board(withCols({ 0: [2, 8], 1: [8], 2: [2, 8] }));
    b.drop(1, 8);
    expect(b.snapshot()).toEqual(withCols({ 0: [2], 1: [64], 2: [2] }));
  });

  it('resolve cadeia em cascata e incrementa o combo', () => {
    // 4 cai sobre 4 -> 8, que encontra 8 abaixo -> 16, que encontra 16 abaixo -> 32
    const b = new Board(withCols({ 0: [16, 8, 4] }));
    const res = b.drop(0, 4);
    expect(b.snapshot()[0]).toEqual([32]);
    const chains = res.steps.filter((s) => s.kind === 'merge').map((s) => (s.kind === 'merge' ? s.chain : 0));
    expect(chains).toEqual([1, 2, 3]);
    expect(res.scoreGained).toBe(8 + 16 + 32);
  });

  it('gravidade após fusão lateral derruba blocos de cima e reavalia', () => {
    // col0=[8], col1=[8,4]. O 4 solto em col0 pousa em row1 e absorve o 4 da direita -> 8;
    // esse 8 encontra o 8 abaixo -> 16 em col0,row0.
    const b = new Board(withCols({ 0: [8], 1: [8, 4] }));
    b.drop(0, 4);
    expect(b.snapshot()).toEqual(withCols({ 0: [16], 1: [8] }));
  });

  it('aceita coluna cheia quando o topo é igual', () => {
    const full = [2, 4, 2, 4, 2, 4, 8];
    const b = new Board(withCols({ 0: full }));
    expect(b.canDrop(0, 8)).toBe(true);
    expect(b.canDrop(0, 4)).toBe(false);
    const res = b.drop(0, 8);
    expect(res.landing.row).toBe(ROWS);
    expect(b.snapshot()[0]).toEqual([2, 4, 2, 4, 2, 4, 16]);
  });

  it('rejeita coluna cheia sem fusão', () => {
    const b = new Board(withCols({ 0: [2, 4, 2, 4, 2, 4, 8] }));
    expect(() => b.drop(0, 2)).toThrow();
  });
});

describe('power-ups', () => {
  it('removeTile aplica gravidade e resolve fusões', () => {
    const b = new Board(withCols({ 0: [4, 2, 4] }));
    const middle = b.get(0, 1)!;
    const res = b.removeTile(middle.id);
    expect(b.snapshot()[0]).toEqual([8]);
    expect(res.steps[0].kind).toBe('fall');
    expect(res.scoreGained).toBe(8);
  });

  it('removeValue remove todas as ocorrências', () => {
    const b = new Board(withCols({ 0: [2, 4], 1: [2], 3: [8, 2] }));
    const res = b.removeValue(2);
    expect(res.removed).toHaveLength(3);
    expect(b.snapshot()).toEqual(withCols({ 0: [4], 3: [8] }));
  });
});

describe('snapshot', () => {
  it('rejeita dados corrompidos', () => {
    expect(() => new Board([[3]] as BoardSnapshot)).toThrow();
    expect(() => new Board(withCols({ 0: [2, 2, 2, 2, 2, 2, 2, 2] }))).toThrow();
  });

  it('round-trip preserva valores', () => {
    const s = withCols({ 0: [2, 4], 4: [1024] });
    expect(new Board(s).snapshot()).toEqual(s);
  });
});

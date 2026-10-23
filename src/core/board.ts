/**
 * Regras puras do tabuleiro (sem DOM, sem tempo). Toda jogada devolve uma lista
 * de passos (`Step`) que o renderizador reproduz em sequência; isso desacopla a
 * simulação da animação e torna a lógica testável de forma determinística.
 */

export const COLS = 5;
export const ROWS = 7;

export interface Pos {
  readonly col: number;
  /** 0 = base da coluna. `ROWS` é um slot transitório usado ao soltar em coluna cheia com topo igual. */
  readonly row: number;
}

export interface Tile {
  readonly id: number;
  value: number;
}

export interface AbsorbedTile {
  readonly id: number;
  readonly from: Pos;
  readonly value: number;
}

export interface MergeStep {
  readonly kind: 'merge';
  /** Bloco que sobrevive à fusão (recebe o novo valor). */
  readonly id: number;
  readonly from: Pos;
  readonly to: Pos;
  readonly value: number;
  readonly absorbed: readonly AbsorbedTile[];
  /** Posição da fusão na cadeia desta jogada (1 = primeira). Base do combo. */
  readonly chain: number;
}

export interface Move {
  readonly id: number;
  readonly from: Pos;
  readonly to: Pos;
}

export interface FallStep {
  readonly kind: 'fall';
  readonly moves: readonly Move[];
}

export type Step = MergeStep | FallStep;

export interface Resolution {
  readonly steps: readonly Step[];
  readonly scoreGained: number;
}

export interface DropResult extends Resolution {
  readonly id: number;
  readonly landing: Pos;
}

export interface RemovalResult extends Resolution {
  readonly removed: readonly AbsorbedTile[];
}

/** Valores por coluna, da base para o topo. Formato estável para persistência. */
export type BoardSnapshot = number[][];

const CAPACITY = ROWS + 1;

// Ordem importa: "abaixo" primeiro porque define o destino da fusão.
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

const isPowerOfTwo = (n: number): boolean => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;

export class Board {
  // cells[col][row]; coluna sempre compactada (sem buracos) após cada operação pública.
  private readonly cells: (Tile | null)[][];
  private nextId = 1;

  constructor(snapshot?: BoardSnapshot) {
    this.cells = Array.from({ length: COLS }, () => Array<Tile | null>(CAPACITY).fill(null));
    if (snapshot) this.restore(snapshot);
  }

  private restore(snapshot: BoardSnapshot): void {
    if (!Array.isArray(snapshot) || snapshot.length !== COLS) throw new Error('snapshot inválido');
    snapshot.forEach((column, c) => {
      if (!Array.isArray(column) || column.length > ROWS) throw new Error('coluna inválida');
      column.forEach((value, r) => {
        if (!isPowerOfTwo(value)) throw new Error(`valor inválido: ${value}`);
        this.cells[c][r] = { id: this.nextId++, value };
      });
    });
  }

  snapshot(): BoardSnapshot {
    return this.cells.map((col) => col.slice(0, ROWS).filter((t): t is Tile => t !== null).map((t) => t.value));
  }

  get(col: number, row: number): Tile | null {
    if (col < 0 || col >= COLS || row < 0 || row >= CAPACITY) return null;
    return this.cells[col][row];
  }

  height(col: number): number {
    const column = this.cells[col];
    let h = 0;
    while (h < CAPACITY && column[h] !== null) h++;
    return h;
  }

  heights(): number[] {
    return Array.from({ length: COLS }, (_, c) => this.height(c));
  }

  /** Coluna aceita o bloco se há espaço ou se o topo (cheio) é igual e vai fundir. */
  canDrop(col: number, value: number): boolean {
    const h = this.height(col);
    if (h < ROWS) return true;
    return this.cells[col][ROWS - 1]?.value === value;
  }

  validColumns(value: number): number[] {
    return Array.from({ length: COLS }, (_, c) => c).filter((c) => this.canDrop(c, value));
  }

  tiles(): { tile: Tile; pos: Pos }[] {
    const out: { tile: Tile; pos: Pos }[] = [];
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < CAPACITY; r++) {
        const tile = this.cells[c][r];
        if (tile) out.push({ tile, pos: { col: c, row: r } });
      }
    }
    return out;
  }

  maxValue(): number {
    return this.tiles().reduce((m, { tile }) => Math.max(m, tile.value), 0);
  }

  isEmpty(): boolean {
    return this.cells.every((col) => col[0] === null);
  }

  drop(col: number, value: number): DropResult {
    if (!isPowerOfTwo(value)) throw new Error(`valor inválido: ${value}`);
    if (!this.canDrop(col, value)) throw new Error(`coluna ${col} não aceita ${value}`);
    const tile: Tile = { id: this.nextId++, value };
    const landing: Pos = { col, row: this.height(col) };
    this.cells[col][landing.row] = tile;
    return { id: tile.id, landing, ...this.resolve(new Set([tile.id])) };
  }

  /** Martelo: remove um bloco, aplica gravidade e resolve fusões em cascata. */
  removeTile(id: number): RemovalResult {
    const found = this.locate(id);
    if (!found) throw new Error(`bloco ${id} não existe`);
    this.cells[found.pos.col][found.pos.row] = null;
    return this.afterRemoval([{ id, from: found.pos, value: found.tile.value }]);
  }

  /** Super martelo: remove todos os blocos com o valor informado. */
  removeValue(value: number): RemovalResult {
    const removed: AbsorbedTile[] = [];
    for (const { tile, pos } of this.tiles()) {
      if (tile.value !== value) continue;
      this.cells[pos.col][pos.row] = null;
      removed.push({ id: tile.id, from: pos, value });
    }
    return this.afterRemoval(removed);
  }

  private afterRemoval(removed: AbsorbedTile[]): RemovalResult {
    const moves = this.applyGravity();
    const prefix: Step[] = moves.length ? [{ kind: 'fall', moves }] : [];
    const res = this.resolve(new Set(moves.map((m) => m.id)));
    return { removed, steps: [...prefix, ...res.steps], scoreGained: res.scoreGained };
  }

  private locate(id: number): { tile: Tile; pos: Pos } | null {
    // Tabuleiro tem no máximo 40 slots: varredura linear é mais barata que manter um índice sincronizado.
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < CAPACITY; r++) {
        const tile = this.cells[c][r];
        if (tile?.id === id) return { tile, pos: { col: c, row: r } };
      }
    }
    return null;
  }

  private matches(pos: Pos, value: number): { tile: Tile; pos: Pos }[] {
    const out: { tile: Tile; pos: Pos }[] = [];
    for (const [dc, dr] of NEIGHBOURS) {
      const p = { col: pos.col + dc, row: pos.row + dr };
      const t = this.get(p.col, p.row);
      if (t && t.value === value) out.push({ tile: t, pos: p });
    }
    return out;
  }

  /**
   * Resolve fusões até estabilizar. Um bloco ativo absorve todos os vizinhos iguais
   * de uma vez: valor final = v * 2^k (k vizinhos). Se o vizinho de baixo participa,
   * o resultado ocupa a posição de baixo (o bloco "cai" na fusão).
   * Termina sempre: cada fusão reduz o número de blocos em >= 1.
   */
  private resolve(active: Set<number>): Resolution {
    const steps: Step[] = [];
    let chain = 0;
    let scoreGained = 0;

    for (;;) {
      const candidates = [...active]
        .map((id) => this.locate(id))
        .filter((x): x is { tile: Tile; pos: Pos } => x !== null)
        .sort((a, b) => a.pos.row - b.pos.row || a.pos.col - b.pos.col);

      let merged = false;
      for (const { tile, pos } of candidates) {
        const found = this.matches(pos, tile.value);
        if (found.length === 0) {
          active.delete(tile.id);
          continue;
        }

        const below = found.find((m) => m.pos.col === pos.col && m.pos.row === pos.row - 1);
        const to = below ? below.pos : pos;
        const absorbed: AbsorbedTile[] = found.map((m) => ({ id: m.tile.id, from: m.pos, value: m.tile.value }));

        for (const m of found) {
          this.cells[m.pos.col][m.pos.row] = null;
          active.delete(m.tile.id);
        }
        this.cells[pos.col][pos.row] = null;
        tile.value *= 2 ** found.length;
        this.cells[to.col][to.row] = tile;

        chain++;
        scoreGained += tile.value;
        steps.push({ kind: 'merge', id: tile.id, from: pos, to, value: tile.value, absorbed, chain });

        const moves = this.applyGravity();
        if (moves.length) {
          steps.push({ kind: 'fall', moves });
          for (const m of moves) active.add(m.id);
        }
        active.add(tile.id);
        merged = true;
        break;
      }
      if (!merged) break;
    }
    return { steps, scoreGained };
  }

  /** Compacta cada coluna em O(COLS * CAPACITY) e devolve os deslocamentos. */
  private applyGravity(): Move[] {
    const moves: Move[] = [];
    for (let c = 0; c < COLS; c++) {
      const column = this.cells[c];
      let write = 0;
      for (let r = 0; r < CAPACITY; r++) {
        const tile = column[r];
        if (!tile) continue;
        if (r !== write) {
          column[write] = tile;
          column[r] = null;
          moves.push({ id: tile.id, from: { col: c, row: r }, to: { col: c, row: write } });
        }
        write++;
      }
    }
    return moves;
  }
}

import type { BoardSnapshot } from '../core/board';

export interface GameSnapshot {
  grid: BoardSnapshot;
  score: number;
  current: number;
  next: number;
  col: number;
  maxTile: number;
  hammers: number;
  supers: number;
}

export interface SaveData {
  best: number;
  coins: number;
  muted: boolean;
  game: GameSnapshot | null;
}

const KEY = 'drop-number:v1';

const DEFAULTS: SaveData = { best: 0, coins: 0, muted: false, game: null };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function parseGame(raw: unknown): GameSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const fields = ['score', 'current', 'next', 'col', 'maxTile', 'hammers', 'supers'] as const;
  if (!fields.every((f) => isNum(g[f])) || !Array.isArray(g.grid)) return null;
  // Validação estrutural do grid fica com Board (lança em dado inválido).
  return g as unknown as GameSnapshot;
}

/** localStorage pode lançar (modo privado, cota, WebView restrita): toda falha degrada para defaults. */
export function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const d = JSON.parse(raw) as Record<string, unknown>;
    return {
      best: isNum(d.best) ? d.best : 0,
      coins: isNum(d.coins) ? d.coins : 0,
      muted: d.muted === true,
      game: parseGame(d.game),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* sem persistência disponível: o jogo segue funcionando em memória */
  }
}

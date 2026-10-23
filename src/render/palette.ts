/** Cores por valor, inspiradas no Drop the Number. Valores acima da tabela recebem matiz derivado do expoente. */

const BASE: Readonly<Record<number, string>> = {
  2: '#e8607d',
  4: '#5bbe5b',
  8: '#45c8c8',
  16: '#3e87da',
  32: '#e05b49',
  64: '#8c5bd8',
  128: '#9b8f86',
  256: '#f5a531',
  512: '#e3478f',
  1024: '#c2362b',
  2048: '#2fb37a',
  4096: '#3f51b5',
  8192: '#d84315',
};

const cache = new Map<string, string>();

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function tileColor(value: number): string {
  const known = BASE[value];
  if (known) return known;
  const exp = Math.log2(value);
  return hslToHex((exp * 47) % 360, 0.62, 0.48);
}

function parse(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mistura duas cores hex. Resultado memoizado: chamado por bloco a cada frame. */
export function mix(a: string, b: string, t: number): string {
  const q = Math.round(t * 100) / 100;
  const key = `${a}|${b}|${q}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const out =
    '#' +
    [r1 + (r2 - r1) * q, g1 + (g2 - g1) * q, b1 + (b2 - b1) * q]
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('');
  if (cache.size > 4096) cache.clear();
  cache.set(key, out);
  return out;
}

/** amount < 0 escurece, > 0 clareia. */
export function shade(hex: string, amount: number): string {
  return amount < 0 ? mix(hex, '#000000', -amount) : mix(hex, '#ffffff', amount);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function formatValue(value: number): string {
  if (value < 10000) return String(value);
  if (value < 1_000_000) return `${Math.round(value / 1024)}K`;
  return `${Math.round(value / 1_048_576)}M`;
}

export function formatScore(n: number): string {
  return Math.round(n).toLocaleString('pt-BR');
}

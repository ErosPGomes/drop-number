/**
 * Sistema de partículas em unidades de grade (1 = uma célula), independente de
 * resolução: um resize no meio da animação não distorce trajetórias.
 * Pool limitado (MAX) para manter custo de desenho O(MAX) no pior caso.
 */

export type Shape = 'square' | 'circle' | 'star' | 'shard';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  gravity: number;
  drag: number;
  shape: Shape;
}

export interface BurstOptions {
  count: number;
  color: string | readonly string[];
  speed?: number;
  size?: number;
  ttl?: number;
  gravity?: number;
  drag?: number;
  shape?: Shape;
  /** Ângulo central (rad) e abertura; padrão = 360°. */
  angle?: number;
  spread?: number;
}

const MAX = 700;

export class Particles {
  private list: Particle[] = [];

  burst(x: number, y: number, o: BurstOptions): void {
    const colors = typeof o.color === 'string' ? [o.color] : o.color;
    const spread = o.spread ?? Math.PI * 2;
    const center = o.angle ?? 0;
    for (let i = 0; i < o.count; i++) {
      if (this.list.length >= MAX) this.list.shift();
      const a = center + (Math.random() - 0.5) * spread;
      const sp = (o.speed ?? 4) * (0.45 + Math.random() * 0.75);
      this.list.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0,
        ttl: (o.ttl ?? 650) * (0.7 + Math.random() * 0.6),
        size: (o.size ?? 0.12) * (0.6 + Math.random() * 0.8),
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 14,
        gravity: o.gravity ?? 9,
        drag: o.drag ?? 1.6,
        shape: o.shape ?? 'square',
      });
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    let w = 0;
    for (const p of this.list) {
      p.life += dtMs;
      if (p.life >= p.ttl) continue;
      const damp = Math.exp(-p.drag * dt); // amortecimento independente de framerate
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  draw(ctx: CanvasRenderingContext2D, toPx: (gx: number, gy: number) => [number, number], cell: number): void {
    for (const p of this.list) {
      const k = p.life / p.ttl;
      const [x, y] = toPx(p.x, p.y);
      const s = p.size * cell * (1 - k * 0.6);
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - k) * 1.6);
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      switch (p.shape) {
        case 'circle':
          ctx.beginPath();
          ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'star':
          drawStar(ctx, s);
          break;
        case 'shard':
          ctx.beginPath();
          ctx.moveTo(-s / 2, -s / 3);
          ctx.lineTo(s / 2, -s / 2);
          ctx.lineTo(s / 4, s / 2);
          ctx.closePath();
          ctx.fill();
          break;
        default:
          ctx.fillRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }
  }

  clear(): void {
    this.list.length = 0;
  }

  get size(): number {
    return this.list.length;
  }
}

function drawStar(ctx: CanvasRenderingContext2D, s: number): void {
  const r1 = s / 2;
  const r2 = s / 5;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = (i * Math.PI) / 4;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

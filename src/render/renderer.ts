import { COLS, ROWS, type FallStep, type MergeStep, type Pos } from '../core/board';
import { ease, Tweener } from '../engine/tween';
import { formatValue, mix, rgba, shade, tileColor } from './palette';
import { Particles } from './particles';

/**
 * Estado visual de um bloco em unidades de grade: gx = coluna, gy = linha a partir
 * do topo (0 = linha mais alta). Desacoplado de pixels para sobreviver a resize.
 */
export interface VisualTile {
  id: number;
  value: number;
  gx: number;
  gy: number;
  scale: number;
  sx: number;
  sy: number;
  alpha: number;
  flash: number;
  rot: number;
  gray: number;
  z: number;
}

export type TargetMode = 'none' | 'hammer' | 'super';

interface FloatText {
  text: string;
  gx: number;
  gy: number;
  t: number;
  ttl: number;
  color: string;
  size: number;
}

/** Slots independentes: combo e recorde podem coexistir sem se sobrescrever. */
export type BannerSlot = 'combo' | 'record';

interface Banner {
  slot: BannerSlot;
  text: string;
  sub: string;
  t: number;
  ttl: number;
  color: string;
}

interface Celebration {
  value: number;
  t: number;
  ttl: number;
  resolve: () => void;
}

const LANE_UNITS = 1.55; // altura da faixa de spawn + barra de tempo acima da grade
const LANE_GY = -1.12;
const TILE_FILL = 0.9;
const BG = '#2a2a2e';
const COL_A = '#303035';
const COL_B = '#2c2c31';
const GOLD = '#f7c843';

export const rowToGy = (row: number): number => ROWS - 1 - row;

const newTile = (id: number, value: number, gx: number, gy: number): VisualTile => ({
  id,
  value,
  gx,
  gy,
  scale: 1,
  sx: 1,
  sy: 1,
  alpha: 1,
  flash: 0,
  rot: 0,
  gray: 0,
  z: 0,
});

export class Renderer {
  readonly tw = new Tweener();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly particles = new Particles();
  private readonly overlayFx = new Particles();
  private readonly tiles = new Map<number, VisualTile>();
  private current: VisualTile | null = null;

  private width = 0;
  private height = 0;
  private cell = 0;
  private ox = 0;
  private oy = 0;
  private top = 0;

  private time = 0;
  private shakeMag = 0;
  private danger = 0;
  private heights: number[] = Array<number>(COLS).fill(0);
  private texts: FloatText[] = [];
  private banners: Banner[] = [];
  private celebration: Celebration | null = null;
  private rejectCol = -1;
  private rejectT = 0;

  selCol = 2;
  hoverCol = -1;
  timerFrac = 1;
  showTimer = true;
  targetMode: TargetMode = 'none';
  maxValue = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D indisponível');
    this.ctx = ctx;
    this.resize();
  }

  // ---------------------------------------------------------------- layout

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // DPR limitado a 2.5: acima disso o ganho visual é imperceptível e o fill-rate dobra.
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = 6;
    this.cell = Math.floor(Math.min((this.width - pad * 2) / COLS, (this.height - pad * 2) / (ROWS + LANE_UNITS)));
    const totalH = this.cell * (ROWS + LANE_UNITS);
    this.ox = (this.width - this.cell * COLS) / 2;
    this.top = Math.max(pad, (this.height - totalH) / 2);
    this.oy = this.top + this.cell * LANE_UNITS;
  }

  private px(gx: number): number {
    return this.ox + (gx + 0.5) * this.cell;
  }

  private py(gy: number): number {
    return this.oy + (gy + 0.5) * this.cell;
  }

  private readonly toPx = (gx: number, gy: number): [number, number] => [this.px(gx), this.py(gy)];

  colAt(x: number): number {
    return Math.max(0, Math.min(COLS - 1, Math.floor((x - this.ox) / this.cell)));
  }

  /** Retorna a posição lógica da célula sob o ponto, ou null fora da grade. */
  cellAt(x: number, y: number): Pos | null {
    const c = Math.floor((x - this.ox) / this.cell);
    const gy = Math.floor((y - this.oy) / this.cell);
    if (c < 0 || c >= COLS || gy < 0 || gy >= ROWS) return null;
    return { col: c, row: rowToGy(gy) };
  }

  inBoard(x: number, y: number): boolean {
    return x >= this.ox && x <= this.ox + this.cell * COLS && y >= this.top && y <= this.oy + this.cell * ROWS;
  }

  // ---------------------------------------------------------------- estado

  setHeights(heights: readonly number[]): void {
    this.heights = [...heights];
  }

  syncTiles(list: readonly { id: number; value: number; pos: Pos }[]): void {
    this.tiles.clear();
    for (const { id, value, pos } of list) this.tiles.set(id, newTile(id, value, pos.col, rowToGy(pos.row)));
  }

  /** Entrada do tabuleiro salvo: blocos caem em cascata da esquerda para a direita. */
  async introTiles(): Promise<void> {
    const anims: Promise<void>[] = [];
    let i = 0;
    for (const t of this.tiles.values()) {
      const targetGy = t.gy;
      t.gy = -2 - Math.random();
      t.alpha = 0;
      const delay = i++ * 22;
      anims.push(this.tw.to(t, { alpha: 1 }, 120, ease.linear, delay));
      anims.push(this.tw.to(t, { gy: targetGy }, 420, ease.outBounce, delay));
    }
    await Promise.all(anims);
  }

  // ---------------------------------------------------------------- bloco atual

  async spawnCurrent(value: number, col: number): Promise<void> {
    const t = newTile(-1, value, col, LANE_GY - 0.4);
    t.scale = 0;
    t.alpha = 0;
    t.z = 5;
    this.current = t;
    this.selCol = col;
    this.overlayFx.burst(col, LANE_GY, { count: 10, color: [tileColor(value), '#ffffff'], speed: 3, gravity: 0, shape: 'star', ttl: 420 });
    await Promise.all([
      this.tw.to(t, { scale: 1, gy: LANE_GY }, 320, ease.outBack),
      this.tw.to(t, { alpha: 1 }, 140, ease.linear),
    ]);
  }

  moveCurrent(col: number): void {
    this.selCol = col;
    if (!this.current) return;
    void this.tw.to(this.current, { gx: col }, 120, ease.outCubic);
    // Inclinação na direção do movimento reforça a sensação de inércia.
    const dir = Math.sign(col - this.current.gx);
    this.current.rot = dir * 0.12;
    void this.tw.to(this.current, { rot: 0 }, 260, ease.outElastic);
  }

  setCurrentValue(value: number): void {
    if (this.current) this.current.value = value;
  }

  /** Queda acelerada (easeIn ≈ gravidade) com squash na aterrissagem e poeira. */
  async dropCurrent(id: number, landing: Pos): Promise<void> {
    const t = this.current;
    if (!t) return;
    this.current = null;
    this.tw.kill(t);
    t.id = id;
    t.gx = landing.col;
    t.rot = 0;
    t.scale = 1;
    t.alpha = 1;
    t.z = 2;
    this.tiles.set(id, t);

    const targetGy = landing.row >= ROWS ? -1 : rowToGy(landing.row);
    const dist = Math.max(0.2, targetGy - t.gy);
    t.sx = 0.9;
    t.sy = 1.12; // stretch durante a queda
    await this.tw.to(t, { gy: targetGy, sx: 0.94, sy: 1.08 }, 70 + 62 * Math.sqrt(dist), ease.inQuad);
    t.z = 0;
    this.landFx(t, 0.18);
    await this.squash(t, 0.22);
  }

  private landFx(t: VisualTile, strength: number): void {
    this.shakeMag = Math.max(this.shakeMag, strength * 0.25);
    const y = t.gy + 0.45;
    this.particles.burst(t.gx - 0.35, y, { count: 5, color: '#bfbfc6', speed: 1.8, angle: Math.PI, spread: 0.9, gravity: -1, size: 0.1, ttl: 380, shape: 'circle' });
    this.particles.burst(t.gx + 0.35, y, { count: 5, color: '#bfbfc6', speed: 1.8, angle: 0, spread: 0.9, gravity: -1, size: 0.1, ttl: 380, shape: 'circle' });
  }

  private async squash(t: VisualTile, amount: number): Promise<void> {
    await this.tw.to(t, { sx: 1 + amount * 0.7, sy: 1 - amount }, 70, ease.outQuad);
    await this.tw.to(t, { sx: 1, sy: 1 }, 260, ease.outElastic);
  }

  // ---------------------------------------------------------------- fusões

  /**
   * Fusão: absorvidos deslizam para o destino e encolhem; no impacto o sobrevivente
   * troca de valor, pisca, pulsa (scale), emite partículas e texto de pontuação.
   */
  async animateMerge(step: MergeStep, onImpact: () => void): Promise<void> {
    const target = this.tiles.get(step.id);
    if (!target) return;
    const toGx = step.to.col;
    const toGy = step.to.row >= ROWS ? -1 : rowToGy(step.to.row);
    target.z = 3;

    const slide = 135;
    const anims = step.absorbed.map((a) => {
      const v = this.tiles.get(a.id);
      if (!v) return Promise.resolve();
      v.z = 1;
      return this.tw.to(v, { gx: toGx, gy: toGy, scale: 0.78 }, slide, ease.inCubic);
    });
    anims.push(this.tw.to(target, { gx: toGx, gy: toGy }, slide, ease.inCubic));
    await Promise.all(anims);

    for (const a of step.absorbed) this.tiles.delete(a.id);
    target.value = step.value;
    target.flash = 1;
    target.scale = 1;
    onImpact();

    const color = tileColor(step.value);
    const power = step.absorbed.length;
    this.particles.burst(toGx, toGy, { count: 12 + power * 6 + step.chain * 2, color: [color, shade(color, 0.45), '#ffffff'], speed: 4.2 + power, size: 0.13, ttl: 620 });
    this.particles.burst(toGx, toGy, { count: 6 + step.chain * 2, color: ['#fff6c8', GOLD], speed: 2.4, size: 0.2, gravity: 2, ttl: 520, shape: 'star' });
    this.floatText(`+${formatValue(step.value)}`, toGx, toGy - 0.3, color, 0.42 + Math.min(0.25, step.chain * 0.04));
    this.shakeMag = Math.max(this.shakeMag, 0.035 * power + 0.025 * Math.min(step.chain, 6));

    void this.tw.to(target, { flash: 0 }, 320, ease.outQuad);
    await this.tw.to(target, { scale: 1.3, rot: (Math.random() - 0.5) * 0.12 }, 85, ease.outQuad);
    await this.tw.to(target, { scale: 1, rot: 0 }, 210, ease.outBack);
    target.z = 0;
  }

  async animateFall(step: FallStep): Promise<void> {
    const anims = step.moves.map(async (m) => {
      const t = this.tiles.get(m.id);
      if (!t) return;
      const toGy = rowToGy(m.to.row);
      const dist = Math.max(0.2, toGy - t.gy);
      await this.tw.to(t, { gy: toGy }, 60 + 70 * Math.sqrt(dist), ease.inQuad);
      void this.squash(t, 0.14);
    });
    await Promise.all(anims);
  }

  // ---------------------------------------------------------------- power-ups

  /** Martelo: tremida, inchaço e estilhaço em fragmentos com a cor do bloco. */
  async smash(ids: readonly number[]): Promise<void> {
    const anims = ids.map(async (id, i) => {
      const t = this.tiles.get(id);
      if (!t) return;
      t.z = 4;
      await this.tw.wait(i * 90);
      for (const r of [0.22, -0.22, 0.16, -0.12]) await this.tw.to(t, { rot: r }, 45, ease.outQuad);
      await this.tw.to(t, { scale: 1.2, rot: 0, flash: 0.8 }, 70, ease.outQuad);
      this.tiles.delete(id);
      const color = tileColor(t.value);
      this.particles.burst(t.gx, t.gy, { count: 22, color: [color, shade(color, -0.3), shade(color, 0.3)], speed: 6, size: 0.24, gravity: 14, drag: 0.6, shape: 'shard', ttl: 900 });
      this.particles.burst(t.gx, t.gy, { count: 10, color: '#ffffff', speed: 3, size: 0.12, gravity: 0, shape: 'circle', ttl: 300 });
      this.shakeMag = Math.max(this.shakeMag, 0.12);
    });
    await Promise.all(anims);
  }

  // ---------------------------------------------------------------- feedback

  rejectColumn(col: number): void {
    this.rejectCol = col;
    this.rejectT = 1;
    const t = this.current;
    if (!t) return;
    void (async () => {
      for (const r of [0.18, -0.18, 0.12, -0.08, 0]) await this.tw.to(t, { rot: r }, 45, ease.outQuad);
    })();
  }

  floatText(text: string, gx: number, gy: number, color: string, size = 0.42): void {
    this.texts.push({ text, gx, gy, t: 0, ttl: 900, color, size });
  }

  showBanner(text: string, sub: string, color: string, slot: BannerSlot = 'combo'): void {
    this.banners = this.banners.filter((b) => b.slot !== slot);
    this.banners.push({ slot, text, sub, t: 0, ttl: slot === 'record' ? 1500 : 1100, color });
  }

  /** Overlay de novo bloco recorde: raios girando, bloco gigante e confete. Toque para pular. */
  celebrate(value: number): Promise<void> {
    const color = tileColor(value);
    const cx = (COLS - 1) / 2;
    const cy = (ROWS - 1) / 2;
    this.texts = [];
    this.banners = [];
    // Canhões de confete nos cantos inferiores, mirando para cima e para o centro: não cobrem o bloco.
    for (const side of [-1, 1]) {
      this.overlayFx.burst(cx + side * 2.4, ROWS - 0.5, {
        count: 55,
        color: [color, GOLD, '#ffffff', shade(color, 0.4)],
        speed: 15,
        size: 0.18,
        gravity: 9,
        drag: 1.4,
        ttl: 1700,
        angle: -Math.PI / 2 - side * 0.38,
        spread: 0.7,
      });
    }
    this.overlayFx.burst(cx, cy, { count: 16, color: [GOLD, '#ffffff'], speed: 7, size: 0.22, gravity: 0, drag: 2.5, shape: 'star', ttl: 900 });
    return new Promise((resolve) => {
      this.celebration = { value, t: 0, ttl: 1900, resolve };
    });
  }

  skipCelebration(): boolean {
    const c = this.celebration;
    if (!c || c.t < 350) return false;
    c.t = Math.max(c.t, c.ttl - 260);
    return true;
  }

  get celebrating(): boolean {
    return this.celebration !== null;
  }

  /** Fim de jogo: blocos perdem a cor um a um, de cima para baixo. */
  async gameOverSequence(): Promise<void> {
    const sorted = [...this.tiles.values()].sort((a, b) => a.gy - b.gy || a.gx - b.gx);
    this.shakeMag = 0.25;
    await Promise.all(
      sorted.map(async (t, i) => {
        await this.tw.wait(i * 35);
        await this.tw.to(t, { gray: 1, scale: 0.92 }, 220, ease.outQuad);
      }),
    );
    if (this.current) await this.tw.to(this.current, { alpha: 0, scale: 0.4 }, 200, ease.inQuad);
    this.current = null;
    await this.tw.wait(250);
  }

  /** Limpa o tabuleiro derrubando os blocos para fora da tela com rotação. */
  async clearBoard(): Promise<void> {
    const all = [...this.tiles.values()];
    if (this.current) all.push(this.current);
    await Promise.all(
      all.map((t, i) =>
        this.tw.to(
          t,
          { gy: t.gy + ROWS + 4, rot: (Math.random() - 0.5) * 3, alpha: 0, gx: t.gx + (Math.random() - 0.5) * 2 },
          650,
          ease.inQuad,
          i * 14,
        ),
      ),
    );
    this.tiles.clear();
    this.current = null;
    this.texts = [];
    this.banners = [];
  }

  // ---------------------------------------------------------------- loop

  update(dt: number): void {
    this.time += dt;
    this.tw.update(dt);
    this.particles.update(dt);
    this.overlayFx.update(dt);
    this.shakeMag *= Math.exp(-dt / 70);
    if (this.shakeMag < 0.002) this.shakeMag = 0;
    this.rejectT = Math.max(0, this.rejectT - dt / 400);

    const maxH = Math.max(...this.heights);
    const target = maxH >= ROWS - 1 ? 1 : maxH >= ROWS - 2 ? 0.45 : 0;
    this.danger += (target - this.danger) * Math.min(1, dt / 250);

    for (const f of this.texts) f.t += dt;
    this.texts = this.texts.filter((f) => f.t < f.ttl);
    for (const b of this.banners) b.t += dt;
    this.banners = this.banners.filter((b) => b.t < b.ttl);
    const c = this.celebration;
    if (c) {
      c.t += dt;
      if (c.t >= c.ttl) {
        this.celebration = null;
        c.resolve();
      }
    }
  }

  draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    if (this.shakeMag > 0) {
      const m = this.shakeMag * this.cell;
      ctx.translate((Math.random() - 0.5) * 2 * m, (Math.random() - 0.5) * 2 * m);
    }
    this.drawBoard();
    this.drawGhost();
    const list = [...this.tiles.values()].sort((a, b) => a.z - b.z);
    for (const t of list) this.drawTile(t, this.targetMode !== 'none');
    if (this.current) this.drawTile(this.current, false);
    this.particles.draw(ctx, this.toPx, this.cell);
    this.drawTexts();
    for (const b of this.banners) this.drawBanner(b);
    ctx.restore();
    this.drawCelebration();
    this.overlayFx.draw(ctx, this.toPx, this.cell);
  }

  // ---------------------------------------------------------------- desenho

  private drawBoard(): void {
    const ctx = this.ctx;
    const c = this.cell;
    const w = c * COLS;
    const laneTop = this.top + c * 0.3;
    const laneH = c * (LANE_UNITS - 0.42);

    // Barra de tempo (auto-drop)
    if (this.showTimer) {
      const barY = this.top + c * 0.06;
      const barH = Math.max(4, c * 0.09);
      roundRect(ctx, this.ox, barY, w, barH, barH / 2);
      ctx.fillStyle = '#1d1d21';
      ctx.fill();
      const f = Math.max(0, Math.min(1, this.timerFrac));
      const color = f > 0.5 ? mix('#f5c542', '#5bd66b', (f - 0.5) * 2) : mix('#ef4b3f', '#f5c542', f * 2);
      const pulse = f < 0.25 ? 0.6 + 0.4 * Math.abs(Math.sin(this.time / 90)) : 1;
      if (f > 0) {
        roundRect(ctx, this.ox, barY, w * f, barH, barH / 2);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Faixa de spawn com setas
    roundRect(ctx, this.ox, laneTop, w, laneH, c * 0.12);
    ctx.fillStyle = '#232327';
    ctx.fill();
    for (let i = 0; i < COLS; i++) {
      const x = this.ox + (i + 0.5) * c;
      const bob = Math.sin(this.time / 260 + i * 0.7) * c * 0.04;
      const active = i === this.selCol;
      const y = laneTop + laneH * 0.5 + bob;
      ctx.fillStyle = active ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.moveTo(x - c * 0.2, y - c * 0.1);
      ctx.lineTo(x + c * 0.2, y - c * 0.1);
      ctx.lineTo(x, y + c * 0.12);
      ctx.closePath();
      ctx.fill();
    }

    // Grade
    roundRect(ctx, this.ox - 3, this.oy - 3, w + 6, c * ROWS + 6, c * 0.12);
    ctx.fillStyle = BG;
    ctx.fill();
    for (let i = 0; i < COLS; i++) {
      ctx.fillStyle = i % 2 === 0 ? COL_A : COL_B;
      ctx.fillRect(this.ox + i * c, this.oy, c, c * ROWS);
    }

    // Destaque da coluna selecionada (arraste) e rejeição
    const hl = this.hoverCol >= 0 ? this.hoverCol : this.targetMode === 'none' ? this.selCol : -1;
    if (hl >= 0) {
      const g = ctx.createLinearGradient(0, laneTop, 0, this.oy + c * ROWS);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.fillStyle = g;
      ctx.fillRect(this.ox + hl * c, this.oy, c, c * ROWS);
    }
    if (this.rejectT > 0 && this.rejectCol >= 0) {
      ctx.fillStyle = `rgba(239,75,63,${0.35 * this.rejectT})`;
      ctx.fillRect(this.ox + this.rejectCol * c, this.oy, c, c * ROWS);
    }

    // Zona de perigo: brilho vermelho pulsante no topo quando alguma coluna está quase cheia
    if (this.danger > 0.01) {
      const pulse = 0.55 + 0.45 * Math.sin(this.time / 180);
      const g = ctx.createLinearGradient(0, this.oy, 0, this.oy + c * 2.6);
      g.addColorStop(0, `rgba(220,50,50,${0.42 * this.danger * pulse})`);
      g.addColorStop(1, 'rgba(220,50,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(this.ox, this.oy, w, c * 2.6);
    }

    // Modo martelo: escurece a grade para destacar os blocos-alvo
    if (this.targetMode !== 'none') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(this.ox, this.oy, w, c * ROWS);
    }
  }

  /** Contorno do ponto de pouso na coluna selecionada. */
  private drawGhost(): void {
    const t = this.current;
    if (!t || this.targetMode !== 'none' || this.celebration) return;
    const col = this.selCol;
    const h = this.heights[col] ?? 0;
    if (h >= ROWS) return;
    const c = this.cell;
    const size = c * TILE_FILL;
    const x = this.px(col) - size / 2;
    const y = this.py(rowToGy(h)) - size / 2;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.time / 200);
    ctx.setLineDash([size * 0.12, size * 0.08]);
    ctx.lineWidth = Math.max(2, c * 0.04);
    ctx.strokeStyle = tileColor(t.value);
    roundRect(ctx, x + 2, y + 2, size - 4, size - 4, size * 0.12);
    ctx.stroke();
    ctx.restore();
  }

  private drawTile(t: VisualTile, targeting: boolean): void {
    if (t.alpha <= 0 || t.scale <= 0) return;
    const ctx = this.ctx;
    const c = this.cell;
    const size = c * TILE_FILL;
    const half = size / 2;
    const r = size * 0.11;

    let rot = t.rot;
    if (targeting) rot += Math.sin(this.time / 55 + t.id * 1.7) * 0.05;

    ctx.save();
    ctx.translate(this.px(t.gx), this.py(t.gy));
    ctx.rotate(rot);
    ctx.scale(t.scale * t.sx, t.scale * t.sy);
    ctx.globalAlpha = t.alpha;

    let color = tileColor(t.value);
    if (t.gray > 0) color = mix(color, '#6d6d72', t.gray);
    const isMax = t.value === this.maxValue && t.value >= 128 && t.gray < 0.5;

    // Base (bevel inferior) + face
    roundRect(ctx, -half, -half + size * 0.06, size, size * 0.94, r);
    ctx.fillStyle = shade(color, -0.28);
    ctx.fill();
    roundRect(ctx, -half, -half, size, size * 0.93, r);
    ctx.fillStyle = color;
    ctx.fill();

    // Brilho superior
    const g = ctx.createLinearGradient(0, -half, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    roundRect(ctx, -half + size * 0.05, -half + size * 0.04, size * 0.9, size * 0.42, r * 0.8);
    ctx.fillStyle = g;
    ctx.fill();

    // Moldura dourada animada no maior bloco (como o 1024 da referência)
    if (isMax) {
      const shimmer = (this.time / 900) % 1;
      const sg = ctx.createLinearGradient(-half, -half, half, half);
      sg.addColorStop(0, '#b8860b');
      sg.addColorStop(Math.max(0, shimmer - 0.15), GOLD);
      sg.addColorStop(shimmer, '#fff7cc');
      sg.addColorStop(Math.min(1, shimmer + 0.15), GOLD);
      sg.addColorStop(1, '#b8860b');
      ctx.lineWidth = size * 0.065;
      ctx.strokeStyle = sg;
      roundRect(ctx, -half + ctx.lineWidth / 2, -half + ctx.lineWidth / 2, size - ctx.lineWidth, size * 0.93 - ctx.lineWidth, r);
      ctx.stroke();
    }

    // Texto
    const label = formatValue(t.value);
    const k = label.length <= 2 ? 0.5 : label.length === 3 ? 0.4 : label.length === 4 ? 0.31 : 0.26;
    ctx.font = `900 ${Math.round(size * k)}px "Arial Rounded MT Bold", "Nunito", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillText(label, 0, size * 0.02);
    ctx.fillStyle = isMax ? '#ffe9a6' : '#ffffff';
    ctx.fillText(label, 0, -size * 0.02);

    if (t.flash > 0) {
      roundRect(ctx, -half, -half, size, size, r);
      ctx.fillStyle = `rgba(255,255,255,${t.flash * 0.85})`;
      ctx.fill();
    }
    ctx.restore();
  }

  private drawTexts(): void {
    const ctx = this.ctx;
    for (const f of this.texts) {
      const k = f.t / f.ttl;
      const pop = k < 0.15 ? ease.outBack(k / 0.15) : 1;
      const size = f.size * this.cell * pop;
      ctx.save();
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.translate(this.px(f.gx), this.py(f.gy - ease.outCubic(k) * 0.9));
      ctx.font = `900 ${Math.round(size)}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = size * 0.16;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,20,24,0.85)';
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = shade(f.color, 0.35);
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
  }

  private drawBanner(b: Banner): void {
    const ctx = this.ctx;
    const k = b.t / b.ttl;
    const pop = b.t < 260 ? ease.outBack(b.t / 260) : 1;
    const alpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    const record = b.slot === 'record';
    const size = this.cell * (record ? 0.6 : 0.78) * pop;
    ctx.save();
    ctx.globalAlpha = alpha;
    const baseY = record ? 0.75 : 2.4;
    ctx.translate(this.ox + (this.cell * COLS) / 2, this.oy + this.cell * baseY - k * this.cell * 0.4);
    ctx.rotate(record ? 0.04 : -0.06);
    ctx.font = `900 ${Math.round(size)}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = '#1b1b1f';
    ctx.strokeText(b.text, 0, 0);
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    g.addColorStop(0, '#fff7c2');
    g.addColorStop(1, b.color);
    ctx.fillStyle = g;
    ctx.fillText(b.text, 0, 0);
    if (b.sub) {
      ctx.font = `800 ${Math.round(size * 0.42)}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;
      ctx.lineWidth = size * 0.1;
      ctx.strokeText(b.sub, 0, size * 0.75);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(b.sub, 0, size * 0.75);
    }
    ctx.restore();
  }

  private drawCelebration(): void {
    const cel = this.celebration;
    if (!cel) return;
    const ctx = this.ctx;
    const fadeIn = Math.min(1, cel.t / 200);
    const fadeOut = Math.min(1, (cel.ttl - cel.t) / 260);
    const a = Math.min(fadeIn, fadeOut);
    const cx = this.width / 2;
    const cy = this.oy + (this.cell * ROWS) / 2;
    const color = tileColor(cel.value);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8,8,12,0.72)';
    ctx.fillRect(0, 0, this.width, this.height);

    // Raios girando
    ctx.translate(cx, cy);
    ctx.save();
    ctx.rotate(this.time / 1600);
    const R = Math.max(this.width, this.height);
    for (let i = 0; i < 14; i++) {
      ctx.rotate((Math.PI * 2) / 14);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(R, -R * 0.11);
      ctx.lineTo(R, R * 0.11);
      ctx.closePath();
      ctx.fillStyle = rgba(color, 0.16);
      ctx.fill();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, this.cell * 2.6);
    glow.addColorStop(0, rgba(color, 0.55));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-this.cell * 3, -this.cell * 3, this.cell * 6, this.cell * 6);

    // Bloco gigante (reaproveita drawTile com escala alta)
    const s = ease.outBack(Math.min(1, cel.t / 480)) * 2.3 + Math.sin(this.time / 220) * 0.05;
    ctx.restore();

    const big = newTile(-2, cel.value, (this.width / 2 - this.ox) / this.cell - 0.5, (cy - this.oy) / this.cell - 0.5);
    big.scale = s;
    big.alpha = a;
    this.drawTile(big, false);

    ctx.save();
    ctx.globalAlpha = a;
    const ts = this.cell * 0.62;
    ctx.font = `900 ${Math.round(ts)}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = ts * 0.2;
    ctx.strokeStyle = '#141418';
    const ty = cy - this.cell * 1.9 - (1 - ease.outCubic(Math.min(1, cel.t / 400))) * this.cell;
    ctx.strokeText('NOVO BLOCO!', cx, ty);
    ctx.fillStyle = GOLD;
    ctx.fillText('NOVO BLOCO!', cx, ty);
    ctx.font = `800 ${Math.round(ts * 0.5)}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;
    ctx.lineWidth = ts * 0.1;
    ctx.strokeText('toque para continuar', cx, cy + this.cell * 1.9);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('toque para continuar', cx, cy + this.cell * 1.9);
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

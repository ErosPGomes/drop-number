import { formatScore, formatValue, shade, tileColor } from '../render/palette';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} ausente no HTML`);
  return el as T;
};

/** Reinicia uma animação CSS: remove a classe, força reflow e reaplica. */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export type Tool = 'hammer' | 'super';

export class Hud {
  private readonly scoreEl = $('score');
  private readonly bestEl = $('best');
  private readonly bestCard = $('best-card');
  private readonly coinsEl = $('coins');
  private readonly coinsCard = $('coins-card');
  private readonly nextEl = $('next');
  private readonly hammerBtn = $<HTMLButtonElement>('btn-hammer');
  private readonly superBtn = $<HTMLButtonElement>('btn-super');
  private readonly soundBtn = $<HTMLButtonElement>('btn-sound');
  private readonly pauseOverlay = $('pause-overlay');
  private readonly overOverlay = $('over-overlay');
  private readonly hint = $('hint');

  private shownScore = 0;
  private targetScore = 0;

  update(dt: number): void {
    // Contador rolante: aproximação exponencial independente de framerate.
    if (this.shownScore !== this.targetScore) {
      const k = 1 - Math.exp(-dt / 90);
      this.shownScore += (this.targetScore - this.shownScore) * k;
      if (Math.abs(this.targetScore - this.shownScore) < 1) this.shownScore = this.targetScore;
      this.scoreEl.textContent = formatScore(this.shownScore);
    }
  }

  setScore(score: number, instant = false): void {
    if (score > this.targetScore && !instant) replay(this.scoreEl, 'bump');
    this.targetScore = score;
    if (instant) {
      this.shownScore = score;
      this.scoreEl.textContent = formatScore(score);
    }
  }

  setBest(best: number, celebrate = false): void {
    this.bestEl.textContent = formatScore(best);
    if (celebrate) replay(this.bestCard, 'glow');
  }

  setCoins(coins: number, bump = false): void {
    this.coinsEl.textContent = formatScore(coins);
    if (bump) replay(this.coinsCard, 'bump');
  }

  setNext(value: number): void {
    const color = tileColor(value);
    this.nextEl.textContent = formatValue(value);
    this.nextEl.style.setProperty('--tile', color);
    this.nextEl.style.setProperty('--tile-dark', shade(color, -0.28));
    this.nextEl.dataset.len = String(formatValue(value).length);
    replay(this.nextEl, 'pop');
  }

  setTools(hammers: number, supers: number, coins: number, price: number): void {
    this.paintTool(this.hammerBtn, hammers, coins, price);
    this.paintTool(this.superBtn, supers, coins, price);
  }

  private paintTool(btn: HTMLButtonElement, count: number, coins: number, price: number): void {
    const badge = btn.querySelector<HTMLElement>('.badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = String(count);
      badge.classList.remove('price');
    } else {
      badge.textContent = `🪙${price}`;
      badge.classList.add('price');
    }
    btn.classList.toggle('disabled', count === 0 && coins < price);
  }

  setActiveTool(tool: Tool | null): void {
    this.hammerBtn.classList.toggle('active', tool === 'hammer');
    this.superBtn.classList.toggle('active', tool === 'super');
    this.hint.textContent =
      tool === 'hammer'
        ? 'Toque em um bloco para destruí-lo'
        : tool === 'super'
          ? 'Toque em um bloco: todos com esse número somem'
          : '';
    this.hint.classList.toggle('show', tool !== null);
  }

  shakeTool(tool: Tool): void {
    replay(tool === 'hammer' ? this.hammerBtn : this.superBtn, 'deny');
  }

  setMuted(muted: boolean): void {
    this.soundBtn.classList.toggle('muted', muted);
    this.soundBtn.setAttribute('aria-pressed', String(muted));
  }

  showPause(show: boolean): void {
    this.pauseOverlay.classList.toggle('show', show);
  }

  showGameOver(score: number, best: number, maxTile: number, newBest: boolean): void {
    $('over-score').textContent = formatScore(score);
    $('over-best').textContent = formatScore(best);
    const tile = $('over-tile');
    tile.textContent = formatValue(maxTile);
    tile.style.setProperty('--tile', tileColor(maxTile));
    tile.style.setProperty('--tile-dark', shade(tileColor(maxTile), -0.28));
    tile.dataset.len = String(formatValue(maxTile).length);
    $('over-record').classList.toggle('show', newBest);
    this.overOverlay.classList.add('show');
  }

  hideGameOver(): void {
    this.overOverlay.classList.remove('show');
  }
}

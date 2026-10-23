import { Board, COLS, type Pos, type Step } from '../core/board';
import { pickSpawnValue } from '../core/spawn';
import { vibrate, type Sfx } from '../audio/sfx';
import { tileColor } from '../render/palette';
import type { Renderer } from '../render/renderer';
import type { Hud, Tool } from '../ui/hud';
import * as storage from './storage';

/**
 * Máquina de estados:
 *   aim ──drop──▶ busy ──▶ aim | over
 *   aim ──tool──▶ hammer|super ──tap──▶ busy ──▶ aim
 *   aim ⇄ paused
 * Toda entrada é ignorada fora de `aim`/`hammer`/`super`, o que elimina corridas
 * entre input e animações sem precisar de locks.
 */
type Mode = 'aim' | 'busy' | 'hammer' | 'super' | 'paused' | 'over';

const TOOL_PRICE = 100;
const START_TOOLS = 3;
const CELEBRATE_FROM = 256;

const COMBO_WORDS = ['', '', 'Combo', 'Ótimo!', 'Incrível!', 'Fantástico!', 'Lendário!'];

export class Game {
  private board = new Board();
  private mode: Mode = 'busy';
  private pausedFrom: Mode = 'aim';
  private score = 0;
  private best = 0;
  private coins = 0;
  private current = 2;
  private next = 2;
  private col = 2;
  private maxTile = 0;
  private hammers = START_TOOLS;
  private supers = START_TOOLS;
  private timeLeft = 0;
  private timeTotal = 1;
  private dragging = false;
  private bestBeatenThisGame = false;
  private startBest = 0;

  constructor(
    private readonly r: Renderer,
    private readonly hud: Hud,
    private readonly sfx: Sfx,
  ) {}

  // ---------------------------------------------------------------- ciclo de vida

  async start(): Promise<void> {
    const data = storage.load();
    this.best = data.best;
    this.coins = data.coins;
    this.sfx.muted = data.muted;
    this.hud.setMuted(data.muted);
    this.hud.setBest(this.best);
    this.hud.setCoins(this.coins);

    const g = data.game;
    if (g) {
      try {
        this.board = new Board(g.grid);
        this.score = g.score;
        this.current = g.current;
        this.next = g.next;
        this.col = Math.min(COLS - 1, Math.max(0, Math.round(g.col)));
        this.maxTile = Math.max(g.maxTile, this.board.maxValue());
        this.hammers = g.hammers;
        this.supers = g.supers;
        this.startBest = this.best;
        this.syncRenderer();
        this.hud.setScore(this.score, true);
        await this.r.introTiles();
        await this.beginTurn();
        return;
      } catch {
        /* save corrompido: cai para novo jogo */
      }
    }
    await this.newGame();
  }

  private async newGame(): Promise<void> {
    this.board = new Board();
    this.score = 0;
    this.maxTile = 0;
    this.col = 2;
    this.hammers = START_TOOLS;
    this.supers = START_TOOLS;
    this.bestBeatenThisGame = false;
    this.startBest = this.best;
    this.current = pickSpawnValue(0, Math.random);
    this.next = pickSpawnValue(0, Math.random);
    this.syncRenderer();
    this.hud.setScore(0, true);
    await this.beginTurn();
  }

  private syncRenderer(): void {
    this.r.syncTiles(this.board.tiles().map(({ tile, pos }) => ({ id: tile.id, value: tile.value, pos })));
    this.r.setHeights(this.board.heights());
    this.r.maxValue = this.board.maxValue();
    this.refreshTools();
  }

  private async beginTurn(): Promise<void> {
    if (this.board.validColumns(this.current).length === 0) {
      await this.gameOver();
      return;
    }
    this.hud.setNext(this.next);
    this.resetTimer();
    this.mode = 'aim';
    this.sfx.spawn();
    this.persist();
    await this.r.spawnCurrent(this.current, this.col);
  }

  private resetTimer(): void {
    // Tempo encurta conforme o maior bloco cresce: 12s até 64, mínimo 5s.
    const exp = Math.log2(Math.max(2, this.maxTile));
    this.timeTotal = Math.max(5000, 12000 - Math.max(0, exp - 6) * 900);
    this.timeLeft = this.timeTotal;
    this.r.timerFrac = 1;
  }

  update(dt: number): void {
    if (this.mode !== 'aim' || this.r.celebrating) return;
    this.timeLeft -= dt;
    this.r.timerFrac = this.timeLeft / this.timeTotal;
    if (this.timeLeft <= 0) {
      const valid = this.board.validColumns(this.current);
      void this.drop(valid.includes(this.col) ? this.col : valid[0]);
    }
  }

  // ---------------------------------------------------------------- jogadas

  private async drop(col: number): Promise<void> {
    if (this.mode !== 'aim') return;
    if (!this.board.canDrop(col, this.current)) {
      this.r.rejectColumn(col);
      this.sfx.invalid();
      vibrate([20, 40, 20]);
      return;
    }
    this.mode = 'busy';
    this.dragging = false;
    this.r.hoverCol = -1;
    this.setCol(col, false);

    const res = this.board.drop(col, this.current);
    this.sfx.drop();
    await this.r.dropCurrent(res.id, res.landing);
    this.sfx.land();
    vibrate(8);
    this.r.setHeights(this.board.heights());
    await this.playSteps(res.steps);
    this.r.setHeights(this.board.heights());
    this.r.maxValue = this.board.maxValue();

    this.current = this.next;
    this.next = pickSpawnValue(this.board.maxValue(), Math.random);
    await this.beginTurn();
  }

  private async playSteps(steps: readonly Step[]): Promise<void> {
    for (const step of steps) {
      if (step.kind === 'fall') {
        await this.r.animateFall(step);
        continue;
      }
      await this.r.animateMerge(step, () => {
        this.sfx.merge(step.value, step.chain);
        vibrate(step.chain > 1 ? 18 : 10);
        this.addScore(step.value);
        const earned = 1 + (step.chain >= 3 ? step.chain : 0);
        this.coins += earned;
        this.hud.setCoins(this.coins, true);
        if (step.chain >= 2) {
          const word = COMBO_WORDS[Math.min(step.chain, COMBO_WORDS.length - 1)];
          this.r.showBanner(`${word}`, `x${step.chain}`, tileColor(step.value));
          this.sfx.combo(step.chain);
        }
        if (step.value > this.r.maxValue) this.r.maxValue = step.value;
      });
      this.r.setHeights(this.board.heights());
      this.refreshTools();

      if (step.value > this.maxTile) {
        const isNew = this.maxTile > 0;
        this.maxTile = step.value;
        if (isNew && step.value >= CELEBRATE_FROM) {
          this.sfx.record();
          vibrate([30, 50, 30, 50, 60]);
          await this.r.celebrate(step.value);
        }
      }
    }
  }

  private addScore(points: number): void {
    this.score += points;
    this.hud.setScore(this.score);
    if (this.score > this.best) {
      this.best = this.score;
      const first = !this.bestBeatenThisGame && this.startBest > 0;
      this.bestBeatenThisGame = true;
      this.hud.setBest(this.best, first);
      if (first) this.r.showBanner('Recorde!', 'nova pontuação máxima', '#f7c843', 'record');
    }
  }

  private async gameOver(): Promise<void> {
    this.mode = 'over';
    this.sfx.gameOver();
    vibrate([60, 80, 120]);
    this.persist(true);
    await this.r.gameOverSequence();
    this.hud.showGameOver(this.score, this.best, this.maxTile, this.bestBeatenThisGame);
  }

  async restart(): Promise<void> {
    if (this.mode !== 'over' && this.mode !== 'paused') return;
    this.sfx.click();
    this.hud.hideGameOver();
    this.hud.showPause(false);
    this.mode = 'busy';
    this.r.targetMode = 'none';
    this.hud.setActiveTool(null);
    await this.r.clearBoard();
    await this.newGame();
  }

  // ---------------------------------------------------------------- power-ups

  useTool(tool: Tool): void {
    this.sfx.unlock();
    if (this.mode === tool) {
      this.exitTool();
      return;
    }
    if (this.mode !== 'aim' || this.board.isEmpty()) {
      this.hud.shakeTool(tool);
      return;
    }
    const count = tool === 'hammer' ? this.hammers : this.supers;
    if (count === 0) {
      if (this.coins < TOOL_PRICE) {
        this.hud.shakeTool(tool);
        this.sfx.invalid();
        return;
      }
      this.coins -= TOOL_PRICE;
      if (tool === 'hammer') this.hammers++;
      else this.supers++;
      this.hud.setCoins(this.coins, true);
      this.sfx.coin();
    }
    this.sfx.click();
    this.mode = tool;
    this.r.targetMode = tool;
    this.hud.setActiveTool(tool);
    this.refreshTools();
  }

  private exitTool(): void {
    this.mode = 'aim';
    this.r.targetMode = 'none';
    this.hud.setActiveTool(null);
  }

  private async applyTool(pos: Pos): Promise<void> {
    const tile = this.board.get(pos.col, pos.row);
    if (!tile) return;
    const tool = this.mode as Tool;
    this.mode = 'busy';
    this.r.targetMode = 'none';
    this.hud.setActiveTool(null);
    if (tool === 'hammer') this.hammers--;
    else this.supers--;
    this.refreshTools();

    const res = tool === 'hammer' ? this.board.removeTile(tile.id) : this.board.removeValue(tile.value);
    this.sfx.smash();
    vibrate([15, 30, 40]);
    await this.r.smash(res.removed.map((x) => x.id));
    this.r.setHeights(this.board.heights());
    await this.playSteps(res.steps);
    this.r.setHeights(this.board.heights());
    this.r.maxValue = this.board.maxValue();
    this.mode = 'aim';
    this.persist();
  }

  private refreshTools(): void {
    this.hud.setTools(this.hammers, this.supers, this.coins, TOOL_PRICE);
  }

  // ---------------------------------------------------------------- pausa / som

  togglePause(): void {
    this.sfx.click();
    if (this.mode === 'paused') {
      this.mode = this.pausedFrom;
      this.hud.showPause(false);
      return;
    }
    if (this.mode === 'aim' || this.mode === 'hammer' || this.mode === 'super') {
      this.pausedFrom = this.mode;
      this.mode = 'paused';
      this.hud.showPause(true);
    }
  }

  /** Pausa automática quando o app vai para segundo plano (troca de app, bloqueio de tela). */
  autoPause(): void {
    if (this.mode === 'aim' || this.mode === 'hammer' || this.mode === 'super') this.togglePause();
    // Em `busy` o tabuleiro já mudou mas o turno não fechou: salvar agora duplicaria o bloco atual.
    if (this.mode !== 'busy') this.persist();
  }

  toggleSound(): void {
    this.sfx.muted = !this.sfx.muted;
    this.hud.setMuted(this.sfx.muted);
    this.sfx.unlock();
    this.sfx.click();
    this.persist();
  }

  // ---------------------------------------------------------------- input

  private setCol(col: number, feedback = true): void {
    if (col === this.col) return;
    this.col = col;
    this.r.moveCurrent(col);
    if (feedback) this.sfx.move();
  }

  pointerDown(x: number, y: number): void {
    this.sfx.unlock();
    if (this.r.celebrating) {
      this.r.skipCelebration();
      return;
    }
    if (this.mode === 'aim' && this.r.inBoard(x, y)) {
      this.dragging = true;
      const col = this.r.colAt(x);
      this.r.hoverCol = col;
      this.setCol(col);
    }
  }

  pointerMove(x: number): void {
    if (!this.dragging || this.mode !== 'aim') return;
    const col = this.r.colAt(x);
    this.r.hoverCol = col;
    this.setCol(col);
  }

  pointerUp(x: number, y: number): void {
    if (this.mode === 'hammer' || this.mode === 'super') {
      const pos = this.r.cellAt(x, y);
      if (pos && this.board.get(pos.col, pos.row)) void this.applyTool(pos);
      else this.exitTool();
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    this.r.hoverCol = -1;
    void this.drop(this.r.colAt(x));
  }

  pointerCancel(): void {
    this.dragging = false;
    this.r.hoverCol = -1;
  }

  key(e: KeyboardEvent): void {
    this.sfx.unlock();
    if (this.r.celebrating && (e.key === ' ' || e.key === 'Enter')) {
      this.r.skipCelebration();
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
        if (this.mode === 'aim') this.setCol(Math.max(0, this.col - 1));
        break;
      case 'ArrowRight':
      case 'd':
        if (this.mode === 'aim') this.setCol(Math.min(COLS - 1, this.col + 1));
        break;
      case 'ArrowDown':
      case ' ':
      case 'Enter':
        if (this.mode === 'over') void this.restart();
        else void this.drop(this.col);
        break;
      case 'p':
      case 'Escape':
        if (this.mode === 'hammer' || this.mode === 'super') this.exitTool();
        else this.togglePause();
        break;
      default:
        if (e.key >= '1' && e.key <= String(COLS) && this.mode === 'aim') void this.drop(Number(e.key) - 1);
        return;
    }
    e.preventDefault();
  }

  // ---------------------------------------------------------------- persistência

  private persist(clearGame = false): void {
    const live = !clearGame && this.mode !== 'over';
    storage.save({
      best: this.best,
      coins: this.coins,
      muted: this.sfx.muted,
      game: live
        ? {
            grid: this.board.snapshot(),
            score: this.score,
            current: this.current,
            next: this.next,
            col: this.col,
            maxTile: this.maxTile,
            hammers: this.hammers,
            supers: this.supers,
          }
        : null,
    });
  }
}

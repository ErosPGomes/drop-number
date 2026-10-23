/**
 * Efeitos sonoros sintetizados via WebAudio: zero assets (bundle menor, sem
 * latência de download) e pitch parametrizável por valor/combo.
 * O AudioContext só é criado após gesto do usuário (política de autoplay iOS/Chrome).
 */

// Escala pentatônica maior: qualquer sequência de combos soa consonante.
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

type Wave = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ready(): AudioContext | null {
    return this.muted || !this.ctx || !this.master ? null : this.ctx;
  }

  private tone(freq: number, dur: number, type: Wave = 'sine', gain = 0.2, delay = 0, slideTo?: number): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    const ctx = this.ready();
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  move(): void {
    this.tone(880, 0.04, 'triangle', 0.05);
  }

  drop(): void {
    this.tone(520, 0.12, 'sine', 0.08, 0, 260);
  }

  land(): void {
    this.noise(0.09, 0.35, 700);
    this.tone(140, 0.12, 'sine', 0.25, 0, 70);
  }

  merge(value: number, chain: number): void {
    const idx = Math.min(PENTATONIC.length - 1, chain - 1 + Math.floor(Math.log2(value) / 4));
    const f = 392 * 2 ** (PENTATONIC[idx] / 12);
    this.tone(f, 0.22, 'triangle', 0.22);
    this.tone(f * 2, 0.16, 'sine', 0.08, 0.015);
    this.noise(0.06, 0.12, 4000, 'highpass');
  }

  combo(chain: number): void {
    const base = 523.25;
    for (let i = 0; i < Math.min(chain, 5); i++) {
      this.tone(base * 2 ** (PENTATONIC[i + 2] / 12), 0.12, 'square', 0.05, i * 0.05);
    }
  }

  smash(): void {
    this.noise(0.3, 0.5, 1800);
    this.tone(180, 0.25, 'sawtooth', 0.12, 0, 50);
  }

  invalid(): void {
    this.tone(160, 0.14, 'square', 0.08, 0, 110);
    this.tone(120, 0.16, 'square', 0.08, 0.08, 90);
  }

  spawn(): void {
    this.tone(660, 0.06, 'sine', 0.06);
    this.tone(990, 0.08, 'sine', 0.05, 0.04);
  }

  coin(): void {
    this.tone(988, 0.07, 'square', 0.05);
    this.tone(1319, 0.18, 'square', 0.05, 0.07);
  }

  record(): void {
    [0, 4, 7, 12, 16].forEach((s, i) => this.tone(523.25 * 2 ** (s / 12), 0.25, 'triangle', 0.14, i * 0.08));
  }

  gameOver(): void {
    [12, 7, 3, 0].forEach((s, i) => this.tone(330 * 2 ** (s / 12), 0.35, 'triangle', 0.14, i * 0.16));
  }

  click(): void {
    this.tone(1200, 0.03, 'square', 0.04);
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* API ausente ou bloqueada (iOS): feedback háptico é opcional */
  }
}

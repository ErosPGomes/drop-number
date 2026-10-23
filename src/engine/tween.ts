/**
 * Motor de tweens mínimo baseado em promessas. Cada `to()` devolve uma Promise
 * resolvida ao fim da animação, o que permite sequenciar animações com async/await
 * em vez de callbacks aninhados. Atualizado pelo loop principal (dt em ms), então
 * pausa/aceleração são triviais e não há dependência de timers do navegador.
 */

export type Easing = (t: number) => number;

const C1 = 1.70158;
const C3 = C1 + 1;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => 1 + C3 * (t - 1) ** 3 + C1 * (t - 1) ** 2,
  outElastic: (t: number) =>
    t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  outBounce: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
} satisfies Record<string, Easing>;

type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];
export type NumericProps<T> = Partial<Pick<T, NumericKeys<T>>>;

interface ActiveTween {
  readonly target: Record<string, number>;
  readonly keys: string[];
  readonly to: number[];
  from: number[];
  readonly duration: number;
  readonly easing: Easing;
  delay: number;
  elapsed: number;
  started: boolean;
  /** Cancelado por kill() ou sobrescrita: resolve sem escrever valores (evita "snap" ao destino). */
  cancelled: boolean;
  readonly resolve: () => void;
}

export class Tweener {
  private list: ActiveTween[] = [];

  to<T extends object>(
    target: T,
    props: NumericProps<T>,
    duration: number,
    easing: Easing = ease.outCubic,
    delay = 0,
  ): Promise<void> {
    const keys = Object.keys(props);
    const to = keys.map((k) => (props as Record<string, number>)[k]);
    return new Promise((resolve) => {
      this.list.push({
        target: target as unknown as Record<string, number>,
        keys,
        to,
        from: [],
        duration: Math.max(1, duration),
        easing,
        delay,
        elapsed: 0,
        started: false,
        cancelled: false,
        resolve,
      });
    });
  }

  wait(ms: number): Promise<void> {
    return this.to({ t: 0 }, { t: 1 }, ms, ease.linear);
  }

  /** Interrompe tweens do alvo (todas as chaves ou só as informadas), resolvendo suas promessas. */
  kill(target: object, keys?: readonly string[]): void {
    for (const tw of this.list) {
      if (tw.target !== (target as unknown)) continue;
      if (!keys || tw.keys.every((k) => keys.includes(k))) tw.cancelled = true;
    }
  }

  update(dt: number): void {
    if (this.list.length === 0) return;
    const done: ActiveTween[] = [];
    // Snapshot: tweens criados durante resolve() entram no próximo frame.
    for (const tw of [...this.list]) {
      if (tw.cancelled) {
        done.push(tw);
        continue;
      }
      if (!tw.started) {
        tw.delay -= dt;
        if (tw.delay > 0) continue;
        this.start(tw);
      }
      tw.elapsed += dt;
      const k = Math.min(1, tw.elapsed / tw.duration);
      const e = tw.easing(k);
      for (let i = 0; i < tw.keys.length; i++) {
        tw.target[tw.keys[i]] = tw.from[i] + (tw.to[i] - tw.from[i]) * e;
      }
      if (k >= 1) done.push(tw);
    }
    if (done.length) {
      this.list = this.list.filter((tw) => !done.includes(tw));
      for (const tw of done) tw.resolve();
    }
  }

  /** Captura o valor inicial só no início real (após delay), permitindo encadear tweens. */
  private start(tw: ActiveTween): void {
    tw.started = true;
    tw.from = tw.keys.map((k) => tw.target[k]);
    // Sobrescrita: um tween novo assume as chaves que já estavam sendo animadas no mesmo alvo.
    for (const other of this.list) {
      if (other === tw || other.target !== tw.target || !other.started) continue;
      if (other.keys.some((k) => tw.keys.includes(k))) other.cancelled = true;
    }
  }

  get busy(): boolean {
    return this.list.length > 0;
  }
}

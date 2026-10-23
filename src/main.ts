import './style.css';
import { Sfx } from './audio/sfx';
import { Game } from './game/controller';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';

const canvas = document.getElementById('board') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const hud = new Hud();
const sfx = new Sfx();
const game = new Game(renderer, hud, sfx);

// ResizeObserver cobre rotação, barra de endereço do mobile e split-screen sem polling.
new ResizeObserver(() => renderer.resize()).observe(canvas);

// Pointer Events unificam toque/mouse/caneta. setPointerCapture mantém o arraste
// mesmo quando o dedo sai do canvas.
const local = (e: PointerEvent): [number, number] => {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
};
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  game.pointerDown(...local(e));
});
canvas.addEventListener('pointermove', (e) => game.pointerMove(local(e)[0]));
canvas.addEventListener('pointerup', (e) => game.pointerUp(...local(e)));
canvas.addEventListener('pointercancel', () => game.pointerCancel());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => game.key(e));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.autoPause();
});

const on = (id: string, fn: () => void): void => {
  document.getElementById(id)?.addEventListener('click', fn);
};
on('btn-pause', () => game.togglePause());
on('btn-resume', () => game.togglePause());
on('btn-restart', () => void game.restart());
on('btn-again', () => void game.restart());
on('btn-hammer', () => game.useTool('hammer'));
on('btn-super', () => game.useTool('super'));
on('btn-sound', () => game.toggleSound());

let last = performance.now();
function frame(now: number): void {
  // dt limitado: ao voltar de segundo plano não "pula" animações nem esvazia o timer.
  const dt = Math.min(50, now - last);
  last = now;
  game.update(dt);
  renderer.update(dt);
  renderer.draw();
  hud.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void game.start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline é melhoria progressiva */
    });
  });
}

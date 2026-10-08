import { $ } from '../core/util.js';
import { mountMascot } from './mascot.js';

/**
 * The boot sequence (SH-3). Particles converge on the mark while the loader
 * runs, so the Monaco load is covered by something worth watching rather than
 * a blank window. Click to skip.
 */

const STAGES = [
  { at: 0.05, label: 'initialising' },
  { at: 0.22, label: 'loading editor core' },
  { at: 0.46, label: 'registering commands' },
  { at: 0.68, label: 'starting agent' },
  { at: 0.88, label: 'ready' },
];

let particles = [];
let rafId = null;
let skipped = false;

export function start() {
  const mascotHost = $('#boot-mascot');
  if (mascotHost) {
    const m = mountMascot(mascotHost, { scale: 1.1 });
    // Walk through the phases during boot so the creature is doing something
    // rather than idling while Monaco loads.
    const beats = ['understanding', 'thinking', 'planning', 'writing', 'reviewing'];
    beats.forEach((phase, i) => setTimeout(() => m.setPhase(phase), 240 + i * 340));
  }

  const canvas = $('#boot-canvas');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const resize = () => {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const cx = () => window.innerWidth / 2;
  const cy = () => window.innerHeight / 2 - 30;

  particles = Array.from({ length: 90 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 180 + Math.random() * 420;
    return {
      x: cx() + Math.cos(angle) * dist,
      y: cy() + Math.sin(angle) * dist,
      tx: cx() + (Math.random() - 0.5) * 120,
      ty: cy() + (Math.random() - 0.5) * 120,
      r: 0.6 + Math.random() * 1.8,
      speed: 0.008 + Math.random() * 0.022,
      t: 0,
      hue: Math.random(),
    };
  });

  const t0 = performance.now();

  const frame = (now) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      p.t = Math.min(1, p.t + p.speed);
      // Ease-out toward the mark, so they decelerate as they arrive.
      const e = 1 - Math.pow(1 - p.t, 3);
      const x = p.x + (p.tx - p.x) * e;
      const y = p.y + (p.ty - p.y) * e;

      const alpha = p.t < 0.85 ? 0.55 * (1 - p.t * 0.3) : 0.55 * (1 - (p.t - 0.85) / 0.15);
      if (alpha <= 0) continue;

      const r = Math.round(217 + (240 - 217) * p.hue);
      const g = Math.round(119 + (168 - 119) * p.hue);
      const b = Math.round(87 + (104 - 87) * p.hue);

      ctx.beginPath();
      ctx.arc(x, y, p.r * (1 - p.t * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    if (!skipped) rafId = requestAnimationFrame(frame);
  };
  rafId = requestAnimationFrame(frame);

  $('#boot').addEventListener('click', () => finish(true), { once: true });
}

export function progress(fraction) {
  const fill = $('#boot-fill');
  if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;

  const stage = [...STAGES].reverse().find((s) => fraction >= s.at);
  const sub = $('#boot-sub');
  if (stage && sub && sub.textContent !== stage.label) sub.textContent = stage.label;
}

export function finish(immediate = false) {
  if (skipped) return;
  skipped = true;
  cancelAnimationFrame(rafId);

  progress(1);
  const boot = $('#boot');
  const app = $('#app');
  app.hidden = false;

  const go = () => {
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 600);
  };

  if (immediate) go();
  else setTimeout(go, 260);
}

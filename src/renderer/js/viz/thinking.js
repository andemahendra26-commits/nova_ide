import { motionOff } from '../core/settings.js';

/**
 * The thinking visualization (AG-3).
 *
 * Nodes drift under weak mutual repulsion and wire themselves to near neighbours.
 * A pulse travels an edge whenever a thought is emitted, so the reasoning stream
 * has a visual correlate rather than being decoration running alongside it.
 *
 * Cost control (TRD §4.3.4): the glow is a pre-rendered sprite blitted per node
 * rather than a per-frame shadowBlur, edges are batched into alpha buckets, and
 * the loop suspends entirely when hidden or when reduced motion is on.
 */

const PHASE_CONFIG = {
  idle: { target: 0, speed: 0.12, link: 62 },
  understanding: { target: 14, speed: 0.30, link: 74 },
  thinking: { target: 40, speed: 0.55, link: 86 },
  planning: { target: 26, speed: 0.22, link: 96 },
  writing: { target: 18, speed: 0.30, link: 70 },
  reviewing: { target: 22, speed: 0.20, link: 82 },
  done: { target: 8, speed: 0.10, link: 62 },
};

export class ThinkingCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.nodes = [];
    this.pulses = [];
    this.phase = 'idle';
    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.sprite = null;
    this.accent = { r: 217, g: 119, b: 87 };
    this.accent2 = { r: 240, g: 168, b: 104 };

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement || canvas);
    this.resize();
    this.readAccent();
  }

  /** Pull the live theme accent so the canvas follows the theme switch. */
  readAccent() {
    const styles = getComputedStyle(document.documentElement);
    this.accent = parseColor(styles.getPropertyValue('--accent')) || this.accent;
    this.accent2 = parseColor(styles.getPropertyValue('--accent-2')) || this.accent2;
    this.buildSprite();
  }

  buildSprite() {
    const r = 18;
    const size = r * 2;
    const off = document.createElement('canvas');
    off.width = off.height = size;
    const c = off.getContext('2d');
    const g = c.createRadialGradient(r, r, 0, r, r, r);
    const { r: R, g: G, b: B } = this.accent;
    g.addColorStop(0, `rgba(${R},${G},${B},0.95)`);
    g.addColorStop(0.25, `rgba(${R},${G},${B},0.45)`);
    g.addColorStop(1, `rgba(${R},${G},${B},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    this.sprite = off;
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setPhase(phase) {
    this.phase = PHASE_CONFIG[phase] ? phase : 'idle';
    this.readAccent();
    const cfg = PHASE_CONFIG[this.phase];
    if (cfg.target > 0) this.start();
  }

  /** Fire a pulse along a random edge — called when a thought line lands. */
  pulse() {
    if (this.nodes.length < 2) return;
    const a = (Math.random() * this.nodes.length) | 0;
    let b = (Math.random() * this.nodes.length) | 0;
    if (a === b) b = (b + 1) % this.nodes.length;
    this.pulses.push({ a, b, t: 0, life: 0.55 + Math.random() * 0.35 });
    if (this.pulses.length > 14) this.pulses.shift();
  }

  start() {
    if (this.running || motionOff()) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  clear() {
    this.nodes = [];
    this.pulses = [];
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  spawn() {
    const edge = Math.random();
    // Enter from a border so nodes appear to arrive rather than pop into being.
    const x = edge < 0.5 ? Math.random() * this.width : Math.random() < 0.5 ? -10 : this.width + 10;
    const y = edge < 0.5 ? (Math.random() < 0.5 ? -10 : this.height + 10) : Math.random() * this.height;
    this.nodes.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 18,
      vy: (Math.random() - 0.5) * 18,
      r: 1.1 + Math.random() * 1.9,
      phase: Math.random() * Math.PI * 2,
      alpha: 0,
      hue: Math.random(),
    });
  }

  frame = (now) => {
    if (!this.running) return;

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    const cfg = PHASE_CONFIG[this.phase];
    const { ctx, width: w, height: h } = this;

    // Converge node count toward the phase target.
    if (this.nodes.length < cfg.target && Math.random() < 0.34) this.spawn();
    if (this.nodes.length > cfg.target && Math.random() < 0.10) {
      const victim = (Math.random() * this.nodes.length) | 0;
      this.nodes[victim].dying = true;
    }

    ctx.clearRect(0, 0, w, h);

    /* ── integrate ── */
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];

      n.alpha += ((n.dying ? 0 : 1) - n.alpha) * dt * 3.2;
      if (n.dying && n.alpha < 0.02) {
        this.nodes.splice(i, 1);
        continue;
      }

      n.x += n.vx * dt * cfg.speed * 3.4;
      n.y += n.vy * dt * cfg.speed * 3.4;
      n.phase += dt * 2.2;

      // Soft boundary: steer back rather than bounce, which reads as drift.
      const m = 12;
      if (n.x < m) n.vx += (m - n.x) * dt * 8;
      if (n.x > w - m) n.vx -= (n.x - (w - m)) * dt * 8;
      if (n.y < m) n.vy += (m - n.y) * dt * 8;
      if (n.y > h - m) n.vy -= (n.y - (h - m)) * dt * 8;

      const speed = Math.hypot(n.vx, n.vy);
      if (speed > 26) {
        n.vx = (n.vx / speed) * 26;
        n.vy = (n.vy / speed) * 26;
      }
    }

    /* ── edges, bucketed by alpha so we issue few stroke calls ── */
    const link = cfg.link;
    const buckets = [[], [], []];
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > link * link) continue;
        const t = 1 - Math.sqrt(d2) / link;
        const bucket = t > 0.66 ? 2 : t > 0.33 ? 1 : 0;
        buckets[bucket].push(a, b);
      }
    }

    const { r: R, g: G, b: B } = this.accent;
    for (let k = 0; k < 3; k++) {
      const pts = buckets[k];
      if (!pts.length) continue;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      }
      ctx.strokeStyle = `rgba(${R},${G},${B},${0.045 + k * 0.05})`;
      ctx.lineWidth = 0.5 + k * 0.22;
      ctx.stroke();
    }

    /* ── pulses travelling edges ── */
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt / p.life;
      if (p.t >= 1) {
        this.pulses.splice(i, 1);
        continue;
      }
      const a = this.nodes[p.a];
      const b = this.nodes[p.b];
      if (!a || !b) {
        this.pulses.splice(i, 1);
        continue;
      }
      const x = a.x + (b.x - a.x) * p.t;
      const y = a.y + (b.y - a.y) * p.t;
      const fade = Math.sin(p.t * Math.PI);
      const s = 13 * fade;
      ctx.globalAlpha = fade * 0.75;
      ctx.drawImage(this.sprite, x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;

    /* ── nodes ── */
    const c2 = this.accent2;
    for (const n of this.nodes) {
      const breathe = 0.72 + Math.sin(n.phase) * 0.28;
      const a = n.alpha * breathe;
      if (a < 0.02) continue;

      const s = n.r * 4.4;
      ctx.globalAlpha = a * 0.55;
      ctx.drawImage(this.sprite, n.x - s, n.y - s, s * 2, s * 2);

      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      // Mix toward the secondary accent so the field is not monochrome.
      ctx.fillStyle = `rgb(${lerp(R, c2.r, n.hue) | 0},${lerp(G, c2.g, n.hue) | 0},${lerp(B, c2.b, n.hue) | 0})`;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Settle into a full stop once idle and empty, so nothing burns CPU at rest.
    if (cfg.target === 0 && this.nodes.length === 0 && this.pulses.length === 0) {
      this.stop();
      ctx.clearRect(0, 0, w, h);
      return;
    }

    this.rafId = requestAnimationFrame(this.frame);
  };

  dispose() {
    this.stop();
    this.observer.disconnect();
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function parseColor(str) {
  const s = (str || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('');
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}

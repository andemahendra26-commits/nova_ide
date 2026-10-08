/**
 * Promo capture harness (dev tool, not shipped).
 *
 * Runs the *real* IDE — real protocol, real IPC, real Monaco, real agent — in an
 * offscreen BrowserWindow at true 1920x1080 and dumps every composited frame to
 * disk. The desktop is only 1280x720, so screen-grabbing the normal window would
 * cap the footage at 720p and make any zoom mushy. Offscreen rendering decouples
 * capture resolution from the display entirely.
 *
 * Frame timing is recorded per frame rather than assumed, because JPEG encoding
 * does not keep up with a fixed cadence. The concat manifest carries the real
 * durations so the cut plays back at true speed.
 *
 *   npx electron scripts/promo-capture.js
 *
 * Env:
 *   PROMO_OUT   directory for frames + manifests (required)
 *   PROMO_WS    workspace folder to open
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, nativeTheme } = require('electron');

const appProtocol = require('../src/main/protocol');
const fsIpc = require('../src/main/ipc/fs');
const searchIpc = require('../src/main/ipc/search');
const shellIpc = require('../src/main/ipc/shell');
const miscIpc = require('../src/main/ipc/misc');
const mcpIpc = require('../src/main/ipc/mcp');
const testIpc = require('../src/main/ipc/testrunner');

const OUT = process.env.PROMO_OUT;
const WORKSPACE = process.env.PROMO_WS || 'C:\\D Drive\\aurora-store';
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const QUALITY = 92;

if (!OUT) {
  console.error('PROMO_OUT is required');
  app.exit(1);
}

const FRAMES = path.join(OUT, 'frames');
fs.mkdirSync(FRAMES, { recursive: true });

let n = 0;
let capturing = false;
let lastAt = null;
const timeline = []; // { file, dt }
const marks = [];    // { name, at }
const t0 = () => Date.now();
let started = 0;

function mark(name) {
  const at = Date.now() - started;
  marks.push({ name, at });
  console.log(`  mark ${name} @ ${(at / 1000).toFixed(2)}s`);
}

appProtocol.registerScheme();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  nativeTheme.themeSource = 'dark';
  appProtocol.registerHandler();

  fsIpc.register();
  searchIpc.register();
  shellIpc.register();
  miscIpc.register();
  mcpIpc.register();
  testIpc.register();

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    // Windows clamps a window to the display unless this is set, and this
    // display is 1280x720 — without it the capture comes back 1920x1008.
    enableLargerThanScreen: true,
    show: false,
    frame: false,
    backgroundColor: '#0a0a09',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      offscreen: true,
    },
  });

  win.setContentSize(WIDTH, HEIGHT);
  win.webContents.setFrameRate(FPS);

  win.webContents.on('paint', (_e, _dirty, image) => {
    if (!capturing) return;
    const now = Date.now();
    const dt = lastAt === null ? 1 / FPS : (now - lastAt) / 1000;
    lastAt = now;
    const file = `f${String(n).padStart(6, '0')}.jpg`;
    try {
      fs.writeFileSync(path.join(FRAMES, file), image.toJPEG(QUALITY));
      timeline.push({ file, dt: Math.max(0.004, Math.min(dt, 0.5)) });
      n++;
    } catch (err) {
      console.warn('frame drop:', err.message);
    }
  });

  const js = (code) => win.webContents.executeJavaScript(code, true);

  // Poll the page rather than guessing at a delay — Monaco's load time is not
  // something to hard-code.
  async function until(expr, timeout = 30000, label = expr) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await js(`!!(${expr})`)) return true;
      } catch {
        /* page mid-navigation */
      }
      await wait(120);
    }
    throw new Error(`timeout waiting for ${label}`);
  }

  console.log('loading…');
  started = t0();
  capturing = true;
  win.loadURL(appProtocol.INDEX_URL);

  /* ── 1. boot sequence ────────────────────────────────────────────────── */
  mark('boot.start');
  await until(`document.querySelector('#ag-input')`, 40000, 'shell ready');
  await until(`!document.querySelector('#boot') ||
               document.querySelector('#boot').classList.contains('gone') ||
               getComputedStyle(document.querySelector('#boot')).opacity < 0.05`,
              20000, 'boot overlay gone');
  mark('boot.end');
  await wait(900);

  /* ── 2. the workspace ────────────────────────────────────────────────── */
  mark('tour.start');

  // The harness runs under its own userData directory, so the app's stored
  // "last folder" does not reach it. Drive the real bus instead — the module is
  // already loaded, so this is the same instance the UI listens on.
  await js(`(async () => {
    const { bus } = await import('./js/core/bus.js');
    bus.emit('workspace:openPath', { path: ${JSON.stringify(WORKSPACE)} });
    return true;
  })()`);

  await until(`document.querySelectorAll('#tree .row[data-path]').length > 2`,
              25000, 'tree populated');
  await wait(900);

  // Expand src, then open a real file, the way a person would.
  await js(`(() => {
    const rows = [...document.querySelectorAll('#tree .row[data-path]')];
    const hit = rows.find(r => /[\\\\/]src$/.test(r.dataset.path));
    if (hit) hit.click();
    return !!hit;
  })()`);
  await wait(1200);

  await js(`(() => {
    const rows = [...document.querySelectorAll('#tree .row[data-path]')];
    const hit = rows.find(r => /[\\\\/]lib$/.test(r.dataset.path));
    if (hit) hit.click();
    return !!hit;
  })()`);
  await wait(1100);

  await js(`(() => {
    const rows = [...document.querySelectorAll('#tree .row[data-path]')];
    const hit = rows.find(r => /cart\\.js$/.test(r.dataset.path));
    if (hit) hit.click();
    return !!hit;
  })()`);
  await until(`document.querySelectorAll('.monaco-editor').length > 0`, 20000, 'editor mounted');
  await wait(1800);

  // A slow scroll through the file reads better than a static buffer.
  await js(`(() => {
    const t = document.querySelector('.monaco-scrollable-element');
    if (!t) return false;
    let y = 0;
    const id = setInterval(() => { y += 6; t.scrollTop = y; if (y > 260) clearInterval(id); }, 32);
    return true;
  })()`);
  await wait(2400);
  mark('tour.end');

  /* ── 3. the agent run ────────────────────────────────────────────────── */
  mark('agent.start');
  await js(`(() => {
    const i = document.querySelector('#ag-input');
    i.focus();
    i.value = '';
    return true;
  })()`);
  await wait(400);

  // Type the prompt character by character — the keystrokes are part of the shot.
  const prompt = 'Create a React pricing card component with three tiers';
  for (const ch of prompt) {
    await js(`(() => {
      const i = document.querySelector('#ag-input');
      i.value += ${JSON.stringify(ch)};
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await wait(38);
  }
  await wait(650);
  mark('agent.typed');

  await js(`document.querySelector('#ag-send').click(), true`);

  // Follow the phase rail so each beat gets a mark to cut on.
  const seen = new Set();
  let wasBusy = false;
  const runDeadline = Date.now() + 120000;
  while (Date.now() < runDeadline) {
    const snap = await js(`(() => {
      const m = document.querySelector('#agent-mascot .mascot');
      const send = document.querySelector('#ag-send');
      const tel = document.querySelector('#ag-telemetry');
      return {
        phase: (m && m.dataset.phase) || null,
        busy: !!(send && send.disabled) || !!(tel && tel.hidden === false),
      };
    })()`).catch(() => null);

    if (snap) {
      if (snap.phase && !seen.has(snap.phase)) {
        seen.add(snap.phase);
        mark(`phase.${snap.phase}`);
      }
      if (snap.busy) wasBusy = true;
      else if (wasBusy) break;
    }
    await wait(200);
  }
  mark('agent.end');
  await wait(1600);

  /* ── 4. mascot hero, at scale ────────────────────────────────────────── */
  // The panel mascot is mounted at 0.52. For a close-up we mount the same module
  // again, large, over a clean backdrop — real component, no upscaling.
  mark('hero.start');
  await js(`(async () => {
    const mod = await import('./js/viz/mascot.js');
    const stage = document.createElement('div');
    stage.id = 'promo-hero';
    stage.style.cssText = [
      'position:fixed','inset:0','z-index:99999',
      'display:flex','flex-direction:column','align-items:center','justify-content:center',
      'gap:40px',
      'background:radial-gradient(circle at 50% 42%, #221a15 0%, #0d0c0b 55%, #070706 100%)',
    ].join(';');

    const holder = document.createElement('div');
    const label = document.createElement('div');
    label.id = 'promo-hero-label';
    label.style.cssText = [
      'font:600 34px/1 "JetBrains Mono",Consolas,monospace',
      'letter-spacing:.34em','text-transform:uppercase',
      'color:#f0a868','opacity:.92',
    ].join(';');

    stage.append(holder, label);
    document.body.append(stage);

    const m = mod.mountMascot(holder, { scale: 7 });
    window.__hero = { m, label };
    return true;
  })()`);
  await wait(500);

  const beats = [
    ['understanding', 'understanding', 4200],
    ['thinking', 'thinking', 4200],
    ['planning', 'planning', 4200],
    ['writing', 'writing', 4600],
    ['reviewing', 'reviewing', 4200],
    ['done', 'done', 3000],
  ];
  for (const [phase, text, dwell] of beats) {
    await js(`(() => {
      window.__hero.m.setPhase(${JSON.stringify(phase)});
      window.__hero.label.textContent = ${JSON.stringify(text)};
      return true;
    })()`);
    mark(`hero.${phase}`);
    await wait(dwell);
  }
  await js(`document.querySelector('#promo-hero')?.remove(), true`);
  mark('hero.end');
  await wait(600);

  /* ── 5. terminal ─────────────────────────────────────────────────────── */
  mark('term.start');
  await js(`(() => {
    const ev = new KeyboardEvent('keydown', { key: '\`', ctrlKey: true, bubbles: true });
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
    return true;
  })()`);
  await wait(2200);
  mark('term.end');

  await wait(500);
  capturing = false;

  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));

  // concat demuxer manifest with true per-frame durations
  const lines = ['ffconcat version 1.0'];
  for (const f of timeline) {
    lines.push(`file 'frames/${f.file}'`);
    lines.push(`duration ${f.dt.toFixed(4)}`);
  }
  if (timeline.length) lines.push(`file 'frames/${timeline[timeline.length - 1].file}'`);
  fs.writeFileSync(path.join(OUT, 'frames.ffconcat'), lines.join('\n'));

  const total = timeline.reduce((s, f) => s + f.dt, 0);
  console.log(`\ncaptured ${timeline.length} frames, ${total.toFixed(1)}s real time`);
  console.log(`manifests in ${OUT}`);

  try { mcpIpc.shutdown(); } catch {}
  try { shellIpc.killAll(); } catch {}
  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error('capture failed:', err);
    try {
      fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));
    } catch {}
    app.exit(1);
  })
);

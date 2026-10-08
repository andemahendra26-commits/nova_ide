/**
 * Motion-graphics renderer (dev tool, not shipped).
 *
 * Renders animated title sequences as PNG frame sequences.
 *
 * The frames are deterministic: rather than capturing in real time and hoping
 * the compositor keeps up, every CSS animation is paused and its currentTime is
 * set explicitly per frame via the Web Animations API, then the frame is
 * grabbed. Capture speed therefore has no effect on the result — a slow machine
 * produces the identical sequence, just later.
 *
 *   PROMO_OUT=<dir> npx electron scripts/promo-motion.js
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const OUT = process.env.PROMO_OUT;
if (!OUT) { console.error('PROMO_OUT required'); app.exit(1); }
const ROOT = path.join(OUT, 'motion');
fs.mkdirSync(ROOT, { recursive: true });

const FPS = 30;
const SANS = `'Segoe UI Variable Display','Segoe UI Semibold','Segoe UI',system-ui,sans-serif`;
const MONO = `'Cascadia Code','Consolas','JetBrains Mono',monospace`;

const BASE = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;overflow:hidden}
body{font-family:${SANS};-webkit-font-smoothing:antialiased;color:#f6efe8}
.bg{position:fixed;inset:0;background:
  radial-gradient(1200px 740px at 50% 40%, rgba(217,119,87,.20) 0%, rgba(217,119,87,0) 62%),
  radial-gradient(900px 600px at 80% 90%, rgba(240,168,104,.10) 0%, rgba(240,168,104,0) 60%),
  #090908;}
.stage{position:fixed;inset:0;display:flex;flex-direction:column;
       align-items:center;justify-content:center;text-align:center}
.warm{background:linear-gradient(104deg,#f6b87d 0%,#d97757 54%,#c4593a 100%);
      -webkit-background-clip:text;background-clip:text;color:transparent}

/* Each word animates as its own block: rise + fade + a touch of blur. */
.w{display:inline-block;opacity:0;transform:translateY(46px) scale(.97);
   filter:blur(10px);animation:wordIn .72s cubic-bezier(.16,.84,.3,1) both}
@keyframes wordIn{to{opacity:1;transform:none;filter:blur(0)}}

h1{font-size:106px;line-height:1.07;font-weight:700;letter-spacing:-.035em}
h1.sm{font-size:86px}
.ln{display:block;white-space:nowrap}

.kick{font-family:${MONO};font-size:22px;letter-spacing:.5em;text-transform:uppercase;
      color:#d97757;margin-bottom:40px;opacity:0;
      animation:kickIn .6s ease-out both}
@keyframes kickIn{from{opacity:0;letter-spacing:.9em}to{opacity:.9;letter-spacing:.5em}}

.rule{height:3px;width:0;margin-top:46px;border-radius:2px;
      background:linear-gradient(90deg,#d97757,#f0a868);
      animation:ruleOut .8s cubic-bezier(.16,.84,.3,1) both}
@keyframes ruleOut{to{width:180px}}

/* ── lower third ── */
body.lt{background:transparent}
body.lt .bg{display:none}
.lower{position:fixed;left:110px;bottom:118px;display:flex;align-items:center;gap:26px}
.lower .bar{width:7px;height:0;border-radius:4px;
  background:linear-gradient(180deg,#f0a868,#d97757);
  animation:barUp .5s cubic-bezier(.16,.84,.3,1) both}
@keyframes barUp{to{height:92px}}
.lower .t{font-size:60px;font-weight:700;letter-spacing:-.025em;color:#fdf9f5;
  text-shadow:0 6px 40px rgba(0,0,0,.9);
  clip-path:inset(0 100% 0 0);animation:wipe .62s cubic-bezier(.16,.84,.3,1) .12s both}
@keyframes wipe{to{clip-path:inset(0 0 0 0)}}
.lower .d{font-family:${MONO};font-size:21px;letter-spacing:.32em;text-transform:uppercase;
  color:#f0a868;margin-top:12px;opacity:0;text-shadow:0 2px 22px rgba(0,0,0,.95);
  animation:fadeUp .55s ease-out .34s both}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

/* ── end card ── */
.mark{display:flex;align-items:center;justify-content:center;gap:28px;margin-bottom:42px}
#logo path{stroke-dasharray:160;stroke-dashoffset:160;
  animation:draw 1.1s cubic-bezier(.16,.84,.3,1) both}
@keyframes draw{to{stroke-dashoffset:0}}
.wm{font-size:116px;font-weight:700;letter-spacing:-.042em;opacity:0;
  animation:fadeUp .7s cubic-bezier(.16,.84,.3,1) .38s both}
.wm em{font-style:normal;color:#d97757}
.tag{margin-top:10px;font-size:34px;color:#a99c90;opacity:0;
  animation:fadeUp .6s ease-out .66s both}
.url{margin-top:44px;font-family:${MONO};font-size:25px;letter-spacing:.07em;color:#8d8176;
  opacity:0;animation:fadeUp .6s ease-out .9s both}
`;

const LOGO = `<svg id="logo" width="108" height="108" viewBox="0 0 64 64" fill="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#f6b87d"/><stop offset="1" stop-color="#cc6240"/></linearGradient></defs>
<path d="M14 50V14l36 36V14" stroke="url(#g)" stroke-width="7"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Wrap each word in a span with a staggered delay. */
function words(text, start = 0, step = 0.075) {
  return text
    .split(' ')
    .map((w, i) => `<span class="w" style="animation-delay:${(start + i * step).toFixed(3)}s">${w}</span>`)
    .join(' ');
}

const SCENES = {
  title: {
    dur: 2.6,
    html: `<div class="bg"></div><div class="stage">
      <div class="kick" style="animation-delay:.05s">a thought experiment</div>
      <h1>
        <span class="ln">${words('What if Claude had', 0.22)}</span>
        <span class="ln warm">${words('a place of its own?', 0.52)}</span>
      </h1>
      <div class="rule" style="animation-delay:1.05s"></div>
    </div>`,
  },
  shows: {
    dur: 1.9,
    html: `<div class="bg"></div><div class="stage">
      <h1 class="sm">
        <span class="ln">${words('Most AI tools hand you an answer.', 0.1, 0.05)}</span>
        <span class="ln warm">${words('This one shows its work.', 0.45, 0.06)}</span>
      </h1>
    </div>`,
  },
  ltWrite: {
    dur: 2.2,
    alpha: true,
    html: `<body class="lt"></body><div class="lower">
      <div class="bar"></div>
      <div><div class="t">It types into a real buffer</div>
           <div class="d">character by character</div></div>
    </div>`,
  },
  end: {
    dur: 2.6,
    html: `<div class="bg"></div><div class="stage">
      <div class="mark">${LOGO}<div class="wm">Nova<em> IDE</em></div></div>
      <div class="tag">An IDE that shows its work.</div>
      <div class="url">github.com/andemahendra26-commits/nova_ide</div>
    </div>`,
  },
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const only = process.env.PROMO_SCENES ? process.env.PROMO_SCENES.split(',') : Object.keys(SCENES);

  for (const name of only) {
    const scene = SCENES[name];
    if (!scene) continue;

    const win = new BrowserWindow({
      width: 1920, height: 1080, useContentSize: true,
      enableLargerThanScreen: true, show: false, frame: false,
      transparent: !!scene.alpha,
      backgroundColor: scene.alpha ? '#00000000' : '#090908',
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    win.setContentSize(1920, 1080);

    const doc = `<!doctype html><meta charset="utf-8"><style>${BASE}</style>${scene.html}`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc));
    await new Promise((r) => setTimeout(r, 450));

    const dir = path.join(ROOT, name);
    fs.mkdirSync(dir, { recursive: true });

    const total = Math.round(scene.dur * FPS);
    for (let i = 0; i < total; i++) {
      const ms = (i / FPS) * 1000;
      // Drive every animation to an exact time instead of racing the clock.
      await win.webContents.executeJavaScript(
        `(() => { const t=${ms};
           for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
           return true; })()`,
        true
      );
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.png`), img.toPNG());
    }
    console.log(`  ${name}: ${total} frames (${scene.dur}s)${scene.alpha ? ' [alpha]' : ''}`);
    win.destroy();
  }

  console.log(`\nmotion -> ${ROOT}`);
  app.exit(0);
});

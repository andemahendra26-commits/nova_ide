/**
 * Advertisement text layer (dev tool, not shipped).
 *
 * Renders a single full-length 1920x1080 transparent overlay — every headline,
 * lower-third, scrim and the end card, timed to the cut — as a PNG sequence
 * that is composited over the footage in one ffmpeg pass.
 *
 * The frames are deterministic. Rather than capturing in real time and hoping
 * the compositor keeps pace, every CSS animation is paused and its currentTime
 * set explicitly per frame through the Web Animations API, then the frame is
 * grabbed. A slow machine produces an identical sequence, just later.
 *
 * The window is 1280x720 logical; this display runs at 1.5x, so captures land
 * at exactly 1920x1080. All CSS below is therefore written in 720p units.
 *
 *   PROMO_OUT=<dir> npx electron scripts/promo-ad.js
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const OUT = process.env.PROMO_OUT;
if (!OUT) { console.error('PROMO_OUT required'); app.exit(1); }

const FPS = 30;
const DUR = 10.0;
const DIR = path.join(OUT, 'adlayer');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const SANS = `'Segoe UI Variable Display','Segoe UI Semibold','Segoe UI',system-ui,sans-serif`;
const MONO = `'Cascadia Code','Consolas','JetBrains Mono',monospace`;

/** Wrap each word so it can rise in on its own delay. */
function words(text, start, step = 0.055, cls = '') {
  return text.split(' ')
    .map((w, i) => `<span class="w ${cls}" style="animation-delay:${(start + i * step).toFixed(3)}s">${w}</span>`)
    .join(' ');
}

/**
 * Visibility window for one block.
 *
 * Two chained animations (fade-in delayed, fade-out delayed) does NOT work:
 * `fill-mode: both` makes the fade-out fill *backwards* with its from-state,
 * so opacity is 1 from t=0 and every caption shows at once. Instead each block
 * gets one generated keyframe set spanning the full timeline.
 */
const KEYFRAMES = [];
function hold(start, end, fadeIn = 0.35, fadeOut = 0.3) {
  const pct = (t) => ((t / DUR) * 100).toFixed(4);
  const name = `h${KEYFRAMES.length}`;
  KEYFRAMES.push(
    `@keyframes ${name}{` +
    `0%,${pct(start)}%{opacity:0}` +
    `${pct(start + fadeIn)}%{opacity:1}` +
    `${pct(end - fadeOut)}%{opacity:1}` +
    `${pct(end)}%,100%{opacity:0}}`
  );
  return `animation:${name} ${DUR}s linear both`;
}

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1280px;height:720px;overflow:hidden;background:transparent}
body{font-family:${SANS};-webkit-font-smoothing:antialiased;color:#fdf8f3}
.layer{position:fixed;inset:0;pointer-events:none}

@keyframes fIn{from{opacity:0}to{opacity:1}}
@keyframes fOut{from{opacity:1}to{opacity:0}}
@keyframes wordIn{from{opacity:0;transform:translateY(26px) scale(.98);filter:blur(7px)}
                  to{opacity:1;transform:none;filter:blur(0)}}
@keyframes barUp{from{height:0}to{height:56px}}
@keyframes wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes draw{from{stroke-dashoffset:160}to{stroke-dashoffset:0}}
@keyframes ruleOut{from{width:0}to{width:120px}}

.w{display:inline-block;animation:wordIn .55s cubic-bezier(.16,.84,.3,1) both}

/* A scrim keeps headline type legible over busy footage. */
.scrim{position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(8,8,7,.90) 0%,rgba(8,8,7,.72) 45%,rgba(8,8,7,.88) 100%)}

.center{position:absolute;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:center;text-align:center;padding:0 90px}
.kick{font-family:${MONO};font-size:15px;letter-spacing:.46em;text-transform:uppercase;
      color:#e08a63;margin-bottom:22px}
h1{font-size:62px;line-height:1.08;font-weight:700;letter-spacing:-.032em}
.warm{background:linear-gradient(104deg,#f8bd84 0%,#dd7d5c 55%,#c85c3c 100%);
      -webkit-background-clip:text;background-clip:text;color:transparent}
.rule{height:3px;border-radius:2px;margin-top:26px;
      background:linear-gradient(90deg,#d97757,#f0a868)}

/* top banner — used over the mascot beats, which already carry a bottom label */
.top{position:absolute;top:58px;left:0;right:0;text-align:center}
.top .t{font-size:40px;font-weight:700;letter-spacing:-.022em;
        text-shadow:0 3px 26px rgba(0,0,0,.95),0 0 60px rgba(0,0,0,.7)}
.top .t em{font-style:normal;color:#f0a868}

/* lower third — used over the code beats */
.lt{position:absolute;left:68px;bottom:68px;display:flex;align-items:center;gap:18px}
.lt .bar{width:5px;border-radius:3px;background:linear-gradient(180deg,#f0a868,#d97757)}
.lt .t{font-size:38px;font-weight:700;letter-spacing:-.02em;
       text-shadow:0 3px 28px rgba(0,0,0,.95)}
.lt .d{font-family:${MONO};font-size:14px;letter-spacing:.3em;text-transform:uppercase;
       color:#f0a868;margin-top:8px;text-shadow:0 2px 18px rgba(0,0,0,.95)}

/* end card */
.end{position:absolute;inset:0;background:
  radial-gradient(760px 470px at 50% 42%, rgba(217,119,87,.20) 0%, rgba(217,119,87,0) 62%),
  #090908;
  display:flex;flex-direction:column;align-items:center;justify-content:center}
.mark{display:flex;align-items:center;gap:18px;margin-bottom:14px}
.wm{font-size:72px;font-weight:700;letter-spacing:-.04em}
.wm em{font-style:normal;color:#d97757}
.tag{font-size:22px;color:#ab9e92;margin-top:4px}
.pills{margin-top:24px;display:flex;gap:10px}
.pill{font-family:${MONO};font-size:12px;letter-spacing:.14em;text-transform:uppercase;
  color:#cbbdaf;border:1px solid rgba(217,119,87,.34);border-radius:999px;
  padding:8px 15px;background:rgba(217,119,87,.08)}
.url{margin-top:28px;font-family:${MONO};font-size:15px;letter-spacing:.07em;color:#8d8176}
`;

const LOGO = `<svg width="66" height="66" viewBox="0 0 64 64" fill="none">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#f8bd84"/><stop offset="1" stop-color="#cc6240"/></linearGradient></defs>
<path d="M14 50V14l36 36V14" stroke="url(#g)" stroke-width="7" stroke-linecap="round"
  stroke-linejoin="round" style="stroke-dasharray:160;animation:draw .95s cubic-bezier(.16,.84,.3,1) 8.50s both"/></svg>`;

/* Beat boundaries of the 10s cut:
   0.0 type | 2.0 think | 3.4 plan | 4.7 type | 6.9 write | 8.5 done | 10.0 */
const BODY = `
<div class="layer">

  <!-- 0.10 – 1.90 : hook, over the first typing beat -->
  <div class="scrim" style="${hold(0.10, 2.35, 0.4, 0.35)}"></div>
  <div class="center" style="${hold(0.10, 2.35, 0.3, 0.35)}">
    <div class="kick" style="animation:rise .5s ease-out .18s both">a thought experiment</div>
    <h1>
      <span style="display:block">${words('What if Claude had', 0.34)}</span>
      <span style="display:block">${words('a place of its own?', 0.60, 0.055, 'warm')}</span>
    </h1>
    <div class="rule" style="animation:ruleOut .6s cubic-bezier(.16,.84,.3,1) 1.15s both"></div>
  </div>

  <!-- 2.10 – 3.30 : thinking beat -->
  <div class="top" style="${hold(2.45, 3.55, 0.26, 0.24)}">
    <div class="t">Most AI tools hand you an answer.</div>
  </div>

  <!-- 3.50 – 4.62 : planning beat -->
  <div class="top" style="${hold(3.64, 4.72, 0.24, 0.22)}">
    <div class="t">This one <em>shows its work.</em></div>
  </div>

  <!-- 4.85 – 6.80 : the CSS typing beat -->
  <div class="lt" style="${hold(4.88, 6.88, 0.3, 0.28)}">
    <div class="bar" style="animation:barUp .42s cubic-bezier(.16,.84,.3,1) 4.98s both"></div>
    <div>
      <div class="t" style="animation:wipe .5s cubic-bezier(.16,.84,.3,1) 5.05s both">
        It types into a real buffer
      </div>
      <div class="d" style="animation:rise .45s ease-out 5.30s both">character by character</div>
    </div>
  </div>

  <!-- 7.05 – 8.40 : writing beat -->
  <div class="top" style="${hold(7.00, 8.18, 0.24, 0.22)}">
    <div class="t">Six phases. <em>All of them visible.</em></div>
  </div>

  <!-- 8.80 – 10.0 : end card -->
  <div class="end" style="animation:fIn .42s ease-out 8.35s both">
    <div class="mark">
      ${LOGO}
      <div class="wm" style="animation:rise .55s cubic-bezier(.16,.84,.3,1) 8.62s both">Nova<em> IDE</em></div>
    </div>
    <div class="tag" style="animation:rise .5s ease-out 8.84s both">An IDE that shows its work.</div>
    <div class="pills" style="animation:rise .5s ease-out 9.02s both">
      <span class="pill">Offline agent</span>
      <span class="pill">MCP built in</span>
      <span class="pill">Windows .exe</span>
    </div>
    <div class="url" style="animation:rise .5s ease-out 9.20s both">
      github.com/andemahendra26-commits/nova_ide
    </div>
  </div>
</div>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 720, useContentSize: true,
    enableLargerThanScreen: true, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.setContentSize(1280, 720);

  // A data: URL of this size fails to load (ERR_FAILED); a real file does not.
  const tmp = path.join(DIR, '_ad.html');
  const css = CSS + '\n' + KEYFRAMES.join('\n');
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>${css}</style>${BODY}`, 'utf8');
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 500));

  const total = Math.round(DUR * FPS);
  for (let i = 0; i < total; i++) {
    await win.webContents.executeJavaScript(
      `(() => { const t=${(i / FPS) * 1000};
         for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
         return true; })()`, true);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(DIR, `f${String(i).padStart(4, '0')}.png`), img.toPNG());
    if (i % 60 === 0) console.log(`  ${i}/${total}`);
  }

  const size = win.webContents.getOwnerBrowserWindow().getContentSize();
  console.log(`\n${total} overlay frames (logical ${size[0]}x${size[1]}) -> ${DIR}`);
  app.exit(0);
});

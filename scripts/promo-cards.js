/**
 * Promo card renderer (dev tool, not shipped).
 *
 * Renders the montage's title cards and lower-thirds as HTML in an offscreen
 * Electron window and writes them out as 1920x1080 PNGs. ffmpeg's drawtext
 * cannot kern, wrap, gradient-fill or letter-space, and on a piece whose whole
 * pitch is "this looks considered" the typography is not the place to economise.
 *
 *   PROMO_OUT=<dir> npx electron scripts/promo-cards.js
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const OUT = process.env.PROMO_OUT;
if (!OUT) {
  console.error('PROMO_OUT is required');
  app.exit(1);
}
const CARDS = path.join(OUT, 'cards');
fs.mkdirSync(CARDS, { recursive: true });

const SANS = `'Segoe UI Variable Display','Segoe UI Semibold','Segoe UI',system-ui,sans-serif`;
const MONO = `'Cascadia Code','Consolas','JetBrains Mono',monospace`;

const BASE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1920px; height:1080px; overflow:hidden; }
  body {
    font-family:${SANS};
    -webkit-font-smoothing:antialiased;
    display:flex; align-items:center; justify-content:center;
    color:#f6efe8;
  }
  .solid {
    position:fixed; inset:0;
    background:
      radial-gradient(1100px 680px at 50% 38%, rgba(217,119,87,.17) 0%, rgba(217,119,87,0) 62%),
      radial-gradient(900px 600px at 78% 88%, rgba(240,168,104,.09) 0%, rgba(240,168,104,0) 60%),
      #090908;
  }
  /* A faint grid keeps a flat black card from reading as a dead frame. */
  .grid {
    position:fixed; inset:0; opacity:.5;
    background-image:
      linear-gradient(rgba(255,255,255,.022) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.022) 1px, transparent 1px);
    background-size:64px 64px;
    mask-image:radial-gradient(900px 620px at 50% 44%, #000 0%, transparent 76%);
  }
  .wrap { position:relative; text-align:center; padding:0 150px; }
  h1 {
    font-size:104px; line-height:1.06; font-weight:700; letter-spacing:-.034em;
  }
  h1 .warm {
    background:linear-gradient(104deg,#f3b074 0%,#d97757 52%,#c9603f 100%);
    -webkit-background-clip:text; background-clip:text; color:transparent;
  }
  h1.sm { font-size:82px; }
  .kicker {
    font-family:${MONO}; font-size:23px; letter-spacing:.44em; text-transform:uppercase;
    color:#d97757; opacity:.85; margin-bottom:38px;
  }
  .sub {
    margin-top:36px; font-size:33px; line-height:1.45; font-weight:400;
    color:#a99c90; letter-spacing:-.006em;
  }
  .rule {
    width:104px; height:3px; margin:52px auto 0; border-radius:2px;
    background:linear-gradient(90deg,#d97757,#f0a868);
  }

  /* lower-third */
  body.lower { background:transparent; display:block; }
  .lt {
    position:fixed; left:112px; bottom:116px;
    display:flex; align-items:center; gap:26px;
  }
  .lt .bar { width:6px; height:84px; border-radius:3px;
             background:linear-gradient(180deg,#f0a868,#d97757); }
  .lt .txt .t {
    font-size:58px; font-weight:700; letter-spacing:-.022em; color:#fcf7f2;
    text-shadow:0 4px 34px rgba(0,0,0,.85);
  }
  .lt .txt .d {
    font-family:${MONO}; font-size:21px; letter-spacing:.3em; text-transform:uppercase;
    color:#f0a868; margin-top:12px; text-shadow:0 2px 20px rgba(0,0,0,.9);
  }

  /* end card */
  .mark { display:flex; align-items:center; justify-content:center; gap:30px; margin-bottom:46px; }
  .mark svg { filter:drop-shadow(0 0 34px rgba(217,119,87,.5)); }
  .wordmark { font-size:112px; font-weight:700; letter-spacing:-.04em; }
  .wordmark em { font-style:normal; color:#d97757; }
  .url {
    margin-top:58px; font-family:${MONO}; font-size:26px; letter-spacing:.08em; color:#8d8176;
  }
  .pills { margin-top:46px; display:flex; gap:16px; justify-content:center; flex-wrap:wrap; }
  .pill {
    font-family:${MONO}; font-size:21px; letter-spacing:.12em; text-transform:uppercase;
    color:#c7b8aa; border:1px solid rgba(217,119,87,.32); border-radius:999px;
    padding:13px 26px; background:rgba(217,119,87,.07);
  }
`;

const LOGO = `
<svg width="104" height="104" viewBox="0 0 64 64" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f3b074"/><stop offset="1" stop-color="#d0653f"/>
    </linearGradient>
  </defs>
  <path d="M14 50V14l36 36V14" stroke="url(#g)" stroke-width="7"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function card(inner, extraBody = '') {
  return `<!doctype html><meta charset="utf-8"><style>${BASE}</style>
<body class="${extraBody}"><div class="solid"></div><div class="grid"></div>
<div class="wrap">${inner}</div></body>`;
}

function lower(title, detail) {
  return `<!doctype html><meta charset="utf-8"><style>${BASE}</style>
<body class="lower"><div class="lt">
  <div class="bar"></div>
  <div class="txt"><div class="t">${title}</div><div class="d">${detail}</div></div>
</div></body>`;
}

const SPEC = [
  ['c01-hook', card(`
      <div class="kicker">a thought experiment</div>
      <h1>What if Claude had<br><span class="warm">a place of its own?</span></h1>`)],

  ['c02-not-chat', card(`
      <h1>Not a chat window.<br><span class="warm">A workspace.</span></h1>
      <div class="rule"></div>`)],

  ['c03-watch', card(`
      <div class="kicker">the whole idea</div>
      <h1 class="sm">Most AI tools hand you<br>an answer.<br><span class="warm">This one shows its work.</span></h1>`)],

  ['c04-phases', card(`
      <h1 class="sm">Understanding. Thinking.<br>Planning. Writing. Reviewing.</h1>
      <div class="sub">Every phase rendered at human-legible speed.</div>`)],

  ['c05-writes', card(`
      <h1>It types into a<br><span class="warm">real buffer.</span></h1>
      <div class="sub">Character by character, under a live caret — not a diff dropped on you.</div>`)],

  ['c06-built-in', card(`
      <div class="kicker">also included</div>
      <h1 class="sm">Terminal. Test studio.<br>MCP server. <span class="warm">Built in.</span></h1>`)],

  ['c07-end', card(`
      <div class="mark">${LOGO}<div class="wordmark">Nova<em> IDE</em></div></div>
      <div class="sub">An IDE that shows its work.</div>
      <div class="pills">
        <span class="pill">Electron + Monaco</span>
        <span class="pill">Offline agent</span>
        <span class="pill">MCP on :4319</span>
        <span class="pill">Windows .exe</span>
      </div>
      <div class="url">github.com/andemahendra26-commits/nova_ide</div>`)],

  ['l-explorer', lower('Your project, open', 'explorer · tabs · monaco')],
  ['l-under', lower('It reads the request', 'phase 1 — understanding')],
  ['l-think', lower('It reasons in the open', 'phase 2 — thinking')],
  ['l-plan', lower('It commits to a plan', 'phase 3 — planning')],
  ['l-write', lower('It writes the code', 'phase 4 — writing')],
  ['l-review', lower('It checks its own work', 'phase 5 — reviewing')],
  ['l-done', lower('Two files, written', 'component · scoped styles · reviewed')],
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    useContentSize: true,
    enableLargerThanScreen: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.setContentSize(1920, 1080);

  for (const [name, html] of SPEC) {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Give the compositor a beat to settle gradients and webfont metrics.
    await new Promise((r) => setTimeout(r, 420));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(CARDS, `${name}.png`), img.toPNG());
    console.log('  ', name, img.getSize());
  }

  console.log(`\n${SPEC.length} cards -> ${CARDS}`);
  app.exit(0);
});

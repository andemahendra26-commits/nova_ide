/**
 * Renders every mascot pose into a single static page so the character can be
 * eyeballed (and screenshotted) without launching the whole IDE.
 * Dev-only: `node scripts/preview-mascot.js`, output in .preview/mascot.html
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/renderer/js/viz/mascot.js'), 'utf8');

const P = 4;
const W = 30;
const H = 26;

// Lift the SVG template out of the ES module without importing it.
const body = src.slice(src.indexOf('<svg class="mascot"'), src.lastIndexOf('</svg>') + 6);

// Expand the r(...) template calls into literal rects.
let svg = body.replace(/\$\{r\(([^)]*)\)\}/g, (_m, args) => {
  const parts = args.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  const [x, y, w, h] = parts.slice(0, 4).map(Number);
  const cls = parts[4] || 'mc-fill';
  return `<rect x="${x * P}" y="${y * P}" width="${w * P}" height="${h * P}" class="${cls}"/>`;
});

svg = svg
  .replace(/\$\{W \* P \* scale\}/g, String(W * P * 1.15))
  .replace(/\$\{H \* P \* scale\}/g, String(H * P * 1.15))
  .replace(/\$\{W \* P\}/g, String(W * P))
  .replace(/\$\{H \* P\}/g, String(H * P));

const PHASES = ['idle', 'understanding', 'thinking', 'planning', 'writing', 'reviewing', 'done', 'error'];

const gazeFor = (p) =>
  p === 'thinking' || p === 'planning' ? 'up'
    : ['writing', 'understanding', 'reviewing'].includes(p) ? 'down'
      : 'center';

const cells = PHASES.map((p) => {
  const one = svg.replace('class="mascot"', `class="mascot" data-phase="${p}" data-gaze="${gazeFor(p)}"`);
  return `<div class="cell"><div class="lbl">${p}</div><div class="mascot-wrap">${one}</div></div>`;
}).join('\n');

const html = `<!doctype html>
<html data-theme="claude-dark">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="themes.css">
<link rel="stylesheet" href="mascot.css">
<style>
  body { background:#0a0a09; margin:0; padding:18px; font-family:system-ui;
         display:flex; flex-wrap:wrap; gap:10px; }
  .cell { width:190px; text-align:center; }
  .lbl { color:#d97757; font-size:11px; text-transform:uppercase;
         letter-spacing:.12em; margin-bottom:8px; font-weight:700; }
</style>
</head>
<body>
${cells}
</body>
</html>`;

const out = path.join(root, '.preview');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'mascot.html'), html);

// Copy the stylesheets in so the page is self-contained and file:// safe.
for (const f of ['tokens.css', 'themes.css', 'mascot.css']) {
  fs.copyFileSync(path.join(root, 'src/renderer/css', f), path.join(out, f));
}

console.log(`preview -> .preview/mascot.html (${PHASES.length} poses)`);

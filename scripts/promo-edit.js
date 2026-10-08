/**
 * Promo edit (dev tool, not shipped).
 *
 * Takes the raw offscreen capture (2880x1620 frames + a marks file) plus the
 * rendered cards, and cuts the montage.
 *
 * Why it is a script and not a pile of shell: every cut is anchored to a *mark*
 * emitted by the capture harness rather than a hand-timed second, so re-running
 * the capture does not invalidate the edit.
 *
 *   PROMO_OUT=<dir> node scripts/promo-edit.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = process.env.PROMO_OUT;
if (!OUT) throw new Error('PROMO_OUT is required');

const CARDS = path.join(OUT, 'cards');
const WORK = path.join(OUT, 'work');
const FINAL = path.join(OUT, 'final');
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(FINAL, { recursive: true });

const marksArr = JSON.parse(fs.readFileSync(path.join(OUT, 'marks.json'), 'utf8'));
const M = {};
for (const m of marksArr) if (!(m.name in M)) M[m.name] = m.at / 1000;

const W = 1920;
const H = 1080;
const FPS = 30;

const ff = (args, label) => {
  process.stdout.write(`  · ${label}\n`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
    maxBuffer: 1 << 26,
  });
};

/* ── 1. master ───────────────────────────────────────────────────────────── */

const MASTER = path.join(WORK, 'master.mp4');
if (!fs.existsSync(MASTER)) {
  console.log('building master…');
  ff(
    ['-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.ffconcat'),
     '-vsync', 'vfr', '-r', String(FPS),
     '-c:v', 'libx264', '-crf', '13', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
     MASTER],
    'master.mp4'
  );
}

const probe = (f) =>
  parseFloat(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                             '-of', 'default=nw=1:nk=1', f]).toString().trim()
  );

const MASTER_DUR = probe(MASTER);
console.log(`master: ${MASTER_DUR.toFixed(1)}s`);

/* ── 2. shot grammar ─────────────────────────────────────────────────────── */

const GRADE = 'eq=contrast=1.05:saturation=1.07:gamma=0.99';

/**
 * A push-in. Source is 2880x1620 and output is 1920x1080, so zooming to 1.5x
 * still reads native — no upscaling anywhere in this range.
 */
function push(from, to, dur) {
  const step = (to - from) / (dur * FPS);
  return [
    `zoompan=z='min(${from}+on*${step.toFixed(7)},${to})'`,
    `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    `:d=1:s=${W}x${H}`,
  ].join('');
}

/** Crop a named region of the 2880x1620 frame, then fit it to 1920x1080. */
const REGIONS = {
  full: null,
  // Calibrated against real frames. Nothing is cropped below ~1400px wide, so
  // no shot is upscaled more than ~1.37x from the 2880-wide source.
  agentCtx: { x: 1480, y: 60, w: 1400, h: 788 },
  editor: { x: 466, y: 60, w: 1870, h: 1052 },
  editorTight: { x: 520, y: 130, w: 1600, h: 900 },
  tree: { x: 30, y: 50, w: 1400, h: 788 },
  input: { x: 1430, y: 980, w: 1450, h: 816 },
};

function regionFilter(name) {
  const r = REGIONS[name];
  if (!r) return null;
  // Fit the region into 16:9 without distorting it.
  const target = W / H;
  let { x, y, w, h } = r;
  if (w / h > target) h = Math.round(w / target);
  else w = Math.round(h * target);
  x = Math.max(0, Math.min(x, 2880 - w));
  y = Math.max(0, Math.min(y, 1620 - h));
  return `crop=${w}:${h}:${x}:${y}`;
}

let clipIdx = 0;

/**
 * Cut one shot out of the master.
 *   at/dur   seconds into the master
 *   region   a key of REGIONS
 *   zoom     [from,to] push-in
 *   lower    card basename of a lower-third to overlay
 */
function shot({ at, dur, region = 'full', zoom = [1.0, 1.08], lower = null, label }) {
  const file = path.join(WORK, `s${String(clipIdx++).padStart(2, '0')}.mp4`);
  const chain = ['setpts=PTS-STARTPTS'];
  const rf = regionFilter(region);
  if (rf) chain.push(rf);
  chain.push(push(zoom[0], zoom[1], dur));
  chain.push(GRADE);
  chain.push('unsharp=5:5:0.35:5:5:0.0');
  chain.push(`fps=${FPS}`, `format=yuv420p`);

  const args = ['-ss', at.toFixed(3), '-t', dur.toFixed(3), '-i', MASTER];

  if (lower) {
    args.push('-framerate', String(FPS), '-loop', '1', '-t', dur.toFixed(3), '-i', path.join(CARDS, `${lower}.png`));
    const fo = Math.max(0.1, dur - 0.75);
    args.push(
      '-filter_complex',
      `[0:v]${chain.join(',')}[base];` +
      `[1:v]scale=${W}:${H},format=rgba,` +
        `fade=in:st=0.15:d=0.45:alpha=1,fade=out:st=${fo.toFixed(2)}:d=0.45:alpha=1[lt];` +
      `[base][lt]overlay=0:0:format=auto,format=yuv420p[v]`,
      '-map', '[v]'
    );
  } else {
    args.push('-vf', chain.join(','));
  }

  args.push('-an', '-c:v', 'libx264', '-crf', '15', '-preset', 'veryfast',
            '-pix_fmt', 'yuv420p', '-r', String(FPS), file);
  ff(args, `${label} (${dur.toFixed(1)}s)`);
  return { file, dur: probe(file) };
}

/** A still card, with a gentle drift so it is not a frozen frame. */
function cardClip(name, dur, { drift = 1.045, label } = {}) {
  const file = path.join(WORK, `s${String(clipIdx++).padStart(2, '0')}.mp4`);
  const step = (drift - 1) / (dur * FPS);
  ff(
    ['-framerate', String(FPS), '-loop', '1', '-t', dur.toFixed(3), '-i', path.join(CARDS, `${name}.png`),
     '-vf',
     [
       `scale=${Math.round(W * 1.08)}:-2`,
       `zoompan=z='min(1+on*${step.toFixed(7)},${drift})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}`,
       `fps=${FPS}`,
       `fade=in:st=0:d=0.35`,
       `fade=out:st=${Math.max(0.1, dur - 0.4).toFixed(2)}:d=0.4`,
       'format=yuv420p',
     ].join(','),
     '-an', '-c:v', 'libx264', '-crf', '15', '-preset', 'veryfast',
     '-pix_fmt', 'yuv420p', '-r', String(FPS), file],
    `${label || name} (${dur}s)`
  );
  return { file, dur: probe(file) };
}

/* ── 3. the cut ──────────────────────────────────────────────────────────── */

const need = (k, fallback) => {
  if (k in M) return M[k];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing mark: ${k}`);
};

const span = (a, b, max) => Math.max(0.6, Math.min(need(b) - need(a), max));

console.log('\nmarks:', Object.keys(M).join(', '));

const heroPhases = ['understanding', 'thinking', 'planning', 'writing', 'reviewing', 'done']
  .filter((p) => `hero.${p}` in M);

const timeline = [];
const push_ = (c, trans = 'cut', td = 0) => timeline.push({ ...c, trans, td });

// cold open
push_(cardClip('c01-hook', 3.6, { label: 'hook' }), 'fade', 0.5);

// boot sequence — the particles converging on the mark
push_(shot({
  at: need('boot.start'), dur: Math.min(need('boot.end') + 1.4, 4.2),
  zoom: [1.0, 1.14], label: 'boot',
}), 'fade', 0.45);

push_(cardClip('c02-not-chat', 3.0, { label: 'not-chat' }), 'fade', 0.4);

// the workspace
push_(shot({
  at: need('tour.start') + 2.6, dur: 4.6, region: 'full', zoom: [1.0, 1.1],
  lower: 'l-explorer', label: 'workspace',
}), 'fade', 0.35);

push_(shot({
  at: need('tour.start') + 7.0, dur: 2.4, region: 'tree', zoom: [1.0, 1.08],
  label: 'tree-detail',
}), 'cut');

push_(cardClip('c03-watch', 3.2, { label: 'watch' }), 'fade', 0.4);

// the prompt being typed
push_(shot({
  at: need('agent.typed') - 2.0, dur: 2.6, region: 'input', zoom: [1.0, 1.06],
  label: 'prompt',
}), 'fade', 0.3);

// phase beats, framed on the agent panel so the mascot is readable
const beat = [
  ['phase.understanding', 'phase.thinking', 'l-under', 'understanding'],
  ['phase.thinking', 'phase.planning', 'l-think', 'thinking'],
  ['phase.planning', 'phase.writing', 'l-plan', 'planning'],
];
for (const [a, b, lt, name] of beat) {
  if (!(a in M)) continue;
  const end = b in M ? M[b] : M[a] + 3.4;
  push_(shot({
    at: M[a] + 0.25, dur: Math.max(2.4, Math.min(end - M[a] - 0.3, 4.2)),
    region: 'agentCtx', zoom: [1.0, 1.07], lower: lt, label: `beat-${name}`,
  }), 'cut');
}

push_(cardClip('c05-writes', 3.0, { label: 'writes' }), 'fade', 0.4);

// live writing, framed on the editor
if ('phase.writing' in M) {
  const wEnd = 'phase.reviewing' in M ? M['phase.reviewing'] : M['phase.writing'] + 8;
  push_(shot({
    at: M['phase.writing'] + 0.6, dur: Math.max(3.5, Math.min(wEnd - M['phase.writing'] - 0.8, 7.0)),
    region: 'editor', zoom: [1.0, 1.12], lower: 'l-write', label: 'live-writing',
  }), 'fade', 0.35);

  push_(shot({
    at: M['phase.writing'] + 2.2, dur: 3.0, region: 'editorTight', zoom: [1.0, 1.1],
    label: 'caret-closeup',
  }), 'cut');
}

if ('phase.reviewing' in M) {
  push_(shot({
    at: M['phase.reviewing'] + 0.2, dur: 3.0, region: 'agentCtx', zoom: [1.0, 1.06],
    lower: 'l-review', label: 'beat-reviewing',
  }), 'cut');
}

push_(cardClip('c04-phases', 3.0, { label: 'phases-card' }), 'fade', 0.45);

// ── the mascot, large. this is the piece people will remember ──
for (const p of heroPhases) {
  const nextIdx = heroPhases.indexOf(p) + 1;
  const endMark = nextIdx < heroPhases.length ? `hero.${heroPhases[nextIdx]}` : 'hero.end';
  const end = endMark in M ? M[endMark] : M[`hero.${p}`] + 3.4;
  const d = Math.max(2.0, Math.min(end - M[`hero.${p}`] - 0.5, 3.2));
  push_(shot({
    at: M[`hero.${p}`] + 0.45, dur: d, region: 'full',
    zoom: p === 'writing' ? [1.12, 1.3] : [1.1, 1.22],
    label: `hero-${p}`,
  }), nextIdx === 1 ? 'fade' : 'cut', 0.4);
}

push_(cardClip('c06-built-in', 2.9, { label: 'built-in' }), 'fade', 0.45);

push_(shot({
  at: MASTER_DUR - 2.7, dur: 2.4, region: 'agentCtx', zoom: [1.0, 1.07],
  lower: 'l-done', label: 'result',
}), 'fade', 0.35);

push_(cardClip('c07-end', 5.0, { drift: 1.03, label: 'end-card' }), 'fade', 0.6);

/* ── 4. assemble ─────────────────────────────────────────────────────────── */

console.log('\nassembling…');

const inputs = [];
timeline.forEach((c) => inputs.push('-i', c.file));

// xfade chains pairwise; each transition eats `td` seconds of overlap, so the
// offset of the next one has to account for every overlap already spent.
const parts = [];
let cur = '[0:v]';
let acc = timeline[0].dur;
for (let i = 1; i < timeline.length; i++) {
  const t = timeline[i];
  const td = t.trans === 'fade' ? Math.max(0.2, t.td || 0.4) : 0;
  const out = i === timeline.length - 1 ? '[vout]' : `[x${i}]`;
  if (td > 0) {
    const off = acc - td;
    parts.push(`${cur}[${i}:v]xfade=transition=fade:duration=${td.toFixed(2)}:offset=${off.toFixed(3)}${out}`);
    // xfade's output runs to offset + durB, so each transition costs `td`.
    acc = off + t.dur;
  } else {
    parts.push(`${cur}[${i}:v]xfade=transition=fade:duration=0.08:offset=${(acc - 0.08).toFixed(3)}${out}`);
    acc = acc - 0.08 + t.dur;
  }
  cur = out;
}

const totalDur = acc;
const SILENT = 'anullsrc=channel_layout=stereo:sample_rate=48000';

const MP4 = path.join(FINAL, 'nova-ide-promo-1080p.mp4');
ff(
  [...inputs,
   '-f', 'lavfi', '-t', totalDur.toFixed(2), '-i', SILENT,
   '-filter_complex', parts.join(';'),
   '-map', '[vout]', '-map', `${timeline.length}:a`,
   '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-profile:v', 'high',
   '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart',
   '-c:a', 'aac', '-b:a', '128k', '-shortest',
   MP4],
  `nova-ide-promo-1080p.mp4 (~${totalDur.toFixed(0)}s)`
);

// LinkedIn's feed favours square; pad rather than crop so nothing is lost.
const SQ = path.join(FINAL, 'nova-ide-promo-square.mp4');
ff(
  ['-i', MP4,
   '-vf', 'scale=1080:-2,pad=1080:1080:0:(oh-ih)/2:color=#090908',
   '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-pix_fmt', 'yuv420p',
   '-movflags', '+faststart', '-c:a', 'copy', SQ],
  'nova-ide-promo-square.mp4'
);

console.log(`\ndone -> ${FINAL}`);
for (const f of fs.readdirSync(FINAL)) {
  const s = fs.statSync(path.join(FINAL, f));
  console.log(`  ${f}  ${(s.size / 1048576).toFixed(1)} MB`);
}

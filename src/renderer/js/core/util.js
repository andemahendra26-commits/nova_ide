/* ── DOM helpers ──────────────────────────────────────────────────────── */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Inline SVG from a path spec. Keeps icon definitions to one line each. */
export function svg(paths, size = 16, opts = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', opts.viewBox || '0 0 16 16');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', opts.fill || 'none');
  s.setAttribute('stroke', opts.stroke || 'currentColor');
  s.setAttribute('stroke-width', opts.width || 1.4);
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  for (const d of [].concat(paths)) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/* ── Path helpers (renderer has no Node path module) ──────────────────── */

export const SEP = navigator.userAgent.includes('Windows') ? '\\' : '/';

export const basename = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || '';
export const dirname = (p) => {
  const parts = (p || '').split(/[\\/]/);
  parts.pop();
  return parts.join(SEP);
};
export const extname = (p) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i).toLowerCase();
};
export const joinPath = (...parts) => parts.filter(Boolean).join(SEP).replace(/[\\/]+/g, SEP);

export function relPath(root, p) {
  if (!root || !p) return p || '';
  const norm = (s) => s.replace(/[\\/]+/g, SEP).replace(/[\\/]$/, '');
  const r = norm(root);
  const f = norm(p);
  return f.toLowerCase().startsWith(r.toLowerCase() + SEP) ? f.slice(r.length + 1) : f;
}

/* ── Timing ───────────────────────────────────────────────────────────── */

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms) {
  let last = 0;
  let pending = null;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!pending) {
      pending = setTimeout(() => {
        pending = null;
        last = performance.now();
        fn(...args);
      }, ms - (now - last));
    }
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A sleep that rejects the moment an AbortSignal fires, so phases stop instantly. */
export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

/* ── Formatting ───────────────────────────────────────────────────────── */

export function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ── Fuzzy matching ───────────────────────────────────────────────────────
   Subsequence match with bonuses for word starts, camel humps, consecutive
   runs, and prefix position. Returns null for a miss so callers can filter
   on truthiness; positions drive the <mark> highlighting in the palette.   */

export function fuzzy(needle, haystack) {
  if (!needle) return { score: 0, positions: [] };
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();

  let score = 0;
  let hi = 0;
  let prevMatch = -2;
  const positions = [];

  for (let i = 0; i < n.length; i++) {
    const ch = n[i];
    const found = h.indexOf(ch, hi);
    if (found === -1) return null;

    let bonus = 1;
    if (found === prevMatch + 1) bonus += 6;                        // consecutive run
    if (found === 0) bonus += 10;                                   // leading char
    else {
      const prev = haystack[found - 1];
      if (/[\s\-_/\\.]/.test(prev)) bonus += 8;                     // word boundary
      else if (prev === prev.toLowerCase() && haystack[found] === haystack[found].toUpperCase()) {
        bonus += 6;                                                 // camelCase hump
      }
    }
    score += bonus;
    positions.push(found);
    prevMatch = found;
    hi = found + 1;
  }

  // Shorter haystacks with the same evidence are better matches.
  score -= Math.min(haystack.length - n.length, 40) * 0.12;
  return { score, positions };
}

/** Render a string with fuzzy-matched characters wrapped in <mark>. */
export function highlight(text, positions) {
  if (!positions?.length) return escapeHtml(text);
  const set = new Set(positions);
  let out = '';
  let open = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit && !open) { out += '<mark>'; open = true; }
    if (!hit && open) { out += '</mark>'; open = false; }
    out += escapeHtml(text[i]);
  }
  return open ? out + '</mark>' : out;
}

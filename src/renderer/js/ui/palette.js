import { bus } from '../core/bus.js';
import { $, el, clear, fuzzy, highlight, basename, dirname, relPath, escapeHtml } from '../core/util.js';
import { getState } from '../core/state.js';
import { pretty } from '../core/keymap.js';
import * as commands from '../core/commands.js';
import * as host from '../editor/host.js';

let overlay = null;
let input = null;
let listEl = null;
let prefixEl = null;
let footEl = null;

let mode = null;        // 'commands' | 'files' | 'line' | 'custom'
let items = [];         // full candidate set
let filtered = [];
let cursor = 0;
let customAccept = null;

export function init() {
  overlay = $('#overlay');
  input = $('#pal-input');
  listEl = $('#pal-list');
  prefixEl = $('#pal-prefix');
  footEl = $('#pal-foot');

  input.addEventListener('input', () => {
    // ">" and ":" switch modes inline, the way VS Code's single box does.
    const v = input.value;
    if (mode === 'files' && v.startsWith('>')) {
      input.value = v.slice(1);
      return openCommands(input.value);
    }
    if (mode === 'commands' && v.startsWith('?')) {
      input.value = v.slice(1);
      return openFiles(input.value);
    }
    refilter();
  });

  input.addEventListener('keydown', onKey);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  bus.on('palette:close', close);
}

/* ── Modes ────────────────────────────────────────────────────────────── */

export function openCommands(initial = '') {
  mode = 'commands';
  prefixEl.textContent = '';
  input.placeholder = 'Type a command…';
  items = commands
    .available()
    .map((c) => ({
      key: `${c.category} ${c.title}`,
      title: c.title,
      sub: null,
      cat: c.category,
      hint: pretty(c.keybinding),
      run: () => commands.run(c.id),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  footHint('↑↓ navigate', '↵ run', 'esc dismiss');
  show(initial);
}

export function openFiles(initial = '') {
  mode = 'files';
  prefixEl.textContent = '';
  input.placeholder = 'Search files by name…';

  const root = getState().workspace?.root;
  const index = getState().fileIndex || [];

  // Currently open files float to the top: they are the likeliest target.
  const openPaths = new Set(getState().files.order);
  items = index.map((f) => ({
    key: f.rel || f.name,
    title: f.name,
    sub: dirname(f.rel || '') || '.',
    cat: null,
    hint: openPaths.has(f.path) ? 'open' : '',
    boost: openPaths.has(f.path) ? 26 : 0,
    run: () => host.openFile(f.path),
  }));

  if (!root) {
    items = getState().files.order.map((p) => ({
      key: basename(p),
      title: basename(p),
      sub: dirname(p),
      hint: 'open',
      run: () => host.activate(p),
    }));
  }

  footHint(`${items.length} files`, '↵ open', 'esc dismiss');
  show(initial);
}

export function openLine() {
  mode = 'line';
  prefixEl.textContent = ':';
  input.placeholder = 'Line number…';
  items = [];
  footHint('Enter a line number', '↵ go');
  show('');
}

/** A generic picker other modules can reuse (used by the Test Studio). */
export function openCustom({ title, placeholder, entries, onAccept }) {
  mode = 'custom';
  prefixEl.textContent = title || '';
  input.placeholder = placeholder || 'Select…';
  customAccept = onAccept;
  items = entries.map((e) => ({
    key: `${e.title} ${e.sub || ''}`,
    title: e.title,
    sub: e.sub,
    hint: e.hint,
    value: e.value,
    run: () => onAccept(e.value),
  }));
  footHint('↑↓ navigate', '↵ select', 'esc dismiss');
  show('');
}

/* ── Plumbing ─────────────────────────────────────────────────────────── */

function show(initial) {
  overlay.hidden = false;
  input.value = initial;
  refilter();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

export function close() {
  if (overlay.hidden) return;
  overlay.hidden = true;
  input.value = '';
  mode = null;
  customAccept = null;
  clear(listEl);
}

export const isOpen = () => overlay && !overlay.hidden;

function footHint(...parts) {
  clear(footEl);
  for (const p of parts) footEl.append(el('span', { text: p }));
}

function refilter() {
  const q = input.value.trim();

  if (mode === 'line') {
    filtered = [];
    clear(listEl);
    const n = parseInt(q, 10);
    const model = host.getEditor()?.getModel();
    const max = model?.getLineCount() || 0;
    listEl.append(
      el('div', {
        class: 'pal-empty',
        text: q ? (n >= 1 && n <= max ? `Go to line ${n} of ${max}` : `Line must be 1–${max}`) : `Current file has ${max} lines`,
      })
    );
    return;
  }

  if (!q) {
    filtered = items.slice(0, 120);
  } else {
    const scored = [];
    for (const it of items) {
      const m = fuzzy(q, it.key);
      if (!m) continue;
      scored.push({ ...it, score: m.score + (it.boost || 0), positions: m.positions });
    }
    scored.sort((a, b) => b.score - a.score);
    filtered = scored.slice(0, 120);
  }

  cursor = 0;
  renderList(q);
}

function renderList(q) {
  clear(listEl);

  if (!filtered.length) {
    listEl.append(el('div', { class: 'pal-empty', text: 'No matching results' }));
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach((it, i) => {
    // Fuzzy positions are indices into `key`; for commands the title is the tail
    // of the key, so shift them onto the title for correct highlighting.
    let titleHtml = escapeHtml(it.title);
    if (q && it.positions) {
      const offset = it.key.length - it.title.length;
      const local = it.positions.map((p) => p - offset).filter((p) => p >= 0 && p < it.title.length);
      if (local.length) titleHtml = highlight(it.title, local);
    }

    const node = el('div', {
      class: `pal-item${i === cursor ? ' sel' : ''}`,
      dataset: { index: String(i) },
      style: { animationDelay: `${Math.min(i, 14) * 10}ms` },
      onclick: () => accept(i),
      onmousemove: () => moveTo(i),
    }, [
      el('div', { class: 'pi-body' }, [
        el('div', { class: 'pi-title', html: titleHtml }),
        it.sub ? el('div', { class: 'pi-sub', text: it.sub }) : null,
      ]),
      it.cat ? el('span', { class: 'pi-cat', text: it.cat }) : null,
      it.hint ? el('span', { class: 'pi-key', text: it.hint }) : null,
    ]);
    frag.append(node);
  });
  listEl.append(frag);
}

function moveTo(i) {
  if (i === cursor) return;
  listEl.querySelector('.pal-item.sel')?.classList.remove('sel');
  cursor = i;
  const node = listEl.querySelector(`.pal-item[data-index="${i}"]`);
  node?.classList.add('sel');
  node?.scrollIntoView({ block: 'nearest' });
}

function onKey(e) {
  e.stopPropagation();

  if (e.key === 'Escape') {
    e.preventDefault();
    return close();
  }

  if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
    e.preventDefault();
    return moveTo(Math.min(cursor + 1, filtered.length - 1));
  }
  if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
    e.preventDefault();
    return moveTo(Math.max(cursor - 1, 0));
  }
  if (e.key === 'PageDown') {
    e.preventDefault();
    return moveTo(Math.min(cursor + 8, filtered.length - 1));
  }
  if (e.key === 'PageUp') {
    e.preventDefault();
    return moveTo(Math.max(cursor - 8, 0));
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (mode === 'line') {
      const n = parseInt(input.value.trim(), 10);
      close();
      if (n >= 1) host.revealLine(n, 1, true);
      return;
    }
    return accept(cursor);
  }
}

function accept(i) {
  const it = filtered[i];
  if (!it) return;
  close();
  // Let the overlay finish closing before the action steals focus.
  requestAnimationFrame(() => it.run());
}

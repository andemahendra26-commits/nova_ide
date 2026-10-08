import { bus } from '../core/bus.js';
import { $, el, svg, clear, basename, dirname, joinPath } from '../core/util.js';
import { getState, setState } from '../core/state.js';
import { badgeFor } from '../editor/languages.js';
import * as host from '../editor/host.js';
import * as ctx from './contextmenu.js';

let treeEl = null;
let selected = null;

/** path -> { expanded, entries, depth, loaded } */
const dirs = new Map();

export function init() {
  treeEl = $('#tree');

  $('#btn-open-folder')?.addEventListener('click', () => bus.emit('command', 'workspace.open'));

  treeEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('.row');
    showMenu(e.clientX, e.clientY, row ? row.dataset.path : getState().workspace?.root, row);
  });

  bus.on('state:workspace', () => { render(); renderActions(); });
  bus.on('file:activated', ({ path }) => highlight(path));
  bus.on('watch:change', onWatchChange);
  bus.on('sidebar:view', renderActions);

  renderActions();
  render();
}

/* ── Header actions ───────────────────────────────────────────────────────
   New file / new folder act on the selected directory when there is one, so
   creating inside a nested folder does not mean navigating to the root first. */

function targetDir() {
  const root = getState().workspace?.root;
  if (!selected) return root;
  const row = treeEl.querySelector(`.row[data-path="${cssEscape(selected)}"]`);
  if (!row) return root;
  return row.dataset.dir === 'true' ? selected : dirname(selected);
}

export function renderActions() {
  const host2 = $('#sb-actions');
  if (!host2) return;
  clear(host2);
  if (getState().ui.sidebarView !== 'explorer') return;

  const ws = getState().workspace;
  const btn = (title, paths, onclick, disabled) =>
    el('button', {
      class: 'icon-btn',
      title,
      onclick,
      style: disabled ? { opacity: '.35', pointerEvents: 'none' } : {},
    }, [svg(paths, 15)]);

  host2.append(
    btn('New File', ['M4 2h5l3 3v9H4z', 'M9 2v3h3'], () => createEntry(targetDir(), false), !ws),
    btn('New Folder', ['M2 3.6h3.6l1.1 1.4H14v7.4H2z', 'M8 7.5v3.6M6.2 9.3h3.6'], () => createEntry(targetDir(), true), !ws),
    btn('Refresh Explorer', ['M13.3 7.2a5.3 5.3 0 10-.6 3.4', 'M13.6 3.6v3.6h-3.6'], () => render(), !ws),
    btn('Collapse Folders', ['M3 5.5h10M3 8h10M3 10.5h10'], () => collapseAll(), !ws)
  );
}

/** Collapse every expanded directory back to the root. */
export function collapseAll() {
  for (const [dirPath, state] of dirs) {
    if (!state.expanded || dirPath === getState().workspace?.root) continue;
    state.expanded = false;
    dirs.set(dirPath, state);
    treeEl.querySelector(`.row[data-path="${cssEscape(dirPath)}"]`)?.classList.remove('open');
    const kids = treeEl.querySelector(`.kids[data-parent="${cssEscape(dirPath)}"]`);
    if (kids) kids.hidden = true;
  }
}

/* ── Rendering ────────────────────────────────────────────────────────── */

let renderToken = 0;

export async function render() {
  // openWorkspace triggers render twice (state change + explicit await). Without
  // a generation token a slow first pass can append on top of the second.
  const token = ++renderToken;
  const ws = getState().workspace;
  clear(treeEl);
  dirs.clear();

  const wsBar = $('#ws-bar');
  clear(wsBar);

  if (!ws) {
    wsBar.append(
      el('button', {
        class: 'ws-open',
        id: 'btn-open-folder',
        text: 'Open Folder',
        onclick: () => bus.emit('command', 'workspace.open'),
      })
    );
    treeEl.append(
      el('div', {
        class: 'tree-empty',
        html: 'No folder open.<br><br>Open a folder to start editing, or ask the agent to create something new.',
      })
    );
    return;
  }

  wsBar.append(
    el('div', { class: 'ws-name' }, [
      svg('M2 3.2h4.2l1.3 1.6H14v7.9H2z', 13),
      el('span', { text: ws.name }),
    ])
  );

  dirs.set(ws.root, { expanded: true, depth: -1, loaded: false });
  await expand(ws.root, treeEl, 0, token);
}

async function expand(dirPath, container, depth, token = null) {
  let entries;
  try {
    const res = await window.nova.fs.readDir(dirPath);
    entries = res.entries;
  } catch (err) {
    bus.emit('notify', { type: 'error', title: 'Cannot read folder', message: err.message });
    return;
  }

  const state = dirs.get(dirPath) || {};
  dirs.set(dirPath, { ...state, expanded: true, entries, depth, loaded: true });

  // Batch into a fragment: one reflow instead of one per row (TRD §8).
  const frag = document.createDocumentFragment();
  entries.forEach((entry, i) => {
    const row = makeRow(entry, depth);
    // CSS-only cascade — the delay is data, the animation is declarative.
    row.style.animationDelay = `${Math.min(i, 24) * 14}ms`;
    row.classList.add('reveal');
    frag.append(row);
    if (entry.isDirectory) {
      const kids = el('div', { class: 'kids', dataset: { parent: entry.path } });
      kids.hidden = true;
      frag.append(kids);
    }
  });
  // A superseded render must not paint into the tree the new one is building.
  if (token === null || token === renderToken) container.append(frag);
}

function makeRow(entry, depth) {
  const isDir = entry.isDirectory;
  const badge = isDir ? null : badgeFor(entry.path);

  const row = el('div', {
    class: `row ${isDir ? 'dir' : 'file'}`,
    dataset: { path: entry.path, dir: String(isDir), depth: String(depth) },
    style: { paddingLeft: `${8 + depth * 13}px` },
    title: entry.path,
  }, [
    el('span', { class: `twisty${isDir ? '' : ' leaf'}` }, [svg('M6 3.5L10.5 8 6 12.5', 11, { width: 1.5 })]),
    isDir
      ? el('span', { class: 'ficon', style: { color: 'var(--fg-muted)' } }, [
          svg('M2 3.6h3.6l1.1 1.4H14v7.4H2z', 13, { width: 1.3 }),
        ])
      : el('span', { class: 'ficon', style: { color: badge.color }, text: badge.text }),
    el('span', { class: 'fname', text: entry.name }),
  ]);

  row.addEventListener('click', () => (isDir ? toggle(entry.path) : openIt(entry.path)));
  return row;
}

async function toggle(dirPath) {
  const row = treeEl.querySelector(`.row[data-path="${cssEscape(dirPath)}"]`);
  const kids = treeEl.querySelector(`.kids[data-parent="${cssEscape(dirPath)}"]`);
  if (!row || !kids) return;

  select(dirPath);
  const state = dirs.get(dirPath) || {};

  if (state.expanded) {
    state.expanded = false;
    dirs.set(dirPath, state);
    row.classList.remove('open');
    kids.hidden = true;
    return;
  }

  row.classList.add('open');
  kids.hidden = false;
  if (!state.loaded) {
    const depth = Number(row.dataset.depth) + 1;
    await expand(dirPath, kids, depth);
  } else {
    dirs.set(dirPath, { ...state, expanded: true });
    // Re-run the cascade so a re-open reads as deliberate rather than instant.
    [...kids.children].forEach((child, i) => {
      if (!child.classList.contains('row')) return;
      child.style.animationDelay = `${Math.min(i, 24) * 14}ms`;
      child.classList.remove('reveal');
      void child.offsetWidth; // force reflow so the animation restarts
      child.classList.add('reveal');
    });
  }
}

async function openIt(path) {
  select(path);
  await host.openFile(path);
}

function select(path) {
  selected = path;
  treeEl.querySelectorAll('.row.selected').forEach((r) => r.classList.remove('selected'));
  treeEl.querySelector(`.row[data-path="${cssEscape(path)}"]`)?.classList.add('selected');
}

function highlight(path) {
  selected = path;
  treeEl.querySelectorAll('.row.selected').forEach((r) => r.classList.remove('selected'));
  const row = treeEl.querySelector(`.row[data-path="${cssEscape(path)}"]`);
  if (row) {
    row.classList.add('selected');
    row.scrollIntoView({ block: 'nearest' });
  }
}

const cssEscape = (s) => String(s).replace(/["\\]/g, '\\$&');

/* ── Reveal a path, expanding ancestors as needed (FE-5) ──────────────── */

export async function reveal(path) {
  const root = getState().workspace?.root;
  if (!root || !path.toLowerCase().startsWith(root.toLowerCase())) return;

  const rel = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  let cur = root;
  for (let i = 0; i < rel.length - 1; i++) {
    cur = joinPath(cur, rel[i]);
    const state = dirs.get(cur);
    if (!state?.expanded) await toggle(cur);
  }
  highlight(path);
}

/* ── Context menu + file operations ───────────────────────────────────── */

function showMenu(x, y, path, row) {
  const ws = getState().workspace;
  if (!ws) return;

  const isDir = row ? row.dataset.dir === 'true' : true;
  const targetDir = isDir ? path : dirname(path);

  ctx.show(x, y, [
    !isDir && { label: 'Open', run: () => openIt(path) },
    { label: 'New File…', run: () => createEntry(targetDir, false) },
    { label: 'New Folder…', run: () => createEntry(targetDir, true) },
    '-',
    row && { label: 'Rename…', run: () => renameEntry(path) },
    row && { label: 'Delete', danger: true, run: () => deleteEntry(path) },
    '-',
    { label: 'Copy Path', run: () => navigator.clipboard.writeText(path) },
    { label: 'Reveal in File Explorer', run: () => window.nova.fs.reveal(path) },
    '-',
    { label: 'Refresh', run: () => render() },
  ].filter(Boolean));
}

/** Inline entry creation — an input row in the tree, not a modal. */
async function createEntry(dirPath, isDir) {
  const state = dirs.get(dirPath);
  if (dirPath !== getState().workspace.root && !state?.expanded) await toggle(dirPath);

  const container =
    dirPath === getState().workspace.root
      ? treeEl
      : treeEl.querySelector(`.kids[data-parent="${cssEscape(dirPath)}"]`);
  if (!container) return;

  const depth = dirPath === getState().workspace.root ? 0 : Number(dirs.get(dirPath)?.depth ?? 0) + 1;

  const input = el('input', { class: 'tree-rename', spellcheck: 'false' });
  const row = el('div', {
    class: 'row',
    style: { paddingLeft: `${8 + depth * 13}px` },
  }, [
    el('span', { class: 'twisty leaf' }),
    el('span', { class: 'ficon' }, [svg(isDir ? 'M2 3.6h3.6l1.1 1.4H14v7.4H2z' : 'M4 2h5l3 3v9H4z', 13, { width: 1.3 })]),
    input,
  ]);
  container.prepend(row);
  input.focus();

  const finish = async (commit) => {
    const name = input.value.trim();
    row.remove();
    if (!commit || !name) return;
    const target = joinPath(dirPath, name);
    try {
      if (isDir) await window.nova.fs.createDir(target);
      else await window.nova.fs.createFile(target);
      await render();
      if (!isDir) await openIt(target);
      else await reveal(target);
    } catch (err) {
      bus.emit('notify', { type: 'error', title: 'Create failed', message: err.message });
    }
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function renameEntry(path) {
  const row = treeEl.querySelector(`.row[data-path="${cssEscape(path)}"]`);
  if (!row) return;
  const nameEl = row.querySelector('.fname');
  const original = nameEl.textContent;

  const input = el('input', { class: 'tree-rename', spellcheck: 'false' });
  input.value = original;
  nameEl.replaceWith(input);
  input.focus();

  // Preselect the stem, leaving the extension alone — that is what is usually being changed.
  const dot = original.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : original.length);

  const finish = async (commit) => {
    const name = input.value.trim();
    input.replaceWith(nameEl);
    if (!commit || !name || name === original) return;
    try {
      await window.nova.fs.rename(path, joinPath(dirname(path), name));
      await render();
    } catch (err) {
      bus.emit('notify', { type: 'error', title: 'Rename failed', message: err.message });
    }
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function deleteEntry(path) {
  const { confirmed } = await window.nova.dialog.confirm({
    message: `Delete ${basename(path)}?`,
    detail: 'It will be moved to the Recycle Bin.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await window.nova.fs.delete(path);
    if (getState().files.open.has(path)) await host.closeFile(path, { force: true });
    await render();
    bus.emit('notify', { type: 'success', title: 'Deleted', message: basename(path) });
  } catch (err) {
    bus.emit('notify', { type: 'error', title: 'Delete failed', message: err.message });
  }
}

/* ── External changes (FE-6) ──────────────────────────────────────────── */

let refreshTimer = null;
function onWatchChange({ changes }) {
  const structural = changes.some((c) => c.type !== 'change');
  if (!structural) return;
  // The watcher is already debounced; this second stage collapses bursts from
  // operations like npm install that touch thousands of paths.
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => render().then(() => selected && highlight(selected)), 400);
}

export const getSelected = () => selected;

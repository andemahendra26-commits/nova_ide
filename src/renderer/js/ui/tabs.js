import { bus } from '../core/bus.js';
import { $, el, svg, clear, relPath } from '../core/util.js';
import { getState, setState } from '../core/state.js';
import { badgeFor } from '../editor/languages.js';
import * as host from '../editor/host.js';
import * as ctx from './contextmenu.js';
import * as commands from '../core/commands.js';

let tabsEl = null;
let crumbsEl = null;
let dragPath = null;

export function init() {
  tabsEl = $('#tabs');
  crumbsEl = $('#breadcrumbs');

  const actions = $('#tabbar-actions');
  clear(actions);
  actions.append(
    iconBtn('Split Editor', ['M2 3h12v10H2z', 'M8 3v10'], () => commands.run('view.split')),
    iconBtn('Toggle Terminal', ['M3 4.5l3.2 3.2L3 10.9', 'M8.6 11.2h4.6'], () => commands.run('terminal.toggle')),
    iconBtn('More', ['M4 8h.01M8 8h.01M12 8h.01'], (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      ctx.show(r.right - 190, r.bottom + 4, [
        { label: 'Close All Editors', command: 'file.closeAll' },
        { label: 'Save All', command: 'file.saveAll' },
        '-',
        { label: 'Zen Mode', command: 'view.zen' },
      ]);
    })
  );

  bus.on('file:opened', render);
  bus.on('file:closed', render);
  bus.on('file:activated', render);
  bus.on('file:none', render);
  bus.on('file:dirty', onDirty);
  bus.on('file:saved', onSaved);

  render();
}

function iconBtn(title, paths, onclick) {
  return el('button', { class: 'icon-btn', title, onclick }, [svg(paths, 15)]);
}

function render() {
  const s = getState();
  clear(tabsEl);

  for (const path of s.files.order) {
    const file = s.files.open.get(path);
    if (!file) continue;
    tabsEl.append(makeTab(file, path === s.files.active));
  }

  const active = s.files.active ? s.files.open.get(s.files.active) : null;
  renderCrumbs(active);

  $('#welcome').hidden = !!active;
  $('#editor-host').classList.toggle('hidden', !active);

  const activeTab = tabsEl.querySelector('.tab.active');
  activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function makeTab(file, isActive) {
  const badge = badgeFor(file.path);

  const tab = el('div', {
    class: `tab${isActive ? ' active' : ''}${file.dirty ? ' dirty' : ''}`,
    dataset: { path: file.path },
    title: file.path,
    draggable: 'true',
  }, [
    el('span', { class: 'ficon', style: { color: badge.color }, text: badge.text }),
    el('span', { class: 'tname', text: file.name }),
    el('button', {
      class: 'tclose',
      title: 'Close',
      onclick: (e) => {
        e.stopPropagation();
        host.closeFile(file.path);
      },
    }, [svg('M3.5 3.5l7 7M10.5 3.5l-7 7', 10)]),
  ]);

  tab.addEventListener('click', () => host.activate(file.path));

  tab.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      host.closeFile(file.path);
    }
  });

  tab.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ctx.show(e.clientX, e.clientY, [
      { label: 'Close', run: () => host.closeFile(file.path) },
      { label: 'Close Others', run: () => host.closeOthers(file.path) },
      { label: 'Close All', command: 'file.closeAll' },
      '-',
      { label: 'Save', run: () => host.saveFile(file.path) },
      { label: 'Save As…', run: () => host.saveAs(file.path) },
      '-',
      { label: 'Copy Path', run: () => navigator.clipboard.writeText(file.path) },
      { label: 'Reveal in File Explorer', run: () => window.nova.fs.reveal(file.path) },
    ]);
  });

  /* Reorder by drag (ED-2). */
  tab.addEventListener('dragstart', (e) => {
    dragPath = file.path;
    tab.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', file.path);
  });
  tab.addEventListener('dragend', () => {
    dragPath = null;
    tabsEl.querySelectorAll('.tab').forEach((t) =>
      t.classList.remove('dragging', 'drop-before', 'drop-after')
    );
  });
  tab.addEventListener('dragover', (e) => {
    if (!dragPath || dragPath === file.path) return;
    e.preventDefault();
    const r = tab.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    tab.classList.toggle('drop-before', !after);
    tab.classList.toggle('drop-after', after);
  });
  tab.addEventListener('dragleave', () => tab.classList.remove('drop-before', 'drop-after'));
  tab.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragPath || dragPath === file.path) return;
    const r = tab.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    reorder(dragPath, file.path, after);
  });

  return tab;
}

function reorder(from, to, after) {
  const order = [...getState().files.order];
  const fromIdx = order.indexOf(from);
  if (fromIdx === -1) return;
  order.splice(fromIdx, 1);
  let toIdx = order.indexOf(to);
  if (toIdx === -1) return;
  order.splice(after ? toIdx + 1 : toIdx, 0, from);
  setState({ files: { ...getState().files, order } });
  render();
}

function onDirty({ path, dirty }) {
  tabsEl
    .querySelector(`.tab[data-path="${String(path).replace(/["\\]/g, '\\$&')}"]`)
    ?.classList.toggle('dirty', dirty);
}

function onSaved({ path }) {
  const tab = tabsEl.querySelector(`.tab[data-path="${String(path).replace(/["\\]/g, '\\$&')}"]`);
  if (!tab) return;
  tab.classList.add('saved-flash');
  setTimeout(() => tab.classList.remove('saved-flash'), 900);
}

function renderCrumbs(file) {
  clear(crumbsEl);
  if (!file) return;

  const root = getState().workspace?.root;
  const rel = root ? relPath(root, file.path) : file.path;
  const parts = rel.split(/[\\/]/).filter(Boolean);

  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    crumbsEl.append(
      el('span', {
        class: `crumb${last ? ' last' : ''}`,
        text: part,
        onclick: last ? null : () => bus.emit('crumb:click', { index: i, parts }),
      })
    );
    if (!last) {
      crumbsEl.append(el('span', { class: 'crumb-sep' }, [svg('M6 3.5L10.5 8 6 12.5', 11, { width: 1.2 })]));
    }
  });
}

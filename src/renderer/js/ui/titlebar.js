import { bus } from '../core/bus.js';
import { $, el, clear } from '../core/util.js';
import { getState } from '../core/state.js';
import * as commands from '../core/commands.js';
import * as ctx from './contextmenu.js';

const MENUS = [
  {
    label: 'File',
    items: [
      { label: 'New File', command: 'file.new' },
      { label: 'Open File…', command: 'file.open' },
      { label: 'Open Folder…', command: 'workspace.open' },
      '-',
      { label: 'Save', command: 'file.save' },
      { label: 'Save As…', command: 'file.saveAs' },
      { label: 'Save All', command: 'file.saveAll' },
      '-',
      { label: 'Close Editor', command: 'file.close' },
      { label: 'Close All Editors', command: 'file.closeAll' },
      '-',
      { label: 'Exit', command: 'app.quit' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', key: 'Ctrl+Z', run: () => document.execCommand('undo') },
      { label: 'Redo', key: 'Ctrl+Y', run: () => document.execCommand('redo') },
      '-',
      { label: 'Find', command: 'edit.find' },
      { label: 'Replace', command: 'edit.replace' },
      { label: 'Find in Files', command: 'search.openView' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Command Palette…', command: 'palette.open' },
      { label: 'Quick Open…', command: 'quickopen.open' },
      '-',
      { label: 'Explorer', command: 'view.explorer' },
      { label: 'Search', command: 'view.search' },
      { label: 'Test Studio', command: 'view.tests' },
      { label: 'Settings', command: 'view.settings' },
      '-',
      { label: 'Toggle Sidebar', command: 'view.toggleSidebar' },
      { label: 'Toggle Agent Panel', command: 'view.toggleAgent' },
      { label: 'Toggle Terminal', command: 'terminal.toggle' },
      { label: 'Zen Mode', command: 'view.zen' },
      '-',
      { label: 'Zoom In', command: 'view.zoomIn' },
      { label: 'Zoom Out', command: 'view.zoomOut' },
      { label: 'Toggle Word Wrap', command: 'view.wordWrap' },
    ],
  },
  {
    label: 'Agent',
    items: [
      { label: 'Focus Agent Input', command: 'agent.focus' },
      { label: 'Stop Agent', command: 'agent.stop' },
      { label: 'Clear Conversation', command: 'agent.clear' },
      '-',
      { label: 'Agent Settings', command: 'view.settings' },
    ],
  },
  {
    label: 'Terminal',
    items: [
      { label: 'New Terminal', command: 'terminal.new' },
      { label: 'Toggle Terminal', command: 'terminal.toggle' },
      { label: 'Kill Terminal', command: 'terminal.kill' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Welcome', command: 'help.welcome' },
      { label: 'Keyboard Shortcuts', command: 'help.shortcuts' },
      { label: 'About Nova IDE', command: 'help.about' },
    ],
  },
];

let openMenuEl = null;

export function init() {
  const menuHost = $('#tb-menu');
  clear(menuHost);

  for (const menu of MENUS) {
    const item = el('button', { class: 'tb-menu-item', text: menu.label });

    const openIt = () => {
      const r = item.getBoundingClientRect();
      markOpen(item);
      ctx.show(r.left, r.bottom + 2, menu.items);
    };

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openMenuEl === item && ctx.isOpen()) {
        ctx.close();
        markOpen(null);
      } else {
        openIt();
      }
    });

    // Once one menu is open, hovering the next switches to it — standard menu-bar behaviour.
    item.addEventListener('mouseenter', () => {
      if (ctx.isOpen() && openMenuEl && openMenuEl !== item) openIt();
    });

    menuHost.append(item);
  }

  window.addEventListener('mousedown', () => {
    if (!ctx.isOpen()) markOpen(null);
  });

  $('#win-min').addEventListener('click', () => window.nova.window.minimize());
  $('#win-max').addEventListener('click', () => window.nova.window.maximize());
  $('#win-close').addEventListener('click', () => commands.run('app.quit'));

  // Double-clicking the drag region maximizes, as on a native title bar.
  $('#titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('.tb-btn, .tb-menu-item')) return;
    window.nova.window.maximize();
  });

  window.nova.window.onState(({ maximized }) => {
    $('#win-max').title = maximized ? 'Restore' : 'Maximize';
  });

  bus.on('file:activated', updateTitle);
  bus.on('file:dirty', updateTitle);
  bus.on('file:none', updateTitle);
  bus.on('file:closed', updateTitle);
  bus.on('state:workspace', updateTitle);
  updateTitle();
}

function markOpen(item) {
  document.querySelectorAll('.tb-menu-item.open').forEach((n) => n.classList.remove('open'));
  openMenuEl = item;
  if (item) item.classList.add('open');
}

function updateTitle() {
  const el2 = $('#tb-title');
  if (!el2) return;
  const s = getState();
  const active = s.files.active;
  const file = active ? s.files.open.get(active) : null;
  const ws = s.workspace?.name;

  clear(el2);
  if (file) {
    if (file.dirty) el2.append(el('span', { class: 'dirty-dot' }));
    el2.append(document.createTextNode(`${file.name}${ws ? ` — ${ws}` : ''} — Nova IDE`));
  } else {
    el2.append(document.createTextNode(ws ? `${ws} — Nova IDE` : 'Nova IDE'));
  }
  document.title = el2.textContent;
}

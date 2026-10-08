import { bus } from '../core/bus.js';
import { $, el, svg, clear } from '../core/util.js';
import { getState, setState } from '../core/state.js';
import * as commands from '../core/commands.js';
import { pretty } from '../core/keymap.js';

const VIEWS = [
  {
    id: 'explorer',
    title: 'Explorer',
    command: 'view.explorer',
    icon: ['M2 3.2h4.2l1.3 1.6H14v7.9H2z'],
  },
  {
    id: 'search',
    title: 'Search',
    command: 'view.search',
    icon: ['M7.2 11.4a4.2 4.2 0 100-8.4 4.2 4.2 0 000 8.4z', 'M10.3 10.3L13.6 13.6'],
  },
  {
    id: 'tests',
    title: 'Test Studio',
    command: 'view.tests',
    icon: ['M6 1.8v3.6L2.6 12a1.6 1.6 0 001.4 2.4h8a1.6 1.6 0 001.4-2.4L10 5.4V1.8', 'M5.2 1.8h5.6'],
  },
  {
    id: 'settings',
    title: 'Settings',
    command: 'view.settings',
    icon: [
      'M8 10.1a2.1 2.1 0 100-4.2 2.1 2.1 0 000 4.2z',
      'M12.9 10a1.1 1.1 0 00.22 1.21l.04.04a1.33 1.33 0 11-1.88 1.88l-.04-.04a1.1 1.1 0 00-1.21-.22 1.1 1.1 0 00-.67 1v.11a1.33 1.33 0 11-2.66 0v-.06a1.1 1.1 0 00-.72-1 1.1 1.1 0 00-1.21.22l-.04.04a1.33 1.33 0 11-1.88-1.88l.04-.04a1.1 1.1 0 00.22-1.21 1.1 1.1 0 00-1-.67h-.11a1.33 1.33 0 010-2.66h.06a1.1 1.1 0 001-.72 1.1 1.1 0 00-.22-1.21l-.04-.04a1.33 1.33 0 111.88-1.88l.04.04a1.1 1.1 0 001.21.22h.05a1.1 1.1 0 00.67-1v-.11a1.33 1.33 0 112.66 0v.06a1.1 1.1 0 00.67 1 1.1 1.1 0 001.21-.22l.04-.04a1.33 1.33 0 111.88 1.88l-.04.04a1.1 1.1 0 00-.22 1.21v.05a1.1 1.1 0 001 .67h.11a1.33 1.33 0 010 2.66h-.06a1.1 1.1 0 00-1 .67z',
    ],
  },
];

const BOTTOM = [
  {
    id: 'agent',
    title: 'Toggle Agent Panel',
    command: 'view.toggleAgent',
    icon: [
      'M8 1.5l1.5 4.3 4.3 1.5-4.3 1.5L8 13.1 6.5 8.8 2.2 7.3l4.3-1.5z',
    ],
  },
  {
    id: 'terminal',
    title: 'Toggle Terminal',
    command: 'terminal.toggle',
    icon: ['M3 4.5l3.2 3.2L3 10.9', 'M8.6 11.2h4.6'],
  },
];

export function init() {
  const top = $('#ab-top');
  const bottom = $('#ab-bottom');
  clear(top);
  clear(bottom);

  for (const v of VIEWS) top.append(makeItem(v));
  for (const v of BOTTOM) bottom.append(makeItem(v));

  bus.on('state:ui', render);
  bus.on('search:count', ({ matches }) => setBadge('search', matches));
  bus.on('agent:status', ({ status }) => {
    const node = $('.ab-item[data-id="agent"]');
    if (node) node.classList.toggle('active', status === 'running');
  });

  render();
}

function makeItem(v) {
  const node = el('button', {
    class: 'ab-item',
    dataset: { id: v.id },
    title: `${v.title}${pretty(commands.keyFor(v.command)) ? ` (${pretty(commands.keyFor(v.command))})` : ''}`,
    onclick: () => commands.run(v.command),
  }, [svg(v.icon, 19, { width: 1.35 })]);
  return node;
}

function setBadge(id, count) {
  const node = $(`.ab-item[data-id="${id}"]`);
  if (!node) return;
  node.querySelector('.ab-badge')?.remove();
  if (count > 0) {
    node.append(el('span', { class: 'ab-badge', text: count > 999 ? '999+' : String(count) }));
  }
}

function render() {
  const ui = getState().ui;
  for (const v of VIEWS) {
    const node = $(`.ab-item[data-id="${v.id}"]`);
    if (node) node.classList.toggle('active', ui.sidebarOpen && ui.sidebarView === v.id);
  }
  $('.ab-item[data-id="terminal"]')?.classList.toggle('active', ui.panelOpen);
}

/** Switch the sidebar view, or collapse it when the active view is clicked again. */
export function selectView(id) {
  const ui = getState().ui;
  if (ui.sidebarOpen && ui.sidebarView === id) {
    setState({ ui: { sidebarOpen: false } });
  } else {
    setState({ ui: { sidebarView: id, sidebarOpen: true } });
  }
  bus.emit('sidebar:view', { view: getState().ui.sidebarView });
}

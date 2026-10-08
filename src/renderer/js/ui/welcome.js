import { bus } from '../core/bus.js';
import { $, el, svg, clear, basename } from '../core/util.js';
import { getSettings } from '../core/settings.js';
import { pretty } from '../core/keymap.js';
import * as commands from '../core/commands.js';

let viewEl = null;

export function init() {
  viewEl = $('#welcome');
  render();
  bus.on('settings:change', ({ patch }) => {
    if ('recentFolders' in patch) render();
  });
  bus.on('state:workspace', render);
}

export function render() {
  if (!viewEl) return;
  clear(viewEl);

  const recents = getSettings().recentFolders || [];

  const actions = [
    { label: 'New File', cmd: 'file.new', icon: 'M4 2h5l3 3v9H4z' },
    { label: 'Open File…', cmd: 'file.open', icon: ['M2 3.2h4.2l1.3 1.6H14v7.9H2z'] },
    { label: 'Open Folder…', cmd: 'workspace.open', icon: ['M2 3.2h4.2l1.3 1.6H14v7.9H2z'] },
    { label: 'Command Palette', cmd: 'palette.open', icon: ['M3 5h10M3 8h10M3 11h6'] },
    { label: 'New Terminal', cmd: 'terminal.new', icon: ['M3 4.5l3.2 3.2L3 10.9', 'M8.6 11.2h4.6'] },
    { label: 'Test Studio', cmd: 'view.tests', icon: ['M3.5 8.5l3 3 6-6'] },
  ];

  const left = el('div', { class: 'wc-col' }, [
    el('h4', { text: 'Start' }),
    ...actions.map((a, i) => {
      const node = el('div', {
        class: 'wc-link',
        onclick: () => commands.run(a.cmd),
      }, [
        svg(a.icon, 15),
        el('span', { text: a.label }),
        el('span', { class: 'wc-key', text: pretty(commands.keyFor(a.cmd)) || '' }),
      ]);
      node.style.animationDelay = `${120 + i * 45}ms`;
      return node;
    }),
  ]);

  const right = el('div', { class: 'wc-col' }, [
    el('h4', { text: 'Recent' }),
    ...(recents.length
      ? recents.slice(0, 7).map((folder, i) => {
          const node = el('div', {
            class: 'wc-recent',
            title: folder,
            onclick: () => bus.emit('workspace:openPath', { path: folder }),
          }, [
            el('div', { class: 'wr-name', text: basename(folder) }),
            el('div', { class: 'wr-path', text: folder }),
          ]);
          node.style.animationDelay = `${160 + i * 45}ms`;
          return node;
        })
      : [el('div', { class: 'wc-empty', text: 'No recent folders yet.' })]),
  ]);

  const hero = el('div', { class: 'wc-hero' }, [
    el('div', { class: 'wc-mark', html: markSvg(56) }),
    el('div', {}, [
      el('div', { class: 'wc-title', html: 'Nova <span>IDE</span>' }),
      el('div', { class: 'wc-sub', text: 'A code editor that shows its work.' }),
    ]),
  ]);

  const tip = el('div', { class: 'wc-tip' }, [
    svg(['M8 1.5l1.5 4.3 4.3 1.5-4.3 1.5L8 13.1 6.5 8.8 2.2 7.3l4.3-1.5z'], 14),
    el('span', {
      html: 'Ask the agent on the right to build something — try <b>"create a React pricing card component"</b> and watch it think.',
    }),
  ]);

  viewEl.append(el('div', { class: 'wc-inner' }, [hero, el('div', { class: 'wc-cols' }, [left, right]), tip]));
}

/** The Nova mark: a radiant burst. Shared by the welcome hero and the app icon. */
export function markSvg(size = 56) {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none">
    <defs>
      <linearGradient id="novaGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="var(--accent)"/>
        <stop offset="100%" stop-color="var(--accent-2)"/>
      </linearGradient>
    </defs>
    <path d="M32 4 L37.6 24.2 L58 32 L37.6 39.8 L32 60 L26.4 39.8 L6 32 L26.4 24.2 Z"
          fill="url(#novaGrad)" opacity="0.92"/>
    <path d="M32 16 L34.6 28.4 L47 32 L34.6 35.6 L32 48 L29.4 35.6 L17 32 L29.4 28.4 Z"
          fill="var(--bg-base)" opacity="0.55"/>
  </svg>`;
}

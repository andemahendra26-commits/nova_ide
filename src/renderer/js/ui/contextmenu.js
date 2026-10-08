import { $, el, clear } from '../core/util.js';
import { pretty } from '../core/keymap.js';
import * as commands from '../core/commands.js';

let host = null;
let open = false;

export function init() {
  host = $('#ctxmenu');
  window.addEventListener('mousedown', (e) => {
    if (open && !host.contains(e.target)) close();
  });
  window.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
}

/**
 * items: [{ label, run?, command?, arg?, key?, danger?, disabled? } | 'separator']
 */
export function show(x, y, items) {
  if (!host) return;
  clear(host);

  for (const item of items) {
    if (item === 'separator' || item === '-') {
      host.append(el('div', { class: 'ctx-sep' }));
      continue;
    }
    if (!item || item.hidden) continue;

    const key = item.key || (item.command ? pretty(commands.keyFor(item.command)) : '');
    const node = el(
      'div',
      {
        class: `ctx-item${item.danger ? ' danger' : ''}`,
        style: item.disabled ? { opacity: '.4', pointerEvents: 'none' } : {},
        onclick: () => {
          close();
          if (item.run) item.run();
          else if (item.command) commands.run(item.command, item.arg);
        },
      },
      [el('span', { text: item.label }), key && el('span', { class: 'ctx-key', text: key })]
    );
    host.append(node);
  }

  // Place it, then nudge back inside the viewport if it would overflow.
  host.hidden = false;
  host.style.left = '0px';
  host.style.top = '0px';
  const rect = host.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  host.style.left = `${Math.max(4, left)}px`;
  host.style.top = `${Math.max(4, top)}px`;
  open = true;
}

export function close() {
  if (!host || !open) return;
  host.hidden = true;
  open = false;
}

export const isOpen = () => open;

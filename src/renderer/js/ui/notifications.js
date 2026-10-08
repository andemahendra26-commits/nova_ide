import { bus } from '../core/bus.js';
import { $, el, svg } from '../core/util.js';

const ICONS = {
  info: 'M8 5.5v.01M8 7.5v3',
  success: 'M3.5 8.5l3 3 6-6',
  warn: 'M8 5.5v3.2M8 11v.01M8 1.8L14.8 13.5H1.2z',
  error: 'M5 5l6 6M11 5l-6 6',
};

let host = null;
let inited = false;
const live = new Set();
// Repeat-collapse: an error that fires in a loop must not bury the interface.
const recent = new Map(); // signature -> { toast, count, at }
const DEDUPE_MS = 4000;

export function init() {
  // The boot failure path calls init() again; re-registering would double every
  // toast from then on.
  if (inited) return;
  inited = true;
  host = $('#toasts');
  bus.on('notify', show);

  // Errors that escape a handler should surface, not vanish into the console.
  window.addEventListener('error', (e) => {
    show({ type: 'error', title: 'Unexpected error', message: e.message, timeout: 9000 });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || String(e.reason);
    show({ type: 'error', title: 'Unhandled error', message: msg, timeout: 9000 });
  });
}

export function show({ type = 'info', title, message, timeout, action }) {
  if (!host) return;

  // Collapse an identical notification into a counted badge instead of stacking.
  const signature = `${type}|${title}|${message}`;
  const prior = recent.get(signature);
  if (prior && live.has(prior.toast) && Date.now() - prior.at < DEDUPE_MS) {
    prior.count++;
    prior.at = Date.now();
    let badge = prior.toast.querySelector('.t-count');
    if (!badge) {
      badge = el('span', { class: 't-count' });
      prior.toast.querySelector('.t-title')?.append(badge);
    }
    badge.textContent = ` ×${prior.count}`;
    return prior.toast;
  }

  const toast = el('div', { class: `toast ${type}` }, [
    el('span', { class: 't-icon' }, [
      svg(ICONS[type] || ICONS.info, 15, type === 'warn' ? { width: 1.3 } : {}),
    ]),
    el('div', { class: 't-body' }, [
      title && el('div', { class: 't-title', text: title }),
      message && el('div', { class: 't-msg', text: message }),
      action &&
        el('button', {
          class: 'wc-link',
          style: { padding: '4px 0', margin: '4px 0 0', fontSize: '11.5px' },
          text: action.label,
          onclick: () => {
            action.run();
            dismiss(toast);
          },
        }),
    ]),
    el('button', {
      class: 't-close',
      title: 'Dismiss',
      onclick: () => dismiss(toast),
    }, [svg('M3 3l10 10M13 3L3 13', 11)]),
  ]);

  host.append(toast);
  live.add(toast);
  recent.set(signature, { toast, count: 1, at: Date.now() });

  // Errors persist until dismissed (NT-2); everything else fades on its own.
  const ms = timeout ?? (type === 'error' ? 0 : 3200);
  if (ms > 0) setTimeout(() => dismiss(toast), ms);

  // Cap the stack so a burst of events cannot cover the window.
  if (live.size > 5) dismiss([...live][0]);

  return toast;
}

function dismiss(toast) {
  if (!toast || !live.has(toast)) return;
  live.delete(toast);
  toast.classList.add('leaving');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  setTimeout(() => toast.remove(), 600); // belt and braces if the animation is disabled
}

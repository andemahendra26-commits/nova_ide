import { bus } from '../core/bus.js';
import { $, el, svg, clear } from '../core/util.js';
import { getState, setState } from '../core/state.js';
import { getSettings } from '../core/settings.js';

/**
 * Terminal surface.
 *
 * The bridge is pipe-based, not a PTY (TRD §3.4), so line editing happens here:
 * we echo keystrokes locally, maintain history, and send whole command lines.
 * That keeps arrow keys, backspace, and history working without a native module.
 */

const XTERM_THEMES = {
  'claude-dark': {
    background: '#0a0a09', foreground: '#e6ded6', cursor: '#d97757', cursorAccent: '#0a0a09',
    selectionBackground: '#d9775740', black: '#0a0a09', red: '#e06c5a', green: '#7fb069',
    yellow: '#e0a458', blue: '#d4a843', magenta: '#d98e73', cyan: '#e8b98a', white: '#e6ded6',
    brightBlack: '#6b6058', brightRed: '#ef8a79', brightGreen: '#9cc888', brightYellow: '#f0a868',
    brightBlue: '#dcb85c', brightMagenta: '#e8a68c', brightCyan: '#f2cfa8', brightWhite: '#faf6f2',
  },
  'nova-dark': {
    background: '#0a0d15', foreground: '#d6dcea', cursor: '#22d3ee', cursorAccent: '#0a0d15',
    selectionBackground: '#22d3ee40', black: '#0a0d15', red: '#f87171', green: '#34d399',
    yellow: '#fbbf24', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d6dcea',
    brightBlack: '#5b6479', brightRed: '#fca5a5', brightGreen: '#6ee7b7', brightYellow: '#fcd34d',
    brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f2f5fb',
  },
  midnight: {
    background: '#05070d', foreground: '#c9d1e4', cursor: '#818cf8', cursorAccent: '#05070d',
    selectionBackground: '#818cf840', black: '#05070d', red: '#fb7185', green: '#4ade80',
    yellow: '#facc15', blue: '#818cf8', magenta: '#c084fc', cyan: '#38bdf8', white: '#c9d1e4',
    brightBlack: '#505a70', brightRed: '#fda4af', brightGreen: '#86efac', brightYellow: '#fde047',
    brightBlue: '#a5b4fc', brightMagenta: '#d8b4fe', brightCyan: '#7dd3fc', brightWhite: '#eef2fb',
  },
  synthwave: {
    background: '#17112b', foreground: '#e8dcff', cursor: '#f472b6', cursorAccent: '#17112b',
    selectionBackground: '#f472b640', black: '#17112b', red: '#ff6b8a', green: '#4ade80',
    yellow: '#fde047', blue: '#38bdf8', magenta: '#f472b6', cyan: '#22d3ee', white: '#e8dcff',
    brightBlack: '#7663a0', brightRed: '#ff9bb0', brightGreen: '#86efac', brightYellow: '#fef08a',
    brightBlue: '#7dd3fc', brightMagenta: '#f9a8d4', brightCyan: '#67e8f9', brightWhite: '#fdf7ff',
  },
  'nova-light': {
    background: '#f7f9fd', foreground: '#1e2635', cursor: '#0891b2', cursorAccent: '#ffffff',
    selectionBackground: '#0891b233', black: '#1e2635', red: '#dc2626', green: '#059669',
    yellow: '#d97706', blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#f4f6fb',
    brightBlack: '#5a6577', brightRed: '#ef4444', brightGreen: '#10b981', brightYellow: '#f59e0b',
    brightBlue: '#3b82f6', brightMagenta: '#8b5cf6', brightCyan: '#06b6d4', brightWhite: '#ffffff',
  },
};

let Terminal = null;
let FitAddon = null;
let WebLinksAddon = null;

const sessions = new Map();  // id -> session
let activeId = null;
let counter = 0;
let loaded = false;

async function loadXterm() {
  if (loaded) return;
  await import('../../vendor/xterm/xterm.js');
  await import('../../vendor/xterm/addon-fit.js');
  await import('../../vendor/xterm/addon-web-links.js');
  Terminal = window.Terminal;
  FitAddon = window.FitAddon?.FitAddon;
  WebLinksAddon = window.WebLinksAddon?.WebLinksAddon;
  loaded = true;
}

export function init() {
  window.nova.shell.onData(({ id, data }) => sessions.get(id)?.term.write(data));

  window.nova.shell.onPrompt(({ id, cwd }) => {
    const s = sessions.get(id);
    if (!s) return;
    s.cwd = cwd;
    s.busy = false;
    writePrompt(s);
    renderTabs();
  });

  window.nova.shell.onExit(({ id }) => {
    const s = sessions.get(id);
    if (!s) return;
    s.alive = false;
    s.term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
    renderTabs();
  });

  bus.on('settings:change', ({ settings, patch }) => {
    if (!('theme' in patch) && !('fontSize' in patch) && !('fontFamily' in patch)) return;
    for (const s of sessions.values()) {
      s.term.options.theme = XTERM_THEMES[settings.theme] || XTERM_THEMES['claude-dark'];
      s.term.options.fontSize = Math.max(10, settings.fontSize - 1);
    }
  });

  bus.on('state:ui', () => {
    if (getState().ui.panelOpen) requestAnimationFrame(fitActive);
  });
  bus.on('layout:resized', fitActive);
  window.addEventListener('resize', fitActive);

  const actions = $('#panel-actions');
  clear(actions);
  actions.append(
    iconBtn('New Terminal', ['M8 3v10M3 8h10'], () => create()),
    iconBtn('Kill Terminal', ['M3.5 3.5l9 9M12.5 3.5l-9 9'], () => kill(activeId)),
    iconBtn('Close Panel', ['M3 8h10'], () => setState({ ui: { panelOpen: false } }))
  );
}

function iconBtn(title, paths, onclick) {
  return el('button', { class: 'icon-btn', title, onclick }, [svg(paths, 14)]);
}

/* ── Session lifecycle ────────────────────────────────────────────────── */

export async function create() {
  await loadXterm();
  if (!Terminal) {
    bus.emit('notify', { type: 'error', title: 'Terminal unavailable', message: 'xterm failed to load.' });
    return null;
  }

  const settings = getSettings();
  const cwd = getState().workspace?.root || undefined;

  let created;
  try {
    created = await window.nova.shell.create({ cwd, cols: 80, rows: 24 });
  } catch (err) {
    bus.emit('notify', { type: 'error', title: 'Terminal failed', message: err.message });
    return null;
  }

  const term = new Terminal({
    fontFamily: settings.fontFamily,
    fontSize: Math.max(10, settings.fontSize - 1),
    lineHeight: 1.35,
    letterSpacing: 0.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    allowProposedApi: true,
    scrollback: 6000,
    smoothScrollDuration: 90,
    theme: XTERM_THEMES[settings.theme] || XTERM_THEMES['claude-dark'],
  });

  const fit = FitAddon ? new FitAddon() : null;
  if (fit) term.loadAddon(fit);
  if (WebLinksAddon) {
    term.loadAddon(new WebLinksAddon((_e, uri) => window.nova.app.openExternal(uri)));
  }

  const host = el('div', { class: 'term-host', dataset: { id: created.id } });
  $('#panel-body').append(host);
  term.open(host);

  const session = {
    id: created.id,
    name: `pwsh ${++counter}`,
    term,
    fit,
    host,
    cwd: created.cwd,
    alive: true,
    busy: false,
    line: '',
    cursor: 0,
    history: [],
    historyIndex: -1,
  };
  sessions.set(created.id, session);

  term.onData((data) => onInput(session, data));
  term.attachCustomKeyEventHandler((e) => {
    // Let the app keymap have Ctrl+` and friends; xterm swallows them otherwise.
    if (e.ctrlKey && e.code === 'Backquote') return false;
    if (e.ctrlKey && e.shiftKey && ['KeyP', 'KeyF'].includes(e.code)) return false;
    return true;
  });

  term.write(
    '\x1b[38;2;217;119;87m  Nova Terminal\x1b[0m  \x1b[90mPowerShell bridge\x1b[0m\r\n' +
    '\x1b[90m  Full-screen TUI programs are not supported.\x1b[0m\r\n\r\n'
  );

  setState({ ui: { panelOpen: true } });
  activate(created.id);
  renderTabs();
  requestAnimationFrame(fitActive);
  return session;
}

export function activate(id) {
  activeId = id;
  for (const s of sessions.values()) s.host.hidden = s.id !== id;
  renderTabs();
  const s = sessions.get(id);
  if (s) {
    requestAnimationFrame(() => {
      s.fit?.fit();
      s.term.focus();
    });
  }
}

export function kill(id = activeId) {
  const s = sessions.get(id);
  if (!s) return;
  window.nova.shell.kill(id);
  s.term.dispose();
  s.host.remove();
  sessions.delete(id);

  const next = [...sessions.keys()].pop() || null;
  activeId = next;
  if (next) activate(next);
  else setState({ ui: { panelOpen: false } });
  renderTabs();
}

export async function toggle() {
  const open = getState().ui.panelOpen;
  if (open) {
    setState({ ui: { panelOpen: false } });
    return;
  }
  if (sessions.size === 0) await create();
  else {
    setState({ ui: { panelOpen: true } });
    activate(activeId);
  }
}

export const count = () => sessions.size;

/** Run a command in the active terminal, creating one if needed. Used by tests and the agent. */
export async function runCommand(command) {
  let s = sessions.get(activeId);
  if (!s) s = await create();
  if (!s) return;
  setState({ ui: { panelOpen: true } });
  activate(s.id);
  s.term.write(command + '\r\n');
  s.history.unshift(command);
  s.busy = true;
  window.nova.shell.exec(s.id, command);
}

function fitActive() {
  const s = sessions.get(activeId);
  if (!s || !getState().ui.panelOpen) return;
  try {
    s.fit?.fit();
  } catch {
    /* the panel can be mid-transition; the next fit will land */
  }
}

/* ── Local line editing ───────────────────────────────────────────────── */

function writePrompt(s) {
  const short = s.cwd.length > 44 ? '…' + s.cwd.slice(-42) : s.cwd;
  s.term.write(`\x1b[38;2;217;119;87m${short}\x1b[0m \x1b[38;2;240;168;104m❯\x1b[0m `);
  s.line = '';
  s.cursor = 0;
}

function redraw(s) {
  // Rewrite the input region: clear from the prompt to end, then reprint.
  s.term.write('\x1b[s');                  // save
  s.term.write('\r\x1b[K');                // clear the line
  const short = s.cwd.length > 44 ? '…' + s.cwd.slice(-42) : s.cwd;
  s.term.write(`\x1b[38;2;217;119;87m${short}\x1b[0m \x1b[38;2;240;168;104m❯\x1b[0m `);
  s.term.write(s.line);
  const back = s.line.length - s.cursor;
  if (back > 0) s.term.write(`\x1b[${back}D`);
}

function onInput(s, data) {
  if (!s.alive) return;

  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const code = ch.charCodeAt(0);

    // Escape sequences: arrows, home, end, delete.
    if (ch === '\x1b') {
      const seq = data.slice(i, i + 3);
      if (seq === '\x1b[A') { historyPrev(s); i += 2; continue; }
      if (seq === '\x1b[B') { historyNext(s); i += 2; continue; }
      if (seq === '\x1b[C') {
        if (s.cursor < s.line.length) { s.cursor++; s.term.write('\x1b[C'); }
        i += 2; continue;
      }
      if (seq === '\x1b[D') {
        if (s.cursor > 0) { s.cursor--; s.term.write('\x1b[D'); }
        i += 2; continue;
      }
      if (data.slice(i, i + 4) === '\x1b[3~') { // delete
        if (s.cursor < s.line.length) {
          s.line = s.line.slice(0, s.cursor) + s.line.slice(s.cursor + 1);
          redraw(s);
        }
        i += 3; continue;
      }
      if (seq === '\x1b[H') { s.cursor = 0; redraw(s); i += 2; continue; }
      if (seq === '\x1b[F') { s.cursor = s.line.length; redraw(s); i += 2; continue; }
      i += 2;
      continue;
    }

    if (ch === '\r' || ch === '\n') { submit(s); continue; }

    if (code === 127 || code === 8) { // backspace
      if (s.cursor > 0) {
        s.line = s.line.slice(0, s.cursor - 1) + s.line.slice(s.cursor);
        s.cursor--;
        redraw(s);
      }
      continue;
    }

    if (code === 3) { // Ctrl+C
      s.term.write('^C\r\n');
      if (s.busy) interrupt(s);
      else { s.line = ''; s.cursor = 0; writePrompt(s); }
      continue;
    }

    if (code === 12) { // Ctrl+L
      s.term.clear();
      redraw(s);
      continue;
    }

    if (code === 21) { // Ctrl+U
      s.line = s.line.slice(s.cursor);
      s.cursor = 0;
      redraw(s);
      continue;
    }

    if (code < 32) continue; // ignore remaining control chars

    s.line = s.line.slice(0, s.cursor) + ch + s.line.slice(s.cursor);
    s.cursor++;
    if (s.cursor === s.line.length) s.term.write(ch);
    else redraw(s);
  }
}

function submit(s) {
  const cmd = s.line.trim();
  s.term.write('\r\n');
  s.line = '';
  s.cursor = 0;
  s.historyIndex = -1;

  if (!cmd) {
    writePrompt(s);
    return;
  }

  if (cmd === 'clear' || cmd === 'cls') {
    s.term.clear();
    writePrompt(s);
    return;
  }

  s.history.unshift(cmd);
  if (s.history.length > 200) s.history.pop();
  s.busy = true;
  renderTabs();
  window.nova.shell.exec(s.id, cmd);
}

async function interrupt(s) {
  try {
    const next = await window.nova.shell.interrupt(s.id);
    // The bridge respawns the shell with the same cwd; carry the session over.
    sessions.delete(s.id);
    s.id = next.id;
    s.cwd = next.cwd;
    s.busy = false;
    s.host.dataset.id = next.id;
    sessions.set(next.id, s);
    if (activeId !== next.id) activeId = next.id;
    writePrompt(s);
    renderTabs();
  } catch {
    s.term.write('\x1b[31mCould not interrupt.\x1b[0m\r\n');
  }
}

function historyPrev(s) {
  if (!s.history.length) return;
  s.historyIndex = Math.min(s.historyIndex + 1, s.history.length - 1);
  s.line = s.history[s.historyIndex];
  s.cursor = s.line.length;
  redraw(s);
}

function historyNext(s) {
  if (s.historyIndex <= 0) {
    s.historyIndex = -1;
    s.line = '';
    s.cursor = 0;
  } else {
    s.historyIndex--;
    s.line = s.history[s.historyIndex];
    s.cursor = s.line.length;
  }
  redraw(s);
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

function renderTabs() {
  const host = $('#panel-tabs');
  if (!host) return;
  clear(host);

  for (const s of sessions.values()) {
    const tab = el('div', {
      class: `pt${s.id === activeId ? ' active' : ''}${s.alive ? '' : ' exited'}`,
      onclick: () => activate(s.id),
    }, [
      el('span', {
        class: 'pt-dot',
        style: s.busy ? { background: 'var(--warning)', animation: 'pulse-soft 1s infinite' } : {},
      }),
      el('span', { text: s.name }),
      el('button', {
        class: 'pt-close',
        title: 'Kill',
        onclick: (e) => {
          e.stopPropagation();
          kill(s.id);
        },
      }, [svg('M3.5 3.5l8 8M11.5 3.5l-8 8', 10)]),
    ]);
    host.append(tab);
  }
}

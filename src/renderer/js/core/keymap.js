import * as commands from './commands.js';

/**
 * Keybinding resolution, including two-stroke chords (Ctrl+K Z).
 *
 * Bindings are declared on the commands themselves, so this module only parses
 * and dispatches — there is no second list to keep in sync.
 */

let chordPrefix = null;
let chordTimer = null;
const CHORD_WINDOW = 1600;

function normalize(binding) {
  return binding
    .split(/\s+/)
    .map((stroke) =>
      stroke
        .toLowerCase()
        .split('+')
        .map((p) => ({ control: 'ctrl', command: 'meta', escape: 'esc' })[p] || p)
        .sort(sortMods)
        .join('+')
    )
    .join(' ');
}

const MOD_ORDER = { ctrl: 0, alt: 1, shift: 2, meta: 3 };
function sortMods(a, b) {
  const ra = MOD_ORDER[a] ?? 9;
  const rb = MOD_ORDER[b] ?? 9;
  return ra - rb;
}

function strokeOf(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');

  let key = e.key.toLowerCase();
  const named = {
    ' ': 'space', escape: 'esc', arrowup: 'up', arrowdown: 'down',
    arrowleft: 'left', arrowright: 'right', delete: 'delete', backquote: '`',
    '+': '=', // Shift+= arrives as "+"; fold it back so ctrl+shift+= resolves
  };
  key = named[key] || key;

  // Use the physical key for letters and digits so shifted symbols still resolve
  // (Ctrl+Shift+P arrives as key "P", Ctrl+` as key "`" on some layouts).
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (e.code === 'Backquote') key = '`';

  if (['control', 'alt', 'shift', 'meta'].includes(key)) return null;
  parts.push(key);
  return parts.join('+');
}

/** Bindings we deliberately let Monaco keep when the editor owns focus. */
const EDITOR_OWNED = new Set([
  'ctrl+f', 'ctrl+h', 'ctrl+d', 'ctrl+z', 'ctrl+y', 'ctrl+shift+z',
  'ctrl+/', 'alt+up', 'alt+down', 'alt+shift+up', 'alt+shift+down',
  'ctrl+shift+k', 'ctrl+x', 'ctrl+c', 'ctrl+v', 'ctrl+a', 'ctrl+l',
  'ctrl+home', 'ctrl+end', 'ctrl+shift+l', 'ctrl+u',
]);

function inEditor() {
  const a = document.activeElement;
  return !!a?.closest?.('.monaco-editor');
}

function inTextField() {
  const a = document.activeElement;
  if (!a) return false;
  if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') return true;
  return a.isContentEditable === true;
}

function buildIndex() {
  const single = new Map();
  const chords = new Map();
  for (const cmd of commands.all()) {
    if (!cmd.keybinding) continue;
    for (const binding of [].concat(cmd.keybinding)) {
      const norm = normalize(binding);
      if (norm.includes(' ')) {
        const [first, second] = norm.split(' ');
        if (!chords.has(first)) chords.set(first, new Map());
        chords.get(first).set(second, cmd.id);
      } else {
        single.set(norm, cmd.id);
      }
    }
  }
  return { single, chords };
}

let index = null;

export function refresh() {
  index = buildIndex();
}

function clearChord() {
  chordPrefix = null;
  clearTimeout(chordTimer);
}

export function install() {
  refresh();

  window.addEventListener(
    'keydown',
    (e) => {
      const stroke = strokeOf(e);
      if (!stroke) return;

      // Second stroke of a chord.
      if (chordPrefix) {
        const table = index.chords.get(chordPrefix);
        clearChord();
        const id = table?.get(stroke);
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          commands.run(id);
          return;
        }
        // Unrecognised second stroke: swallow it rather than firing something
        // unexpected, since the user was clearly mid-chord.
        e.preventDefault();
        return;
      }

      // Chord prefix.
      // Inside a plain text field a chord prefix would eat the next keystroke.
      if (index.chords.has(stroke) && !(inTextField() && !inEditor())) {
        e.preventDefault();
        chordPrefix = stroke;
        chordTimer = setTimeout(clearChord, CHORD_WINDOW);
        return;
      }

      const id = index.single.get(stroke);
      if (!id) return;

      // Let Monaco own its native editing bindings while it has focus.
      if (inEditor() && EDITOR_OWNED.has(stroke)) return;

      // Inside a plain text field, only modified strokes are ours; bare typing
      // and navigation keys must reach the field.
      if (inTextField() && !inEditor()) {
        const modified = e.ctrlKey || e.altKey || e.metaKey;
        if (!modified && stroke !== 'esc') return;
      }

      e.preventDefault();
      e.stopPropagation();
      commands.run(id);
    },
    true // capture, so overlays cannot swallow global bindings first
  );
}

/** Pretty-print a binding for the palette and menus: "ctrl+shift+p" -> "Ctrl+Shift+P". */
export function pretty(binding) {
  if (!binding) return '';
  return [].concat(binding)[0]
    .split(' ')
    .map((stroke) =>
      stroke
        .split('+')
        .map((p) => {
          if (p === 'ctrl') return 'Ctrl';
          if (p === 'alt') return 'Alt';
          if (p === 'shift') return 'Shift';
          if (p === 'meta') return 'Win';
          if (p === 'esc') return 'Esc';
          if (p.length === 1) return p.toUpperCase();
          return p.charAt(0).toUpperCase() + p.slice(1);
        })
        .join('+')
    )
    .join(' ');
}

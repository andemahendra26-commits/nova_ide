import { bus } from '../core/bus.js';
import { getState, setState } from '../core/state.js';
import { getSettings } from '../core/settings.js';
import { basename, dirname } from '../core/util.js';
import { languageFor } from './languages.js';
import { defineThemes, applyTheme } from './themes.js';

let monaco = null;
let editor = null;
let hostEl = null;

/** path -> { path, name, language, model, viewState, savedVersionId, dirty } */
const files = new Map();

export function getMonaco() {
  return monaco;
}
export function getEditor() {
  return editor;
}
export function getFile(path) {
  return files.get(path);
}
export function openPaths() {
  return getState().files.order;
}

export async function init(container) {
  hostEl = container;
  monaco = await window.__monacoReady;
  defineThemes(monaco);

  const s = getSettings();

  editor = monaco.editor.create(container, {
    value: '',
    language: 'plaintext',
    theme: s.theme,
    automaticLayout: true,
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    fontLigatures: true,
    lineHeight: 1.62,
    letterSpacing: 0.2,
    tabSize: s.tabSize,
    insertSpaces: true,
    wordWrap: s.wordWrap ? 'on' : 'off',
    minimap: { enabled: s.minimap, renderCharacters: false, maxColumn: 90 },
    lineNumbers: s.lineNumbers ? 'on' : 'off',
    lineNumbersMinChars: 4,
    glyphMargin: true,
    renderLineHighlight: 'all',
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    mouseWheelZoom: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: 'active', indentation: true, highlightActiveIndentation: true },
    padding: { top: 14, bottom: 120 },
    scrollBeyondLastLine: true,
    scrollbar: { verticalScrollbarSize: 11, horizontalScrollbarSize: 11, useShadows: false },
    renderWhitespace: 'selection',
    suggestSelection: 'first',
    quickSuggestions: { other: true, comments: false, strings: false },
    folding: true,
    foldingHighlight: true,
    matchBrackets: 'always',
    occurrencesHighlight: 'singleFile',
    selectionHighlight: true,
    roundedSelection: true,
    contextmenu: true,
    multiCursorModifier: 'ctrlCmd',
    stickyScroll: { enabled: true, maxLineCount: 3 },
  });

  editor.onDidChangeCursorPosition((e) => {
    bus.emit('editor:cursor', {
      line: e.position.lineNumber,
      column: e.position.column,
      selections: editor.getSelections()?.length || 1,
      selected: selectedCharCount(),
    });
  });

  editor.onDidChangeCursorSelection(() => {
    bus.emit('editor:selection', { selected: selectedCharCount() });
  });

  bus.on('settings:change', ({ settings, patch }) => {
    if ('theme' in patch) applyTheme(monaco, settings.theme);
    editor.updateOptions({
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      tabSize: settings.tabSize,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      minimap: { enabled: settings.minimap, renderCharacters: false, maxColumn: 90 },
      lineNumbers: settings.lineNumbers ? 'on' : 'off',
    });
  });

  applyTheme(monaco, s.theme);
  return editor;
}

function selectedCharCount() {
  const sels = editor?.getSelections() || [];
  const model = editor?.getModel();
  if (!model) return 0;
  return sels.reduce((sum, sel) => sum + model.getValueInRange(sel).length, 0);
}

/* ── Opening ──────────────────────────────────────────────────────────── */

export async function openFile(path, opts = {}) {
  if (files.has(path)) {
    activate(path, opts);
    return files.get(path);
  }

  const res = await window.nova.fs.readFile(path);
  if (res.tooLarge) {
    bus.emit('notify', {
      type: 'warn',
      title: 'File too large',
      message: `${basename(path)} exceeds the 12 MB editing limit.`,
    });
    return null;
  }
  if (res.binary) {
    bus.emit('notify', {
      type: 'warn',
      title: 'Binary file',
      message: `${basename(path)} is not a text file.`,
    });
    return null;
  }

  const language = languageFor(path);
  const uri = monaco.Uri.file(path.replace(/\\/g, '/'));
  const model =
    monaco.editor.getModel(uri) || monaco.editor.createModel(res.content, language, uri);

  const file = {
    path,
    name: basename(path),
    dir: dirname(path),
    language,
    model,
    viewState: null,
    savedVersionId: model.getAlternativeVersionId(),
    dirty: false,
  };
  files.set(path, file);

  model.onDidChangeContent(() => {
    // Alternative version id returns to the saved value on undo, so a file that
    // is edited and undone correctly reports clean again.
    const nowDirty = model.getAlternativeVersionId() !== file.savedVersionId;
    if (nowDirty !== file.dirty) {
      file.dirty = nowDirty;
      bus.emit('file:dirty', { path, dirty: nowDirty });
    }
  });

  const order = [...getState().files.order];
  if (!order.includes(path)) order.push(path);
  setState({ files: { open: files, order } });

  bus.emit('file:opened', { path, file });
  activate(path, opts);
  return file;
}

export function activate(path, opts = {}) {
  const file = files.get(path);
  if (!file || !editor) return;

  const prev = getState().files.active;
  if (prev && prev !== path && files.has(prev)) {
    files.get(prev).viewState = editor.saveViewState();
  }

  editor.setModel(file.model);
  if (file.viewState) editor.restoreViewState(file.viewState);

  setState({ files: { open: files, order: getState().files.order, active: path } });
  bus.emit('file:activated', { path, file });

  if (opts.line) revealLine(opts.line, opts.column, opts.flash);
  if (opts.focus !== false) editor.focus();
}

export function revealLine(line, column = 1, flash = false) {
  if (!editor) return;
  editor.revealLineInCenter(line, 0 /* Smooth */);
  editor.setPosition({ lineNumber: line, column });
  if (flash) {
    const ids = editor.deltaDecorations(
      [],
      [
        {
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: 'nova-jump-flash' },
        },
      ]
    );
    setTimeout(() => editor.deltaDecorations(ids, []), 1200);
  }
  editor.focus();
}

/* ── Closing ──────────────────────────────────────────────────────────── */

export async function closeFile(path, opts = {}) {
  const file = files.get(path);
  if (!file) return true;

  if (file.dirty && !opts.force) {
    const { confirmed } = await window.nova.dialog.confirm({
      message: `Save changes to ${file.name}?`,
      detail: 'Your changes will be lost if you do not save them.',
      confirmLabel: 'Save',
      danger: true,
    });
    if (confirmed) {
      const ok = await saveFile(path);
      if (!ok) return false;
    }
  }

  const prevOrder = getState().files.order;
  const closedIdx = prevOrder.indexOf(path);
  const order = prevOrder.filter((p) => p !== path);
  const wasActive = getState().files.active === path;

  file.model.dispose();
  files.delete(path);

  // Land on the neighbour, the way every other editor does.
  const nextActive = wasActive
    ? order[Math.min(closedIdx, order.length - 1)] || null
    : getState().files.active;
  setState({ files: { open: files, order, active: nextActive } });

  bus.emit('file:closed', { path });

  if (wasActive) {
    if (nextActive) activate(nextActive);
    else {
      editor.setModel(null);
      bus.emit('file:none');
    }
  }
  return true;
}

export async function closeOthers(keepPath) {
  for (const path of [...getState().files.order]) {
    if (path !== keepPath) await closeFile(path);
  }
}

export async function closeAll() {
  for (const path of [...getState().files.order]) {
    const ok = await closeFile(path);
    if (!ok) return false;
  }
  return true;
}

/* ── Saving ───────────────────────────────────────────────────────────── */

export async function saveFile(path = getState().files.active) {
  const file = files.get(path);
  if (!file) return false;
  try {
    await window.nova.fs.writeFile(path, file.model.getValue());
    file.savedVersionId = file.model.getAlternativeVersionId();
    file.dirty = false;
    bus.emit('file:dirty', { path, dirty: false });
    bus.emit('file:saved', { path, name: file.name });
    return true;
  } catch (err) {
    bus.emit('notify', { type: 'error', title: 'Save failed', message: err.message });
    return false;
  }
}

export async function saveAs(path = getState().files.active) {
  const file = files.get(path);
  if (!file) return false;
  const picked = await window.nova.dialog.saveAs(path);
  if (!picked) return false;
  try {
    await window.nova.fs.writeFile(picked.path, file.model.getValue());
    bus.emit('notify', { type: 'success', title: 'Saved', message: basename(picked.path) });
    await closeFile(path, { force: true });
    await openFile(picked.path);
    return true;
  } catch (err) {
    bus.emit('notify', { type: 'error', title: 'Save failed', message: err.message });
    return false;
  }
}

export async function saveAll() {
  let n = 0;
  for (const [path, file] of files) {
    if (file.dirty && (await saveFile(path))) n++;
  }
  return n;
}

export function hasDirty() {
  return [...files.values()].some((f) => f.dirty);
}

/* ── Creating an empty buffer for agent output ────────────────────────── */

export async function openOrCreate(path) {
  const st = await window.nova.fs.stat(path);
  if (!st.exists) await window.nova.fs.writeFile(path, '');
  return openFile(path);
}

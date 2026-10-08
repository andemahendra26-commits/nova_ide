/* ─────────────────────────────────────────────────────────────────────────
   TEST STUDIO — WIRING
   This module owns nothing outside src/renderer/js/testing/ and
   src/renderer/css/testing.css. Add exactly the lines below to hook it up.

   1. src/renderer/index.html — stylesheet, after css/components.css:

        <link rel="stylesheet" href="css/testing.css" />

   2. src/renderer/index.html — sidebar container, after #view-search:

        <section class="sb-view" id="view-tests" data-view="tests" hidden></section>

   3. src/main/preload.js — inside the `api` object, alongside `search`:

        test: {
          runCase: (payload) => call('test:runCase', payload),
          runSuite: (payload) => call('test:runSuite', payload),
          cancel: (runId) => call('test:cancel', { runId }),
          onStep: (h) => listen('test:step', h),
          onDone: (h) => listen('test:done', h),
        },

   4. src/main/main.js — require near the other ipc modules, then register
      beside fsIpc.register():

        const testIpc = require('./ipc/testrunner');
        testIpc.register();

   5. Wherever the renderer boots its views (js/boot.js) — import and init
      with the container element:

        import * as teststudio from './testing/studio.js';
        teststudio.init(document.getElementById('view-tests'));

   6. Wherever commands are registered — the id this module answers to.
      `selectView` is the existing export from js/ui/activitybar.js:

        commands.register({
          id: 'view.tests',
          title: 'Show Test Studio',
          category: 'View',
          run: () => activitybar.selectView('tests'),
        });

   7. src/renderer/js/ui/activitybar.js — optional VIEWS entry so the studio
      gets an activity-bar icon:

        { id: 'tests', title: 'Test Studio', command: 'view.tests',
          icon: ['M6 1.8v3.6L2.6 12a1.6 1.6 0 001.4 2.4h8a1.6 1.6 0 001.4-2.4L10 5.4V1.8', 'M5.2 1.8h5.6'] },

   Nothing else is required: the status bar already renders getState().testSummary
   when it sees the `test:summary` bus event, which this module emits.
   ───────────────────────────────────────────────────────────────────────── */

import { bus } from '../core/bus.js';
import { el, svg, clear, uid, debounce } from '../core/util.js';
import { getState, setState } from '../core/state.js';
import * as model from './model.js';

/* ── module state ─────────────────────────────────────────────────────── */

let viewEl = null;
let scrollEl = null;
let resultsEl = null;
let resultsListEl = null;
let summaryEl = null;
let runBtn = null;
let stopBtn = null;

let root = null;
let project = model.emptyProject();
let elements = [];
let loaded = false;

let tab = 'tests';
const expanded = new Set();
let editingStep = null;
let datasetFor = null;

/** stepId -> row element, so live results patch the DOM instead of re-rendering. */
const stepNodes = new Map();
let runId = null;
let running = false;

const ICON = {
  play: ['M5 3.5l7 4.5-7 4.5z'],
  stop: ['M4.5 4.5h7v7h-7z'],
  plus: ['M8 3.2v9.6M3.2 8h9.6'],
  trash: ['M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9'],
  chevron: ['M6 3.5L10.5 8 6 12.5'],
  up: ['M8 12V4M4.5 7.5L8 4l3.5 3.5'],
  down: ['M8 4v8M4.5 8.5L8 12l3.5-3.5'],
  refresh: ['M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5V5H11'],
};

/* ── boot ─────────────────────────────────────────────────────────────── */

export function init(containerEl) {
  viewEl = containerEl;
  if (!viewEl) return;
  clear(viewEl);
  buildShell();

  bus.on('state:workspace', () => {
    loaded = false;
    load();
  });
  // The view is usually hidden at boot; load the moment it is first shown.
  bus.on('sidebar:view', ({ view }) => {
    if (view === 'tests' && !loaded) load();
  });

  // Fail loudly but harmlessly if step 3 of the wiring block is missing, rather
  // than throwing during boot and taking the rest of the renderer down with it.
  if (!window.nova?.test) {
    clear(viewEl);
    viewEl.append(el('div', { class: 'ts-empty', text: 'Test Studio is not wired up: add the `test` block to preload.js.' }));
    return;
  }

  window.nova.test.onStep(onStep);
  window.nova.test.onDone(onDone);

  load();
}

function buildShell() {
  const shell = el('div', { class: 'ts' });

  runBtn = toolButton(ICON.play, 'Run everything', () => runAll());
  stopBtn = toolButton(ICON.stop, 'Stop the run', () => cancel());
  stopBtn.disabled = true;

  const toolbar = el('div', { class: 'ts-toolbar' }, [
    runBtn,
    stopBtn,
    el('div', { class: 'ts-spacer' }),
    toolButton(ICON.refresh, 'Reload from disk', () => { loaded = false; load(); }),
    toolButton(ICON.plus, 'New suite', () => {
      project.suites.push(model.newSuite());
      persistProject();
      render();
    }),
  ]);

  const tabs = el('div', { class: 'ts-seg' }, [
    segButton('tests', 'Tests'),
    segButton('elements', 'Elements'),
  ]);

  scrollEl = el('div', { class: 'ts-scroll' });

  summaryEl = el('div', { class: 'ts-sum' });
  resultsListEl = el('div', { class: 'ts-log' });
  resultsEl = el('div', { class: 'ts-results' }, [
    el('div', { class: 'ts-results-head' }, [
      el('span', { class: 'ts-results-title', text: 'Results' }),
      summaryEl,
      el('button', {
        class: 'ts-mini', text: 'Clear',
        onclick: () => { clear(resultsListEl); resetStatuses(); },
      }),
    ]),
    resultsListEl,
  ]);

  shell.append(toolbar, tabs, scrollEl, resultsEl);
  viewEl.append(shell);
}

function segButton(id, label) {
  const node = el('button', {
    class: `ts-seg-btn${tab === id ? ' on' : ''}`,
    text: label,
    onclick: () => {
      tab = id;
      for (const b of node.parentElement.children) b.classList.toggle('on', b === node);
      render();
    },
  });
  return node;
}

function toolButton(paths, title, onclick) {
  return el('button', { class: 'icon-btn', title, onclick }, [svg(paths, 15)]);
}

/* ── loading and saving ───────────────────────────────────────────────── */

async function load() {
  root = getState().workspace?.root || null;
  if (!root) {
    project = model.emptyProject();
    elements = [];
    loaded = false;
    render();
    return;
  }
  [project, elements] = await Promise.all([model.loadProject(root), model.loadElements(root)]);
  loaded = true;
  render();
}

// Writes are debounced because every keystroke in a step field mutates the model.
const persistProject = debounce(() => {
  if (root) model.saveProject(root, project).catch(reportError);
}, 320);

const persistElements = debounce(() => {
  if (root) model.saveElements(root, elements).catch(reportError);
}, 320);

function reportError(err) {
  bus.emit('notify', { type: 'error', title: 'Test Studio', message: err.message || String(err) });
}

/* ── rendering ────────────────────────────────────────────────────────── */

function render() {
  if (!scrollEl) return;
  clear(scrollEl);
  stepNodes.clear();

  if (!root) {
    scrollEl.append(el('div', { class: 'ts-empty', text: 'Open a folder to start building tests.' }));
    return;
  }
  if (tab === 'elements') return renderElements();
  renderTree();
}

function renderTree() {
  if (!project.suites.length) {
    scrollEl.append(
      el('div', { class: 'ts-empty' }, [
        el('div', { text: 'No suites yet.' }),
        el('button', {
          class: 'ts-cta', text: 'Create a suite',
          onclick: () => { project.suites.push(model.newSuite()); persistProject(); render(); },
        }),
      ])
    );
    return;
  }

  project.suites.forEach((suite, si) => {
    const open = expanded.has(suite.id);
    const head = stagger(el('div', { class: 'ts-node ts-suite' }, [
      twisty(open),
      el('span', { class: 'ts-name', text: suite.name, ondblclick: (e) => renameInline(e.currentTarget, suite, 'name') }),
      el('span', { class: 'ts-badge', text: String(suite.cases.length) }),
      rowAction(ICON.play, 'Run suite', () => runSuite(suite)),
      rowAction(ICON.plus, 'Add case', () => {
        suite.cases.push(model.newCase());
        expanded.add(suite.id);
        persistProject();
        render();
      }),
      rowAction(ICON.trash, 'Delete suite', () => {
        project.suites = project.suites.filter((s) => s.id !== suite.id);
        persistProject();
        render();
      }, 'danger'),
    ]), si);
    head.addEventListener('click', (e) => {
      if (e.target.closest('.ts-act') || e.target.closest('input')) return;
      toggle(suite.id);
    });
    scrollEl.append(head);
    if (open) suite.cases.forEach((c, ci) => renderCase(suite, c, ci));
  });
}

function renderCase(suite, testCase, index) {
  const open = expanded.has(testCase.id);
  const rows = testCase.dataset?.length || 0;

  const head = stagger(el('div', { class: 'ts-node ts-case' }, [
    twisty(open),
    el('span', { class: 'ts-name', text: testCase.name, ondblclick: (e) => renameInline(e.currentTarget, testCase, 'name') }),
    el('span', { class: 'ts-badge', text: `${testCase.steps.length}` }),
    rows ? el('span', { class: 'ts-badge data', title: `${rows} data rows`, text: `×${rows}` }) : null,
    rowAction(ICON.play, 'Run case', () => runCase(testCase)),
    rowAction(ICON.trash, 'Delete case', () => {
      suite.cases = suite.cases.filter((c) => c.id !== testCase.id);
      persistProject();
      render();
    }, 'danger'),
  ]), index);
  head.addEventListener('click', (e) => {
    if (e.target.closest('.ts-act') || e.target.closest('input')) return;
    toggle(testCase.id);
  });
  scrollEl.append(head);
  if (!open) return;

  testCase.steps.forEach((step, i) => renderStep(testCase, step, i));

  scrollEl.append(
    el('div', { class: 'ts-case-foot' }, [
      addStepPicker(testCase),
      el('button', {
        class: 'ts-mini',
        text: datasetFor === testCase.id ? 'Hide data' : `Data (${rows})`,
        onclick: () => {
          datasetFor = datasetFor === testCase.id ? null : testCase.id;
          render();
        },
      }),
      el('label', { class: 'ts-check', title: 'Keep running after a failed step' }, [
        checkbox(testCase.continueOnFailure, (v) => {
          testCase.continueOnFailure = v;
          persistProject();
        }),
        'continue on fail',
      ]),
    ])
  );

  if (datasetFor === testCase.id) renderDataset(testCase);
}

function addStepPicker(testCase) {
  const picker = el('select', { class: 'ts-select ts-add-step' });
  picker.append(el('option', { value: '', text: '+ step…' }));
  for (const id of model.VERB_IDS) {
    picker.append(el('option', { value: id, text: model.VERBS[id].label }));
  }
  picker.addEventListener('change', () => {
    if (!picker.value) return;
    const step = model.newStep(picker.value);
    testCase.steps.push(step);
    editingStep = step.id;
    persistProject();
    render();
  });
  return picker;
}

function renderDataset(testCase) {
  const tokens = model.tokensIn(testCase);
  const cols = model.datasetColumns(testCase);
  const missing = tokens.filter((t) => !cols.includes(t.split('.')[0]));

  const area = el('textarea', {
    class: 'ts-code ts-dataset',
    spellcheck: 'false',
    rows: 6,
    placeholder: '[\n  { "user": "ada", "pass": "secret" }\n]',
  });
  area.value = JSON.stringify(testCase.dataset || [], null, 2);
  area.addEventListener('keydown', (e) => e.stopPropagation());
  area.addEventListener('change', () => {
    try {
      const parsed = JSON.parse(area.value || '[]');
      if (!Array.isArray(parsed)) throw new Error('Dataset must be a JSON array of objects');
      testCase.dataset = parsed;
      area.classList.remove('bad');
      persistProject();
      render();
    } catch (err) {
      area.classList.add('bad');
      reportError(err);
    }
  });

  scrollEl.append(
    el('div', { class: 'ts-panel' }, [
      el('div', { class: 'ts-panel-title', text: 'Dataset — the case runs once per row' }),
      area,
      tokens.length
        ? el('div', { class: `ts-hint${missing.length ? ' warn' : ''}` }, [
          `Placeholders: ${tokens.map((t) => `{{${t}}}`).join(' ')}`,
          missing.length ? ` — ${missing.join(', ')} not in the dataset (may come from saveAs).` : '',
        ])
        : el('div', { class: 'ts-hint', text: 'Use {{column}} in any step value to substitute per row.' }),
    ])
  );
}

function renderStep(testCase, step, index) {
  const meta = model.verbOf(step);
  const editing = editingStep === step.id;

  const row = stagger(el('div', {
    class: `ts-step g-${meta.group}${step.enabled === false ? ' off' : ''}${editing ? ' editing' : ''}`,
    dataset: { step: step.id },
  }, [
    el('span', { class: 'ts-dot' }),
    el('span', { class: 'ts-idx', text: String(index + 1) }),
    el('span', { class: 'ts-verb', text: meta.label }),
    el('span', { class: 'ts-desc', text: model.describeStep(step, elements) }),
    el('span', { class: 'ts-time' }),
  ]), index);
  row.addEventListener('click', (e) => {
    if (e.target.closest('.ts-act') || e.target.closest('input, select, textarea')) return;
    editingStep = editing ? null : step.id;
    render();
  });

  stepNodes.set(step.id, row);
  scrollEl.append(row);
  if (editing) scrollEl.append(stepEditor(testCase, step, index));
}

function stepEditor(testCase, step, index) {
  const meta = model.verbOf(step);
  const box = el('div', { class: 'ts-editor' });

  const verbSel = select(model.VERB_IDS.map((id) => ({ value: id, label: model.VERBS[id].label })), step.verb, (v) => {
    // Replace rather than mutate: a leftover `url` from an apiRequest on a
    // click step would be invisible in the editor but still land on disk.
    testCase.steps[index] = model.newStep(v, { id: step.id, element: step.element, enabled: step.enabled });
    persistProject();
    render();
  });
  box.append(field('Action', verbSel));

  if (meta.element) {
    const options = [{ value: '', label: '— pick an element —' }]
      .concat(elements.map((e) => ({ value: e.id, label: `${e.name} · ${e.strategy}` })));
    box.append(field('Element', select(options, step.element || '', (v) => {
      step.element = v || null;
      persistProject();
      render();
    })));
  }

  for (const f of meta.fields) box.append(field(f.label, control(step, f)));

  box.append(
    el('div', { class: 'ts-editor-foot' }, [
      el('label', { class: 'ts-check' }, [
        checkbox(step.enabled !== false, (v) => {
          step.enabled = v;
          persistProject();
          render();
        }),
        'enabled',
      ]),
      el('div', { class: 'ts-spacer' }),
      rowAction(ICON.up, 'Move up', () => {
        testCase.steps = model.move(testCase.steps, index, index - 1);
        persistProject();
        render();
      }),
      rowAction(ICON.down, 'Move down', () => {
        testCase.steps = model.move(testCase.steps, index, index + 1);
        persistProject();
        render();
      }),
      rowAction(ICON.plus, 'Duplicate', () => {
        testCase.steps.splice(index + 1, 0, { ...step, id: `st-${uid()}` });
        persistProject();
        render();
      }),
      rowAction(ICON.trash, 'Delete step', () => {
        testCase.steps.splice(index, 1);
        editingStep = null;
        persistProject();
        render();
      }, 'danger'),
    ])
  );

  return box;
}

function control(step, f) {
  const commit = (v) => {
    step[f.key] = v;
    persistProject();
    const row = stepNodes.get(step.id);
    if (row) row.querySelector('.ts-desc').textContent = model.describeStep(step, elements);
  };

  if (f.kind === 'select') {
    const options = f.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
    return select(options, step[f.key] ?? options[0].value, commit);
  }
  if (f.kind === 'code') {
    const area = el('textarea', {
      class: 'ts-code', rows: 3, spellcheck: 'false', placeholder: f.placeholder || '',
    });
    area.value = step[f.key] ?? '';
    area.addEventListener('keydown', (e) => e.stopPropagation());
    area.addEventListener('input', () => commit(area.value));
    return area;
  }
  const input = el('input', {
    class: 'ts-input',
    type: f.kind === 'number' ? 'number' : 'text',
    spellcheck: 'false',
    placeholder: f.placeholder || '',
    value: step[f.key] ?? '',
  });
  input.addEventListener('keydown', (e) => e.stopPropagation());
  input.addEventListener('input', () => commit(f.kind === 'number' ? Number(input.value) : input.value));
  return input;
}

/* ── element repository ───────────────────────────────────────────────── */

function renderElements() {
  scrollEl.append(
    el('div', { class: 'ts-repo-head' }, [
      el('span', { text: `${elements.length} element${elements.length === 1 ? '' : 's'}` }),
      el('button', {
        class: 'ts-mini', text: '+ Element',
        onclick: () => {
          elements.push(model.newElement());
          persistElements();
          render();
        },
      }),
    ])
  );

  if (!elements.length) {
    scrollEl.append(el('div', { class: 'ts-empty', text: 'Named locators live here and are shared by every case.' }));
    return;
  }

  elements.forEach((entry, i) => {
    const uses = countUses(entry.id);
    const name = el('input', { class: 'ts-input name', value: entry.name, spellcheck: 'false' });
    const value = el('input', { class: 'ts-input mono', value: entry.value, spellcheck: 'false', placeholder: '.selector' });
    for (const node of [name, value]) node.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('input', () => { entry.name = name.value; persistElements(); });
    value.addEventListener('input', () => { entry.value = value.value; persistElements(); });

    scrollEl.append(
      stagger(el('div', { class: 'ts-el' }, [
        el('div', { class: 'ts-el-top' }, [
          name,
          select(model.STRATEGIES.map((s) => ({ value: s.id, label: s.label })), entry.strategy, (v) => {
            entry.strategy = v;
            persistElements();
          }),
          rowAction(ICON.trash, uses ? `Used by ${uses} step(s)` : 'Delete element', () => {
            elements = elements.filter((e) => e.id !== entry.id);
            persistElements();
            render();
          }, 'danger'),
        ]),
        value,
        uses ? el('div', { class: 'ts-hint', text: `Used by ${uses} step${uses === 1 ? '' : 's'}` }) : null,
      ]), i)
    );
  });
}

function countUses(elementId) {
  let n = 0;
  for (const suite of project.suites) {
    for (const c of suite.cases) {
      for (const s of c.steps) if (s.element === elementId) n++;
    }
  }
  return n;
}

/* ── small builders ───────────────────────────────────────────────────── */

/** Stagger index for the CSS animation-delay; setProperty is the only way
    to write a custom property onto an element's inline style. */
function stagger(node, i) {
  node.style.setProperty('--i', String(i));
  return node;
}

function twisty(open) {
  const node = el('span', { class: `ts-twisty${open ? ' open' : ''}` }, [svg(ICON.chevron, 11)]);
  return node;
}

function rowAction(paths, title, onclick, extra = '') {
  return el('button', {
    class: `ts-act ${extra}`.trim(),
    title,
    onclick: (e) => { e.stopPropagation(); onclick(); },
  }, [svg(paths, 13)]);
}

function field(label, controlEl) {
  return el('div', { class: 'ts-field' }, [el('label', { text: label }), controlEl]);
}

function select(options, value, onChange) {
  const node = el('select', { class: 'ts-select' });
  for (const opt of options) {
    const o = el('option', { value: opt.value, text: opt.label });
    if (String(opt.value) === String(value)) o.selected = true;
    node.append(o);
  }
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function checkbox(value, onChange) {
  const node = el('input', { type: 'checkbox', class: 'ts-cb' });
  node.checked = !!value;
  node.addEventListener('change', () => onChange(node.checked));
  return node;
}

function toggle(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  render();
}

function renameInline(span, target, key) {
  const input = el('input', { class: 'ts-rename', value: target[key], spellcheck: 'false' });
  span.replaceWith(input);
  input.focus();
  input.select();
  const done = (commit) => {
    if (commit && input.value.trim()) {
      target[key] = input.value.trim();
      persistProject();
    }
    render();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
}

/* ── running ──────────────────────────────────────────────────────────── */

function allCases() {
  return project.suites.flatMap((s) => s.cases);
}

function runCase(testCase) {
  return start('test:runCase', { cases: [testCase] }, testCase.name);
}

function runSuite(suite) {
  return start('test:runSuite', { cases: suite.cases }, suite.name);
}

function runAll() {
  const cases = allCases();
  if (!cases.length) {
    bus.emit('notify', { type: 'warn', title: 'Test Studio', message: 'There is nothing to run yet.' });
    return;
  }
  return start('test:runSuite', { cases }, 'All suites');
}

async function start(channel, payload, label) {
  if (running) return;
  running = true;
  runId = `run-${uid()}`;
  stopBtn.disabled = false;
  runBtn.disabled = true;
  viewEl.classList.add('ts-running');

  resetStatuses();
  clear(resultsListEl);
  summaryEl.textContent = 'running…';
  summaryEl.className = 'ts-sum running';
  logLine({ kind: 'head', text: `${label} · started` });

  try {
    const fn = channel === 'test:runSuite' ? window.nova.test.runSuite : window.nova.test.runCase;
    await fn({ runId, elements, ...payload });
  } catch (err) {
    reportError(err);
    finish();
  }
}

async function cancel() {
  if (!runId) return;
  try {
    await window.nova.test.cancel(runId);
  } catch (err) {
    reportError(err);
  }
}

function finish() {
  running = false;
  runId = null;
  stopBtn.disabled = true;
  runBtn.disabled = false;
  viewEl.classList.remove('ts-running');
}

function resetStatuses() {
  for (const node of stepNodes.values()) {
    node.classList.remove('run-pass', 'run-fail', 'run-running', 'run-skip');
    node.querySelector('.ts-time').textContent = '';
  }
}

/* ── live events ──────────────────────────────────────────────────────── */

function onStep(payload) {
  if (payload.runId !== runId) return;

  const node = stepNodes.get(payload.stepId);
  if (node) {
    node.classList.remove('run-pass', 'run-fail', 'run-running', 'run-skip');
    node.classList.add(`run-${payload.status}`);
    // Restart the stagger animation for this row: the delay makes a fast run
    // read as a sweep down the list rather than an instant colour flip.
    node.style.setProperty('--i', String(payload.index));
    if (payload.durationMs) node.querySelector('.ts-time').textContent = `${payload.durationMs} ms`;
    if (payload.status === 'running') node.scrollIntoView({ block: 'nearest' });
  }

  if (payload.status === 'running') return;

  const rowTag = payload.rowCount > 1 ? ` [row ${payload.rowIndex + 1}/${payload.rowCount}]` : '';
  logLine({
    kind: payload.status,
    text: `${payload.caseName}${rowTag} · ${payload.index + 1}. ${model.VERBS[payload.verb]?.label || payload.verb}`,
    detail: payload.error || payload.detail,
    durationMs: payload.durationMs,
    screenshot: payload.screenshot,
  });
}

function onDone(payload) {
  if (payload.runId !== runId) return;
  const s = payload.summary;

  setState({ testSummary: s });
  bus.emit('test:summary', s);

  summaryEl.className = `ts-sum ${s.failed ? 'fail' : 'pass'}`;
  summaryEl.textContent = `${s.passed}/${s.total} passed · ${s.failed} failed · ${(s.durationMs / 1000).toFixed(1)}s`;
  logLine({ kind: 'head', text: payload.cancelled ? 'Run cancelled' : 'Run finished' });

  bus.emit('notify', {
    type: s.failed ? 'error' : 'success',
    title: payload.cancelled ? 'Run cancelled' : 'Test run complete',
    message: `${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped in ${(s.durationMs / 1000).toFixed(1)}s`,
  });

  finish();
}

function logLine({ kind, text, detail, durationMs, screenshot }) {
  const node = el('div', { class: `ts-log-row ${kind}` }, [
    el('span', { class: 'ts-log-mark' }),
    el('div', { class: 'ts-log-body' }, [
      el('div', { class: 'ts-log-text', text }),
      detail ? el('div', { class: 'ts-log-detail', text: String(detail) }) : null,
      screenshot ? el('img', { class: 'ts-shot', src: screenshot, alt: 'page at this step', loading: 'lazy' }) : null,
    ]),
    durationMs ? el('span', { class: 'ts-log-ms', text: `${durationMs} ms` }) : null,
  ]);
  resultsListEl.append(node);
  resultsListEl.scrollTop = resultsListEl.scrollHeight;
}

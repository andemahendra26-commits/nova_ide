import { uid, joinPath } from '../core/util.js';

/**
 * The Test Studio data model: verb metadata, factories, and persistence.
 *
 * The verb table is the single source of truth for what the step editor
 * renders. Adding a verb here gives it a row editor for free — the only other
 * place that needs to know about it is the executor in ipc/testrunner.js,
 * which reads the very field keys declared below.
 */

export const ELEMENTS_FILE = 'elements.json';
export const TESTS_FILE = 'tests.json';
const NOVA_DIR = '.nova';

export const STRATEGIES = [
  { id: 'css', label: 'CSS' },
  { id: 'xpath', label: 'XPath' },
  { id: 'text', label: 'Text' },
  { id: 'id', label: 'ID' },
];

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

const MATCH_FIELD = {
  key: 'match',
  label: 'Match',
  kind: 'select',
  options: [
    { value: 'contains', label: 'contains' },
    { value: 'equals', label: 'equals' },
  ],
};

/**
 * group drives the colour band on a step row; element:true means the step
 * needs a locator from the repository; fields are rendered in order.
 */
export const VERBS = {
  navigate: {
    label: 'Navigate', group: 'action', element: false, icon: 'M2 8h12M9.5 4.5L13 8l-3.5 3.5',
    fields: [{ key: 'value', label: 'URL', kind: 'text', placeholder: 'https://example.com' }],
  },
  click: {
    label: 'Click', group: 'action', element: true, icon: 'M4 3l8 4.6-3.4 1.1L7.5 12z',
    fields: [],
  },
  type: {
    label: 'Type', group: 'action', element: true, icon: 'M3 4h10M8 4v8M6 12h4',
    fields: [{ key: 'value', label: 'Text', kind: 'text', placeholder: 'Hello {{name}}' }],
  },
  select: {
    label: 'Select', group: 'action', element: true, icon: 'M3 5h10v6H3zM5.5 7.5L8 10l2.5-2.5',
    fields: [{ key: 'value', label: 'Option', kind: 'text', placeholder: 'value or visible label' }],
  },
  hover: {
    label: 'Hover', group: 'action', element: true, icon: 'M8 2v3M8 11v3M2 8h3M11 8h3',
    fields: [],
  },
  wait: {
    label: 'Wait', group: 'action', element: false, icon: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5v3.2l2 1.2',
    fields: [{ key: 'value', label: 'Milliseconds', kind: 'number', placeholder: '500' }],
  },
  waitForElement: {
    label: 'Wait for element', group: 'action', element: true, icon: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM5.5 8h5',
    fields: [{ key: 'timeout', label: 'Timeout ms', kind: 'number', placeholder: '10000' }],
  },
  assertText: {
    label: 'Assert text', group: 'assert', element: true, icon: 'M3 8.5l3 3 7-7',
    fields: [{ key: 'value', label: 'Expected', kind: 'text' }, MATCH_FIELD],
  },
  assertVisible: {
    label: 'Assert visible', group: 'assert', element: true, icon: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z',
    fields: [],
  },
  assertUrl: {
    label: 'Assert URL', group: 'assert', element: false, icon: 'M6.5 9.5l3-3M5 11a2.5 2.5 0 010-3.5l1.5-1.5M11 5a2.5 2.5 0 010 3.5L9.5 10',
    fields: [{ key: 'value', label: 'Expected', kind: 'text' }, MATCH_FIELD],
  },
  assertAttribute: {
    label: 'Assert attribute', group: 'assert', element: true, icon: 'M4 3v10M12 3v10M4 8h8',
    fields: [
      { key: 'value', label: 'Attribute', kind: 'text', placeholder: 'href' },
      { key: 'value2', label: 'Expected', kind: 'text' },
    ],
  },
  screenshot: {
    label: 'Screenshot', group: 'action', element: false, icon: 'M2 5.5h3l1-1.5h4l1 1.5h3v7H2zM8 11a2 2 0 100-4 2 2 0 000 4z',
    fields: [{ key: 'value', label: 'Label', kind: 'text', placeholder: 'after login' }],
  },
  script: {
    label: 'Run script', group: 'action', element: false, icon: 'M5.5 4.5L2.5 8l3 3.5M10.5 4.5L13.5 8l-3 3.5',
    fields: [
      { key: 'value', label: 'JavaScript', kind: 'code', placeholder: 'return document.title;' },
      { key: 'saveAs', label: 'Save as', kind: 'text', placeholder: 'title' },
    ],
  },
  apiRequest: {
    label: 'API request', group: 'api', element: false, icon: 'M8 1.5v13M1.5 8h13',
    fields: [
      { key: 'method', label: 'Method', kind: 'select', options: METHODS },
      { key: 'url', label: 'URL', kind: 'text', placeholder: 'https://api.example.com/login' },
      { key: 'headers', label: 'Headers', kind: 'code', placeholder: '{ "Authorization": "Bearer {{token}}" }' },
      { key: 'body', label: 'Body', kind: 'code', placeholder: '{ "user": "{{user}}" }' },
      { key: 'capture', label: 'Capture path', kind: 'text', placeholder: 'data.token' },
      { key: 'saveAs', label: 'Save as', kind: 'text', placeholder: 'token' },
    ],
  },
  assertStatus: {
    label: 'Assert status', group: 'api', element: false, icon: 'M3 8.5l3 3 7-7',
    fields: [{ key: 'value', label: 'Status', kind: 'number', placeholder: '200' }],
  },
  assertJsonPath: {
    label: 'Assert JSON path', group: 'api', element: false, icon: 'M5 2.5C3.5 2.5 3.5 8 2 8c1.5 0 1.5 5.5 3 5.5M11 2.5c1.5 0 1.5 5.5 3 5.5-1.5 0-1.5 5.5-3 5.5',
    fields: [
      { key: 'value', label: 'Path', kind: 'text', placeholder: 'data.items.0.id' },
      { key: 'value2', label: 'Expected', kind: 'text' },
      { key: 'saveAs', label: 'Save as', kind: 'text' },
    ],
  },
};

export const VERB_IDS = Object.keys(VERBS);

export function verbOf(step) {
  return VERBS[step?.verb] || VERBS.click;
}

/* ── factories ────────────────────────────────────────────────────────── */

export function newElement(patch = {}) {
  return { id: `el-${uid()}`, name: 'New element', strategy: 'css', value: '', ...patch };
}

export function newStep(verb = 'click', patch = {}) {
  const step = { id: `st-${uid()}`, verb, element: null, enabled: true };
  if (verb === 'apiRequest') step.method = 'GET';
  if (verb === 'assertText' || verb === 'assertUrl') step.match = 'contains';
  if (verb === 'waitForElement') step.timeout = 10000;
  return { ...step, ...patch };
}

export function newCase(patch = {}) {
  return {
    id: `tc-${uid()}`,
    name: 'New case',
    steps: [],
    dataset: [],
    continueOnFailure: false,
    ...patch,
  };
}

export function newSuite(patch = {}) {
  return { id: `ts-${uid()}`, name: 'New suite', cases: [], ...patch };
}

export function emptyProject() {
  return { version: 1, suites: [] };
}

/* ── lookups and shaping ──────────────────────────────────────────────── */

export function findCase(project, caseId) {
  for (const suite of project.suites) {
    const hit = suite.cases.find((c) => c.id === caseId);
    if (hit) return { suite, testCase: hit };
  }
  return null;
}

export function findSuite(project, suiteId) {
  return project.suites.find((s) => s.id === suiteId) || null;
}

export function resolveElement(elements, id) {
  return elements.find((e) => e.id === id) || null;
}

/** Column names across every dataset row, union-style, so a ragged set still edits. */
export function datasetColumns(testCase) {
  const cols = [];
  for (const row of testCase.dataset || []) {
    for (const key of Object.keys(row || {})) if (!cols.includes(key)) cols.push(key);
  }
  return cols;
}

const TOKEN = /\{\{\s*([\w$.-]+)\s*\}\}/g;

/** Every {{token}} a case depends on — used to warn about columns that do not exist. */
export function tokensIn(testCase) {
  const found = new Set();
  const scan = (v) => {
    if (typeof v !== 'string') return;
    for (const m of v.matchAll(TOKEN)) found.add(m[1]);
  };
  for (const step of testCase.steps || []) {
    for (const value of Object.values(step)) scan(value);
  }
  return [...found];
}

export function move(list, from, to) {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/** A one-line human summary of a step, for the collapsed row. */
export function describeStep(step, elements) {
  const el = step.element ? resolveElement(elements, step.element) : null;
  const target = el ? el.name : step.element ? '⚠ missing element' : '';
  switch (step.verb) {
    case 'navigate': return step.value || '(no url)';
    case 'wait': return `${step.value || 0} ms`;
    case 'type': return `${target} ← "${step.value || ''}"`;
    case 'select': return `${target} ← ${step.value || ''}`;
    case 'assertText': return `${target} ${step.match === 'equals' ? '=' : '⊃'} "${step.value || ''}"`;
    case 'assertUrl': return `url ${step.match === 'equals' ? '=' : '⊃'} "${step.value || ''}"`;
    case 'assertAttribute': return `${target} @${step.value || ''} = "${step.value2 || ''}"`;
    case 'assertStatus': return `status = ${step.value || ''}`;
    case 'assertJsonPath': return `${step.value || ''}${step.value2 ? ` = "${step.value2}"` : ''}`;
    case 'apiRequest': return `${(step.method || 'GET').toUpperCase()} ${step.url || ''}`;
    case 'screenshot': return step.value || 'screenshot';
    case 'script': return (step.value || '').split('\n')[0].slice(0, 60);
    default: return target;
  }
}

/* ── persistence ──────────────────────────────────────────────────────── */

export function novaPath(root, file) {
  return joinPath(root, NOVA_DIR, file);
}

async function readJson(root, file, fallback) {
  try {
    const res = await window.nova.fs.readFile(novaPath(root, file));
    if (!res || !res.content) return fallback;
    const parsed = JSON.parse(res.content);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    // A missing or malformed file is the normal first-run state, not an error.
    return fallback;
  }
}

async function writeJson(root, file, data) {
  await window.nova.fs.writeFile(novaPath(root, file), `${JSON.stringify(data, null, 2)}\n`);
}

export async function loadElements(root) {
  const data = await readJson(root, ELEMENTS_FILE, { version: 1, elements: [] });
  return Array.isArray(data) ? data : (data.elements || []);
}

export function saveElements(root, elements) {
  return writeJson(root, ELEMENTS_FILE, { version: 1, elements });
}

export async function loadProject(root) {
  const data = await readJson(root, TESTS_FILE, emptyProject());
  const suites = Array.isArray(data.suites) ? data.suites : [];
  // Normalise on read so hand-edited JSON cannot crash the renderer later.
  return {
    version: 1,
    suites: suites.map((s) => ({
      ...newSuite(),
      ...s,
      cases: (Array.isArray(s.cases) ? s.cases : []).map((c) => ({
        ...newCase(),
        ...c,
        steps: (Array.isArray(c.steps) ? c.steps : []).map((st) => ({ ...newStep(st.verb || 'click'), ...st })),
        dataset: Array.isArray(c.dataset) ? c.dataset : [],
      })),
    })),
  };
}

export function saveProject(root, project) {
  return writeJson(root, TESTS_FILE, { version: 1, suites: project.suites });
}

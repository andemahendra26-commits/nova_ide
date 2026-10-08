import { bus } from '../core/bus.js';
import { $, el, svg, clear, uid, debounce, escapeHtml } from '../core/util.js';
import { getState } from '../core/state.js';
import * as host from '../editor/host.js';

let viewEl = null;
let resultsEl = null;
let summaryEl = null;
let queryInput = null;

let token = null;
let opts = { caseSensitive: false, wholeWord: false, regex: false };
let totals = { files: 0, matches: 0 };

export function init() {
  viewEl = $('#view-search');
  clear(viewEl);

  queryInput = el('input', { placeholder: 'Search', spellcheck: 'false' });

  const toggles = el('div', { class: 'search-toggles' }, [
    toggle('Aa', 'Match case', 'caseSensitive'),
    toggle('ab', 'Match whole word', 'wholeWord'),
    toggle('.*', 'Use regular expression', 'regex'),
  ]);

  const form = el('div', { class: 'search-form' }, [
    el('div', { class: 'search-field' }, [queryInput, toggles]),
  ]);

  summaryEl = el('div', { class: 'search-summary' });
  resultsEl = el('div', { class: 'search-results' });

  viewEl.append(form, summaryEl, resultsEl);

  const debounced = debounce(() => run(), 260);
  queryInput.addEventListener('input', debounced);
  queryInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') run();
    if (e.key === 'Escape') {
      queryInput.value = '';
      run();
    }
  });

  window.nova.search.onResult(onResult);
  window.nova.search.onDone(onDone);

  bus.on('state:workspace', () => {
    clear(resultsEl);
    summaryEl.textContent = '';
    totals = { files: 0, matches: 0 };
    bus.emit('search:count', { matches: 0 });
  });

  summaryEl.textContent = 'Type to search across the workspace.';
}

function toggle(label, title, key) {
  const node = el('button', { class: 'search-toggle', title, text: label });
  node.addEventListener('click', () => {
    opts[key] = !opts[key];
    node.classList.toggle('on', opts[key]);
    run();
  });
  return node;
}

export function focus(seed) {
  if (seed !== undefined) queryInput.value = seed;
  requestAnimationFrame(() => {
    queryInput.focus();
    queryInput.select();
  });
  if (seed) run();
}

async function run() {
  const root = getState().workspace?.root;
  const query = queryInput.value;

  if (token) window.nova.search.cancel(token);
  clear(resultsEl);
  totals = { files: 0, matches: 0 };
  bus.emit('search:count', { matches: 0 });

  if (!root) {
    summaryEl.textContent = 'Open a folder to search.';
    return;
  }
  if (!query) {
    summaryEl.textContent = 'Type to search across the workspace.';
    return;
  }

  token = uid();
  summaryEl.innerHTML = '<span style="color:var(--accent)">Searching…</span>';

  try {
    await window.nova.search.run({ token, root, query, ...opts });
  } catch (err) {
    summaryEl.textContent = err.message;
  }
}

function onResult(payload) {
  if (payload.token !== token) return;

  totals.files++;
  totals.matches += payload.hits.length;
  bus.emit('search:count', { matches: totals.matches });

  const { file, hits } = payload;
  const dir = file.rel.split(/[\\/]/).slice(0, -1).join('/');

  const group = el('div', { class: 'sr-group' });
  let collapsed = false;

  const header = el('div', { class: 'sr-file' }, [
    svg('M6 3.5L10.5 8 6 12.5', 11, { width: 1.4 }),
    el('span', { class: 'sr-name', text: file.name }),
    el('span', { class: 'sr-dir', text: dir }),
    el('span', { class: 'sr-count', text: String(hits.length) }),
  ]);
  const chevron = header.firstChild;
  chevron.style.transition = 'transform var(--d-fast)';
  chevron.style.transform = 'rotate(90deg)';

  const body = el('div');
  for (const hit of hits) {
    body.append(
      el('div', {
        class: 'sr-hit',
        title: `Line ${hit.line}`,
        html: renderHit(hit),
        onclick: () => host.openFile(file.path, { line: hit.line, column: hit.column, flash: true }),
      })
    );
  }

  header.addEventListener('click', () => {
    collapsed = !collapsed;
    body.hidden = collapsed;
    chevron.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(90deg)';
  });

  group.append(header, body);
  resultsEl.append(group);
}

function renderHit(hit) {
  const text = hit.preview;
  const start = hit.column - 1;
  const end = start + hit.length;

  // Keep the match visible in a long line by windowing around it.
  let from = 0;
  let prefix = '';
  if (start > 34) {
    from = start - 28;
    prefix = '… ';
  }
  const slice = text.slice(from, from + 150);
  const s = start - from;
  const e = end - from;

  if (s < 0 || e > slice.length) return escapeHtml(prefix + slice.trimEnd());
  return (
    escapeHtml(prefix + slice.slice(0, s)) +
    '<mark>' +
    escapeHtml(slice.slice(s, e)) +
    '</mark>' +
    escapeHtml(slice.slice(e).trimEnd())
  );
}

function onDone(payload) {
  if (payload.token !== token) return;
  if (totals.matches === 0) {
    summaryEl.textContent = 'No results found.';
    return;
  }
  const capped = payload.cancelled ? ' (stopped)' : '';
  summaryEl.textContent = `${totals.matches} result${totals.matches === 1 ? '' : 's'} in ${totals.files} file${totals.files === 1 ? '' : 's'}${capped}`;
}

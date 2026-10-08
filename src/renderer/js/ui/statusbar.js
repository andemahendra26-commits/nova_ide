import { bus } from '../core/bus.js';
import { $, el, svg, clear } from '../core/util.js';
import { getState } from '../core/state.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { ALL_LANGUAGES } from '../editor/languages.js';
import * as commands from '../core/commands.js';
import * as ctx from './contextmenu.js';

let left = null;
let right = null;
const cursor = { line: 1, column: 1, selected: 0, selections: 1 };

export function init() {
  left = $('#st-left');
  right = $('#st-right');

  bus.on('editor:cursor', (c) => {
    Object.assign(cursor, c);
    render();
  });
  bus.on('editor:selection', ({ selected }) => {
    cursor.selected = selected;
    render();
  });
  bus.on('file:activated', render);
  bus.on('file:none', render);
  bus.on('state:workspace', render);
  bus.on('settings:change', render);
  bus.on('agent:status', render);
  bus.on('agent:phase', render);
  bus.on('test:summary', render);

  render();
}

function item(opts) {
  const node = el('div', {
    class: 'st-item',
    title: opts.title || '',
    dataset: opts.onclick ? { clickable: 'true' } : {},
    onclick: opts.onclick,
  });
  if (opts.icon) node.append(svg(opts.icon, 12, { width: 1.3 }));
  if (opts.text !== undefined) node.append(el('span', { text: opts.text }));
  if (opts.color) node.style.color = opts.color;
  return node;
}

function render() {
  const s = getState();
  const settings = getSettings();
  const file = s.files.active ? s.files.open.get(s.files.active) : null;

  clear(left);
  clear(right);

  /* ── left ── */
  left.append(
    item({
      icon: 'M2 3.2h4.2l1.3 1.6H14v7.9H2z',
      text: s.workspace ? s.workspace.name : 'No Folder',
      title: s.workspace?.root || 'Open a folder',
      onclick: () => commands.run('workspace.open'),
    })
  );

  const agentLabel =
    s.agent.status === 'running' ? s.agent.phase || 'working' : s.agent.status === 'error' ? 'error' : 'ready';
  const agentColor =
    s.agent.status === 'running'
      ? 'var(--accent)'
      : s.agent.status === 'error'
        ? 'var(--danger)'
        : 'var(--fg-muted)';

  const agentItem = item({
    text: `Nova · ${agentLabel}`,
    title: 'Agent status',
    color: agentColor,
    onclick: () => commands.run('agent.focus'),
  });
  agentItem.prepend(
    el('span', {
      style: {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: agentColor,
        boxShadow: s.agent.status === 'running' ? '0 0 7px var(--accent-glow)' : 'none',
        animation: s.agent.status === 'running' ? 'pulse-soft 1s var(--ease-in-out) infinite' : 'none',
        flex: '0 0 auto',
      },
    })
  );
  left.append(agentItem);

  const summary = getState().testSummary;
  if (summary) {
    left.append(
      item({
        icon: 'M3.5 8.5l3 3 6-6',
        text: `${summary.passed}/${summary.total} passed`,
        color: summary.failed > 0 ? 'var(--danger)' : 'var(--success)',
        title: 'Last test run',
        onclick: () => commands.run('view.tests'),
      })
    );
  }

  /* ── right ── */
  if (file) {
    right.append(
      item({
        text:
          cursor.selected > 0
            ? `Ln ${cursor.line}, Col ${cursor.column} (${cursor.selected} selected)`
            : `Ln ${cursor.line}, Col ${cursor.column}`,
        title: 'Go to line',
        onclick: () => commands.run('edit.gotoLine'),
      })
    );

    right.append(
      item({
        text: `Spaces: ${settings.tabSize}`,
        title: 'Select indentation size',
        onclick: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          ctx.show(
            r.left - 60,
            r.top - 150,
            [1, 2, 4, 8].map((n) => ({
              label: `Spaces: ${n}${n === settings.tabSize ? '  ✓' : ''}`,
              run: () => updateSettings({ tabSize: n }),
            }))
          );
        },
      })
    );

    right.append(item({ text: 'UTF-8', title: 'Encoding' }));

    right.append(
      item({
        text: file.language,
        title: 'Select language mode',
        onclick: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          ctx.show(
            r.left - 60,
            Math.max(40, r.top - 340),
            ALL_LANGUAGES.slice(0, 22).map((lang) => ({
              label: lang === file.language ? `${lang}  ✓` : lang,
              run: () => {
                const monaco = window.monaco;
                monaco.editor.setModelLanguage(file.model, lang);
                file.language = lang;
                render();
              },
            }))
          );
        },
      })
    );
  }

  right.append(
    item({
      icon: ['M8 1.5l1.5 4.3 4.3 1.5-4.3 1.5L8 13.1 6.5 8.8 2.2 7.3l4.3-1.5z'],
      title: 'Toggle agent panel',
      onclick: () => commands.run('view.toggleAgent'),
    })
  );

  right.append(
    item({
      icon: ['M8 10.1a2.1 2.1 0 100-4.2 2.1 2.1 0 000 4.2z', 'M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7'],
      title: 'Settings',
      onclick: () => commands.run('view.settings'),
    })
  );
}

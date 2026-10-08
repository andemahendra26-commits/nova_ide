import { bus } from '../core/bus.js';
import { $, el, clear } from '../core/util.js';
import { getSettings, updateSettings, THEMES } from '../core/settings.js';

let viewEl = null;

export function init() {
  viewEl = $('#view-settings');
  render();
  bus.on('settings:change', ({ patch }) => {
    // Re-render only for changes that alter the form's own shape; re-rendering
    // on every keystroke would fight the user's cursor in the text inputs.
    if ('theme' in patch || 'agentProvider' in patch || 'reducedMotion' in patch) render();
  });
}

function render() {
  clear(viewEl);
  const s = getSettings();
  const box = el('div', { class: 'settings' });

  /* ── Appearance ── */
  box.append(
    group('Appearance', [
      el('div', { class: 'theme-grid' },
        THEMES.map((t) =>
          el('div', {
            class: `theme-card${s.theme === t.id ? ' on' : ''}`,
            onclick: () => updateSettings({ theme: t.id }),
          }, [
            el('div', { class: 'tc-swatches' },
              t.swatches.map((c) => el('div', { class: 'tc-sw', style: { background: c } }))
            ),
            el('div', { class: 'tc-name', text: t.name }),
          ])
        )
      ),
    ])
  );

  /* ── Editor ── */
  box.append(
    group('Editor', [
      row('Font size', number(s.fontSize, 10, 28, (v) => updateSettings({ fontSize: v }))),
      row('Font family', text(s.fontFamily, (v) => updateSettings({ fontFamily: v }), true)),
      row('Tab size', select(String(s.tabSize), ['1', '2', '4', '8'], (v) => updateSettings({ tabSize: Number(v) }))),
      row('Word wrap', sw(s.wordWrap, (v) => updateSettings({ wordWrap: v }))),
      row('Minimap', sw(s.minimap, (v) => updateSettings({ minimap: v }))),
      row('Line numbers', sw(s.lineNumbers, (v) => updateSettings({ lineNumbers: v }))),
    ])
  );

  /* ── Motion ── */
  box.append(
    group('Motion', [
      row(
        'Animation speed',
        range(s.animationSpeed, 0.25, 2, 0.25, (v) => updateSettings({ animationSpeed: v }), `${s.animationSpeed}×`),
        'Higher is faster. Affects every transition in the interface.'
      ),
      row(
        'Reduced motion',
        sw(s.reducedMotion, (v) => updateSettings({ reducedMotion: v })),
        'Disables decorative animation and suspends the thinking canvas.'
      ),
    ])
  );

  /* ── Agent ── */
  const providerRow = row(
    'Provider',
    select(
      s.agentProvider,
      [
        { value: 'engine', label: 'Nova Engine (offline)' },
        { value: 'claude', label: 'Claude API' },
      ],
      (v) => updateSettings({ agentProvider: v })
    ),
    s.agentProvider === 'claude'
      ? 'Streams from the real model using your key.'
      : 'Deterministic local generator. Works with no network and no key.'
  );

  const agentItems = [
    providerRow,
    row(
      'Typing speed',
      range(s.agentTypingSpeed, 20, 400, 10, (v) => updateSettings({ agentTypingSpeed: v }), `${s.agentTypingSpeed}/s`),
      'Characters per second while the agent writes into the editor.'
    ),
  ];

  if (s.agentProvider === 'claude') {
    agentItems.push(
      row(
        'API key',
        password(s.apiKey, (v) => updateSettings({ apiKey: v })),
        'Stored locally in your user data folder. Sent only to api.anthropic.com.'
      )
    );
  }

  box.append(group('Agent', agentItems));

  /* ── About ── */
  const about = el('div', { class: 'set-group' }, [
    el('h4', { text: 'About' }),
    el('div', { style: { fontSize: 'var(--fs-sm)', color: 'var(--fg-subtle)', lineHeight: '1.7' }, id: 'about-box', text: 'Loading…' }),
  ]);
  box.append(about);

  viewEl.append(box);

  // Stagger the groups in.
  [...box.children].forEach((g, i) => (g.style.animationDelay = `${i * 40}ms`));

  window.nova.app.info().then((info) => {
    const target = $('#about-box');
    if (!target) return;
    clear(target);
    target.append(
      el('div', { text: `Nova IDE ${info.version}` }),
      el('div', { text: `Electron ${info.electron} · Chromium ${info.chrome}` }),
      el('div', { text: `Node ${info.node} · ${info.platform}` })
    );
  }).catch(() => { /* the about box is decorative; never toast for it */ });
}

/* ── Field builders ───────────────────────────────────────────────────── */

function group(title, children) {
  return el('div', { class: 'set-group' }, [el('h4', { text: title }), ...children]);
}

function row(label, control, hint) {
  return el('div', { class: 'set-row' }, [
    el('label', {}, [el('span', { text: label }), hint && el('span', { class: 'set-hint', text: hint })].filter(Boolean)),
    control,
  ]);
}

function sw(value, onChange) {
  const node = el('div', { class: `switch${value ? ' on' : ''}` });
  node.addEventListener('click', () => {
    const next = !node.classList.contains('on');
    node.classList.toggle('on', next);
    onChange(next);
  });
  return node;
}

function number(value, min, max, onChange) {
  const node = el('input', { class: 'set-input', type: 'number', min, max, value });
  node.style.minWidth = '70px';
  node.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, Number(node.value) || min));
    node.value = v;
    onChange(v);
  });
  node.addEventListener('keydown', (e) => e.stopPropagation());
  return node;
}

function text(value, onChange, wide) {
  const node = el('input', { class: `set-input${wide ? ' wide' : ''}`, type: 'text', value, spellcheck: 'false' });
  node.addEventListener('change', () => onChange(node.value));
  node.addEventListener('keydown', (e) => e.stopPropagation());
  return node;
}

function password(value, onChange) {
  const node = el('input', {
    class: 'set-input wide',
    type: 'password',
    value,
    placeholder: 'sk-ant-…',
    spellcheck: 'false',
  });
  node.addEventListener('change', () => onChange(node.value.trim()));
  node.addEventListener('keydown', (e) => e.stopPropagation());
  return node;
}

function select(value, options, onChange) {
  const node = el('select', { class: 'set-select' });
  for (const opt of options) {
    const { value: v, label } = typeof opt === 'string' ? { value: opt, label: opt } : opt;
    const o = el('option', { value: v, text: label });
    if (v === value) o.selected = true;
    node.append(o);
  }
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function range(value, min, max, step, onChange, labelText) {
  const label = el('span', {
    text: labelText,
    style: { fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', minWidth: '38px', textAlign: 'right' },
  });
  const node = el('input', { type: 'range', min, max, step, value, style: { width: '110px' } });
  node.addEventListener('input', () => {
    label.textContent = String(node.value);
  });
  node.addEventListener('change', () => onChange(Number(node.value)));
  return el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [node, label]);
}

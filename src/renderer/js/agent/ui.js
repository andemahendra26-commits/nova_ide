import { bus } from '../core/bus.js';
import { $, el, svg, clear, formatBytes, basename } from '../core/util.js';
import { getState, setState } from '../core/state.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { ThinkingCanvas } from '../viz/thinking.js';
import { mountMascot } from '../viz/mascot.js';
import { PHASES } from './orchestrator.js';
import * as orchestrator from './orchestrator.js';
import * as host from '../editor/host.js';

const CHIPS = [
  'Create a React pricing card component',
  'Build an Express REST server',
  'Write a Python CLI that parses a file',
  'Generate a landing page',
  'Write a test suite',
  'Create a README',
];

let canvas = null;
let transcript = null;
let inputEl = null;
let thoughtsEl = null;
let timerId = null;
let startedAt = 0;
let currentPlanEl = null;
let liveThought = null;
let mascot = null;

export function init() {
  transcript = $('#ag-transcript');
  inputEl = $('#ag-input');
  thoughtsEl = $('#ag-thoughts');

  canvas = new ThinkingCanvas($('#think-canvas'));
  mascot = mountMascot($('#agent-mascot'), { scale: 0.52 });

  renderPhases();
  renderChips();
  greet();

  /* ── composer ── */
  inputEl.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  inputEl.addEventListener('input', autoGrow);
  $('#ag-send').addEventListener('click', submit);
  $('#ag-stop').addEventListener('click', () => orchestrator.stop());
  $('#ag-clear').addEventListener('click', clearConversation);

  $('#ag-provider').addEventListener('click', () => {
    const next = getSettings().agentProvider === 'engine' ? 'claude' : 'engine';
    updateSettings({ agentProvider: next });
  });

  /* ── orchestrator events ── */
  bus.on('agent:start', onStart);
  bus.on('agent:phase', onPhase);
  bus.on('agent:understood', onUnderstood);
  bus.on('agent:thoughtStart', onThoughtStart);
  bus.on('agent:thoughtChar', onThoughtChar);
  bus.on('agent:thoughtEnd', onThoughtEnd);
  bus.on('agent:plan', onPlan);
  bus.on('agent:planStep', onPlanStep);
  bus.on('agent:writing', onWriting);
  bus.on('agent:artifact', onArtifact);
  bus.on('agent:review', onReview);
  bus.on('agent:reply', onReply);
  bus.on('agent:done', onDone);
  bus.on('agent:stopped', onStopped);
  bus.on('agent:error', onError);
  bus.on('agent:tokens', ({ tokens }) => ($('#tel-tokens').textContent = String(tokens)));

  bus.on('settings:change', ({ patch }) => {
    if ('agentProvider' in patch) {
      $('#ag-provider').textContent = patch.agentProvider === 'claude' ? 'claude' : 'engine';
    }
    if ('theme' in patch) canvas.readAccent();
  });

  $('#ag-provider').textContent = getSettings().agentProvider === 'claude' ? 'claude' : 'engine';
}

export function focusInput() {
  setState({ ui: { agentOpen: true } });
  requestAnimationFrame(() => inputEl.focus());
}

function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 128)}px`;
}

function submit() {
  const text = inputEl.value.trim();
  if (!text || orchestrator.isRunning()) return;
  inputEl.value = '';
  autoGrow();
  orchestrator.send(text);
}

/* ── Rendering ────────────────────────────────────────────────────────── */

function renderPhases() {
  const rail = $('#ag-phases');
  clear(rail);
  for (const phase of PHASES) {
    rail.append(
      el('div', { class: 'ph', dataset: { phase } }, [
        el('span', { class: 'ph-dot' }),
        el('span', { class: 'ph-label', text: phase.slice(0, 5) }),
      ])
    );
  }
}

function renderChips() {
  const host2 = $('#ag-chips');
  clear(host2);
  // Rotate a subset so the panel does not look identical every launch.
  const picks = [...CHIPS].sort(() => Math.random() - 0.5).slice(0, 3);
  picks.forEach((c, i) => {
    const chip = el('div', {
      class: 'chip',
      text: c.length > 30 ? c.slice(0, 29) + '…' : c,
      title: c,
      onclick: () => {
        inputEl.value = c;
        autoGrow();
        inputEl.focus();
      },
    });
    chip.style.animationDelay = `${i * 60}ms`;
    host2.append(chip);
  });
}

function greet() {
  add(
    el('div', { class: 'msg nova' }, [
      el('div', { class: 'm-head', text: 'Nova' }),
      el('div', {
        html:
          'I can scaffold real files into your workspace — React components, Express servers, Python CLIs, pages, tests, docs. ' +
          'Watch the panel above while I work: you will see me think, plan, then type the code into the editor.',
      }),
    ])
  );
}

function add(node) {
  transcript.append(node);
  transcript.scrollTop = transcript.scrollHeight;
  return node;
}

function setPhaseUI(phase) {
  const agent = $('#agent');
  agent.dataset.phase = phase || '';
  agent.dataset.busy = String(orchestrator.isRunning());

  const order = PHASES.indexOf(phase);
  for (const node of document.querySelectorAll('.ph')) {
    const idx = PHASES.indexOf(node.dataset.phase);
    node.classList.toggle('active', node.dataset.phase === phase);
    node.classList.toggle('done', order >= 0 && idx < order);
  }

  $('#tel-phase').textContent = phase || 'idle';
  canvas.setPhase(phase || 'idle');
  mascot?.setPhase(phase);

  // The mascot stays on screen through the whole run; only the "ready" framing
  // is idle-only, so it shrinks into the corner while work is happening.
  const idleBox = $('#ag-viz-idle');
  idleBox.hidden = false;
  idleBox.classList.toggle('working', !!phase);
}

/* ── Event handlers ───────────────────────────────────────────────────── */

function onStart({ run }) {
  add(el('div', { class: 'msg user', text: run.request }));

  clear(thoughtsEl);
  currentPlanEl = null;

  $('#ag-telemetry').hidden = false;
  $('#ag-send').disabled = true;
  $('#tel-tokens').textContent = '0';

  startedAt = Date.now();
  clearInterval(timerId);
  timerId = setInterval(() => {
    $('#tel-time').textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  }, 100);
}

function onPhase({ phase }) {
  setPhaseUI(phase);
}

function onUnderstood({ ctx }) {
  add(
    el('div', { class: 'msg nova' }, [
      el('div', { class: 'm-head', text: 'Understanding' }),
      el('div', { text: ctx.summary }),
    ])
  );
}

function onThoughtStart({ id }) {
  // Keep the visible stack short; older lines drift up and out.
  const existing = [...thoughtsEl.children];
  if (existing.length >= 4) {
    const oldest = existing[0];
    oldest.classList.add('fading');
    setTimeout(() => oldest.remove(), 900);
  }
  thoughtsEl.querySelectorAll('.thought.latest').forEach((n) => n.classList.remove('latest'));
  liveThought = el('div', { class: 'thought latest', dataset: { id } }, [
    el('span', { class: 'th-text' }),
    el('span', { class: 'th-cursor' }),
  ]);
  thoughtsEl.append(liveThought);
  canvas.pulse();
  mascot?.react('nod');
}

function onThoughtChar({ text }) {
  if (liveThought) liveThought.querySelector('.th-text').textContent = text;
}

function onThoughtEnd({ text }) {
  if (!liveThought) return;
  liveThought.querySelector('.th-cursor')?.remove();
  liveThought.querySelector('.th-text').textContent = text;
  liveThought = null;
  canvas.pulse();
}

function onPlan({ steps }) {
  const board = el('div', { class: 'plan' }, [el('div', { class: 'plan-title', text: 'Plan' })]);
  steps.forEach((step, i) => {
    const node = el('div', { class: 'step', dataset: { index: String(i) } }, [
      el('span', { class: 'step-box' }, [svg('M2.5 5l2 2 4-4', 10, { width: 1.8, viewBox: '0 0 11 11' })]),
      el('span', { class: 'step-label', text: step.label }),
    ]);
    node.style.animationDelay = `${i * 90}ms`;
    board.append(node);
  });
  currentPlanEl = add(el('div', { class: 'msg nova' }, [board]));
}

function onPlanStep({ index, done }) {
  if (!currentPlanEl) return;
  const steps = [...currentPlanEl.querySelectorAll('.step')];
  steps.forEach((node, i) => {
    node.classList.toggle('active', i === index && !done);
    node.classList.toggle('done', done ? i <= index : i < index);
  });
}

function onWriting({ name }) {
  add(
    el('div', { class: 'msg nova' }, [
      el('div', { class: 'm-head', text: 'Writing' }),
      el('div', { html: `Typing into <code>${name}</code>…` }),
    ])
  );
}

function onArtifact({ path, name, bytes }) {
  add(
    el('div', {
      class: 'artifact',
      title: path,
      onclick: () => host.openFile(path),
    }, [
      el('span', { class: 'af-icon', text: (name.split('.').pop() || '?').slice(0, 3).toUpperCase() }),
      el('div', { class: 'af-body' }, [
        el('div', { class: 'af-name', text: name }),
        el('div', { class: 'af-meta', text: formatBytes(bytes) }),
      ]),
      svg('M6 3.5L10.5 8 6 12.5', 13),
    ])
  );
}

function onReply({ reply }) {
  add(
    el('div', { class: 'msg nova' }, [
      el('div', { class: 'm-head', text: 'Nova' }),
      el('div', { text: reply.text }),
      reply.hint
        ? el('div', {
            class: 'm-hint',
            text: reply.hint,
            onclick: () => {
              inputEl.value = reply.hint.replace(/^(Try|For example):\s*/i, '').replace(/^["“]|["”]$/g, '');
              autoGrow();
              inputEl.focus();
            },
          })
        : null,
    ])
  );
}

function onReview({ result }) {
  add(
    el('div', { class: 'msg nova' }, [
      el('div', { class: 'm-head', text: 'Review' }),
      el('div', { text: result.summary }),
      el('div', { style: { color: 'var(--fg-muted)', marginTop: '3px' }, text: result.note }),
    ])
  );
}

function onDone({ conversational }) {
  finishRun();

  // Small talk gets no stopwatch and no victory dance — it was a reply, not a build.
  if (conversational) {
    setPhaseUI(null);
    return;
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  add(el('div', { class: 'msg system', text: `Completed in ${secs}s` }));
  // Let the cheer finish before everything settles back to idle.
  mascot?.setPhase('done');
  setTimeout(() => setPhaseUI(null), 3000);
  renderChips();
}

function onStopped() {
  finishRun();
  add(el('div', { class: 'msg system', text: 'Stopped. Partial work was kept.' }));
  setPhaseUI(null);
  mascot?.setPhase('error');
  setTimeout(() => mascot?.setPhase(null), 1800);
}

function onError({ error }) {
  finishRun();
  add(el('div', { class: 'msg error', text: error }));
  setPhaseUI(null);
  // The mascot keeps the fluster for a beat so the failure is legible.
  mascot?.setPhase('error');
  setTimeout(() => mascot?.setPhase(null), 2600);
}

function finishRun() {
  clearInterval(timerId);
  $('#ag-send').disabled = false;
  $('#ag-telemetry').hidden = true;
  $('#agent').dataset.busy = 'false';
  liveThought = null;
  setTimeout(() => clear(thoughtsEl), 1200);
}

function clearConversation() {
  orchestrator.stop();
  clear(transcript);
  clear(thoughtsEl);
  currentPlanEl = null;
  setPhaseUI(null);
  greet();
  renderChips();
}

export { clearConversation };

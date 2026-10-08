import { bus } from '../core/bus.js';
import { $, $$ } from '../core/util.js';
import { getState, setState } from '../core/state.js';

const LIMITS = {
  sidebar: { min: 170, max: 620 },
  agent: { min: 260, max: 760 },
  panel: { min: 90, max: 0.75 },   // max is a fraction of window height
};

export function init() {
  for (const node of $$('.resizer')) {
    node.addEventListener('mousedown', (e) => start(e, node));
  }
  bus.on('state:ui', apply);
  window.addEventListener('resize', apply);
  apply();
}

function start(e, node) {
  e.preventDefault();
  const target = node.dataset.target;
  const vertical = target === 'panel';
  const ui = getState().ui;

  const startPos = vertical ? e.clientY : e.clientX;
  const startSize =
    target === 'sidebar' ? ui.sidebarWidth : target === 'agent' ? ui.agentWidth : ui.panelHeight;

  node.classList.add('dragging');
  document.body.classList.add(vertical ? 'resizing-v' : 'resizing');

  const onMove = (ev) => {
    const delta = (vertical ? ev.clientY : ev.clientX) - startPos;
    // The sidebar grows rightward, the agent panel and the terminal grow the
    // other way, so their deltas are inverted.
    const raw = target === 'sidebar' ? startSize + delta : startSize - delta;
    const lim = LIMITS[target];
    const max = lim.max <= 1 ? window.innerHeight * lim.max : lim.max;
    const size = Math.round(Math.max(lim.min, Math.min(max, raw)));

    if (target === 'sidebar') setState({ ui: { sidebarWidth: size, sidebarOpen: true } });
    else if (target === 'agent') setState({ ui: { agentWidth: size, agentOpen: true } });
    else setState({ ui: { panelHeight: size } });
  };

  const onUp = () => {
    node.classList.remove('dragging');
    document.body.classList.remove('resizing', 'resizing-v');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    bus.emit('layout:resized');
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/** Push layout state into the CSS custom properties that drive the grid. */
export function apply() {
  const ui = getState().ui;
  const body = $('#body');
  const app = $('#app');
  if (!body) return;

  body.style.setProperty('--sidebar-w', `${ui.sidebarWidth}px`);
  body.style.setProperty('--agent-w', `${ui.agentWidth}px`);
  body.dataset.sidebar = ui.sidebarOpen ? 'open' : 'closed';
  body.dataset.agent = ui.agentOpen ? 'open' : 'closed';

  const panel = $('#panel');
  if (panel) {
    panel.hidden = !ui.panelOpen;
    panel.style.setProperty('--panel-h', `${ui.panelHeight}px`);
  }
  $('#rz-panel').style.display = ui.panelOpen ? '' : 'none';

  app.dataset.zen = String(ui.zen);
}

import { bus } from './core/bus.js';
import { getState, setState } from './core/state.js';
import { loadSettings } from './core/settings.js';
import { $, joinPath } from './core/util.js';
import * as keymap from './core/keymap.js';
import * as commands from './core/commands.js';

import * as bootseq from './viz/bootseq.js';
import * as notifications from './ui/notifications.js';
import * as contextmenu from './ui/contextmenu.js';
import * as titlebar from './ui/titlebar.js';
import * as activitybar from './ui/activitybar.js';
import * as explorer from './ui/explorer.js';
import * as tabs from './ui/tabs.js';
import * as statusbar from './ui/statusbar.js';
import * as palette from './ui/palette.js';
import * as searchview from './ui/searchview.js';
import * as settingsview from './ui/settingsview.js';
import * as welcome from './ui/welcome.js';
import * as resizers from './ui/resizers.js';
import * as editorHost from './editor/host.js';
import * as terminal from './terminal/host.js';
import * as agentUI from './agent/ui.js';
import * as mcpBridge from './mcp/bridge.js';
import * as teststudio from './testing/studio.js';
import { defineCommands, openWorkspace } from './commands-def.js';

/**
 * Bootstrap. Order matters: commands before the keymap (the keymap indexes
 * them), UI before Monaco (so the shell paints while the editor loads), and the
 * boot animation covers the whole sequence.
 */

async function boot() {
  bootseq.start();
  bootseq.progress(0.06);

  await loadSettings();
  bootseq.progress(0.2);

  notifications.init();
  contextmenu.init();

  defineCommands();
  keymap.install();
  bootseq.progress(0.42);

  titlebar.init();
  activitybar.init();
  explorer.init();
  tabs.init();
  statusbar.init();
  palette.init();
  searchview.init();
  settingsview.init();
  welcome.init();
  teststudio.init($('#view-tests'));
  resizers.init();
  bootseq.progress(0.6);

  wireSidebar();
  wireGlobalEvents();

  agentUI.init();
  terminal.init();
  bootseq.progress(0.74);

  // Monaco is the slowest thing we load; the boot animation is what covers it.
  try {
    await editorHost.init($('#editor-host'));
  } catch (err) {
    notifications.show({
      type: 'error',
      title: 'Editor failed to load',
      message: `${err.message} — try running "npm run vendor".`,
      timeout: 0,
    });
  }
  bootseq.progress(0.94);

  await restoreLastFolder();

  // The MCP server is optional: if the port is taken the IDE is unaffected.
  mcpBridge.init().catch(() => {});

  bootseq.progress(1);
  bootseq.finish();

  // The command registry is complete now, so re-index bindings and repaint
  // anything that prints a shortcut.
  keymap.refresh();
  welcome.render();
}

/** Show the sidebar view that matches the current state. */
function wireSidebar() {
  const apply = () => {
    const view = getState().ui.sidebarView;
    for (const node of document.querySelectorAll('.sb-view')) {
      node.hidden = node.dataset.view !== view;
    }
    const titles = { explorer: 'Explorer', search: 'Search', settings: 'Settings', tests: 'Test Studio' };
    $('#sb-title').textContent = titles[view] || view;
    resizers.apply();
  };
  bus.on('state:ui', apply);
  bus.on('sidebar:view', apply);
  apply();
}

function wireGlobalEvents() {
  // The explorer emits command requests rather than importing the registry.
  bus.on('command', (id) => commands.run(id));
  bus.on('workspace:openPath', ({ path }) => openWorkspace(path));

  // Bridge the main-process file watcher onto the bus. Without this the
  // explorer never notices changes made outside the IDE (FE-6).
  window.nova.watch.onChange((payload) => bus.emit('watch:change', payload));

  // Breadcrumb segments reveal that folder in the explorer.
  bus.on('crumb:click', ({ index, parts }) => {
    const root = getState().workspace?.root;
    if (root) explorer.reveal(joinPath(root, ...parts.slice(0, index + 1))).catch(() => {});
  });

  // Drag a folder or file onto the window to open it (SH-6).
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const path = window.nova.pathFor ? window.nova.pathFor(file) : file.path;
    if (!path) return;
    const st = await window.nova.fs.stat(path);
    if (st.isDirectory) await openWorkspace(path);
    else await editorHost.openFile(path);
  });

  // Escape closes whatever transient surface is open, innermost first.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      if (palette.isOpen()) return; // the palette handles its own Escape
      if (contextmenu.isOpen()) contextmenu.close();
    },
    true
  );

  window.addEventListener('beforeunload', () => window.nova.watch.stop());
}

/** Reopen the most recent folder so a relaunch lands where the user left off. */
async function restoreLastFolder() {
  const recents = getState().settings.recentFolders || [];
  if (!recents.length) return;
  const last = recents[0];
  try {
    const st = await window.nova.fs.stat(last);
    if (st.exists && st.isDirectory) await openWorkspace(last);
  } catch {
    /* a folder that has moved is not an error worth surfacing at boot */
  }
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  bootseq.finish(true);
  const sub = $('#boot-sub');
  if (sub) sub.textContent = err.message;
  notifications.init();
  notifications.show({ type: 'error', title: 'Startup failed', message: err.message, timeout: 0 });
});

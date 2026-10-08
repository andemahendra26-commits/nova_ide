import { bus } from './core/bus.js';
import { registerAll } from './core/commands.js';
import { getState, setState } from './core/state.js';
import { getSettings, updateSettings, THEMES } from './core/settings.js';
import { joinPath, basename } from './core/util.js';
import * as host from './editor/host.js';
import * as palette from './ui/palette.js';
import * as explorer from './ui/explorer.js';
import * as searchview from './ui/searchview.js';
import * as activitybar from './ui/activitybar.js';
import * as terminal from './terminal/host.js';
import * as agentUI from './agent/ui.js';
import * as orchestrator from './agent/orchestrator.js';

/**
 * Every command in one place. The palette, the menu bar, the keymap, and the
 * context menus all read from this registry, so a command is defined once.
 */

const hasFile = () => !!getState().files.active;
const hasWorkspace = () => !!getState().workspace;

export function defineCommands() {
  registerAll([
    /* ── Workspace ── */
    {
      id: 'workspace.open',
      title: 'Open Folder…',
      category: 'File',
      keybinding: 'ctrl+k ctrl+o',
      run: async () => {
        const folder = await window.nova.dialog.openFolder();
        if (folder) await openWorkspace(folder.path);
      },
    },
    {
      id: 'workspace.close',
      title: 'Close Folder',
      category: 'File',
      when: hasWorkspace,
      run: async () => {
        if (!(await host.closeAll())) return;
        window.nova.watch.stop();
        setState({ workspace: null, fileIndex: [] });
      },
    },

    /* ── Files ── */
    {
      id: 'file.new',
      title: 'New File',
      category: 'File',
      keybinding: 'ctrl+n',
      run: async () => {
        const root = getState().workspace?.root;
        if (!root) {
          bus.emit('notify', { type: 'warn', title: 'No folder open', message: 'Open a folder first.' });
          return;
        }
        let name = 'untitled.js';
        let n = 1;
        while ((await window.nova.fs.stat(joinPath(root, name))).exists) name = `untitled-${++n}.js`;
        await window.nova.fs.writeFile(joinPath(root, name), '');
        await explorer.render();
        await host.openFile(joinPath(root, name));
      },
    },
    {
      id: 'file.open',
      title: 'Open File…',
      category: 'File',
      keybinding: 'ctrl+o',
      run: async () => {
        const picked = await window.nova.dialog.openFile();
        if (picked) await host.openFile(picked.path);
      },
    },
    { id: 'file.save', title: 'Save', category: 'File', keybinding: 'ctrl+s', when: hasFile, run: () => host.saveFile() },
    { id: 'file.saveAs', title: 'Save As…', category: 'File', keybinding: 'ctrl+shift+s', when: hasFile, run: () => host.saveAs() },
    {
      id: 'file.saveAll',
      title: 'Save All',
      category: 'File',
      keybinding: 'ctrl+k s',
      run: async () => {
        const n = await host.saveAll();
        bus.emit('notify', { type: 'success', title: 'Saved', message: `${n} file${n === 1 ? '' : 's'}` });
      },
    },
    { id: 'file.close', title: 'Close Editor', category: 'File', keybinding: 'ctrl+w', when: hasFile, run: () => host.closeFile() },
    { id: 'file.closeAll', title: 'Close All Editors', category: 'File', keybinding: 'ctrl+k w', run: () => host.closeAll() },

    /* ── Navigation ── */
    { id: 'palette.open', title: 'Command Palette…', category: 'View', keybinding: 'ctrl+shift+p', paletteHidden: true, run: () => palette.openCommands() },
    { id: 'quickopen.open', title: 'Go to File…', category: 'View', keybinding: 'ctrl+p', run: () => palette.openFiles() },
    { id: 'edit.gotoLine', title: 'Go to Line…', category: 'Edit', keybinding: 'ctrl+g', when: hasFile, run: () => palette.openLine() },
    {
      id: 'edit.find',
      title: 'Find',
      category: 'Edit',
      when: hasFile,
      run: () => host.getEditor()?.getAction('actions.find')?.run(),
    },
    {
      id: 'edit.replace',
      title: 'Replace',
      category: 'Edit',
      when: hasFile,
      run: () => host.getEditor()?.getAction('editor.action.startFindReplaceAction')?.run(),
    },
    {
      id: 'edit.format',
      title: 'Format Document',
      category: 'Edit',
      keybinding: 'shift+alt+f',
      when: hasFile,
      run: () => host.getEditor()?.getAction('editor.action.formatDocument')?.run(),
    },
    {
      id: 'search.openView',
      title: 'Find in Files',
      category: 'Search',
      keybinding: 'ctrl+shift+f',
      run: () => {
        setState({ ui: { sidebarView: 'search', sidebarOpen: true } });
        bus.emit('sidebar:view', { view: 'search' });
        const sel = host.getEditor()?.getModel()?.getValueInRange(host.getEditor().getSelection());
        searchview.focus(sel && sel.length < 80 ? sel : undefined);
      },
    },

    /* ── Views ── */
    { id: 'view.explorer', title: 'Show Explorer', category: 'View', keybinding: 'ctrl+shift+e', run: () => activitybar.selectView('explorer') },
    { id: 'view.search', title: 'Show Search', category: 'View', run: () => activitybar.selectView('search') },
    { id: 'view.settings', title: 'Show Settings', category: 'View', keybinding: 'ctrl+,', run: () => activitybar.selectView('settings') },
    { id: 'view.tests', title: 'Show Test Studio', category: 'View', keybinding: 'ctrl+shift+t', run: () => activitybar.selectView('tests') },
    {
      id: 'view.toggleSidebar',
      title: 'Toggle Sidebar',
      category: 'View',
      keybinding: 'ctrl+b',
      run: () => setState({ ui: { sidebarOpen: !getState().ui.sidebarOpen } }),
    },
    {
      id: 'view.toggleAgent',
      title: 'Toggle Agent Panel',
      category: 'View',
      keybinding: 'ctrl+shift+a',
      run: () => setState({ ui: { agentOpen: !getState().ui.agentOpen } }),
    },
    {
      id: 'view.zen',
      title: 'Toggle Zen Mode',
      category: 'View',
      keybinding: 'ctrl+k z',
      run: () => setState({ ui: { zen: !getState().ui.zen } }),
    },
    {
      id: 'view.split',
      title: 'Split Editor',
      category: 'View',
      keybinding: 'ctrl+\\',
      when: hasFile,
      run: () => bus.emit('notify', { type: 'info', title: 'Split editor', message: 'Arriving in v1.1.' }),
    },
    {
      id: 'view.zoomIn',
      title: 'Zoom In',
      category: 'View',
      keybinding: ['ctrl+=', 'ctrl+shift+='],
      run: () => updateSettings({ fontSize: Math.min(28, getSettings().fontSize + 1) }),
    },
    {
      id: 'view.zoomOut',
      title: 'Zoom Out',
      category: 'View',
      keybinding: 'ctrl+-',
      run: () => updateSettings({ fontSize: Math.max(10, getSettings().fontSize - 1) }),
    },
    {
      id: 'view.wordWrap',
      title: 'Toggle Word Wrap',
      category: 'View',
      keybinding: 'alt+z',
      run: () => updateSettings({ wordWrap: !getSettings().wordWrap }),
    },
    {
      id: 'view.theme',
      title: 'Change Colour Theme…',
      category: 'View',
      keybinding: 'ctrl+k ctrl+t',
      run: () =>
        palette.openCustom({
          title: 'theme',
          placeholder: 'Select a colour theme…',
          entries: THEMES.map((t) => ({ title: t.name, sub: t.id, value: t.id })),
          onAccept: (theme) => updateSettings({ theme }),
        }),
    },

    /* ── Terminal ── */
    { id: 'terminal.toggle', title: 'Toggle Terminal', category: 'Terminal', keybinding: 'ctrl+`', run: () => terminal.toggle() },
    { id: 'terminal.new', title: 'New Terminal', category: 'Terminal', keybinding: 'ctrl+shift+`', run: () => terminal.create() },
    { id: 'terminal.kill', title: 'Kill Terminal', category: 'Terminal', run: () => terminal.kill() },

    /* ── Agent ── */
    { id: 'agent.focus', title: 'Focus Agent Input', category: 'Agent', keybinding: 'ctrl+shift+space', run: () => agentUI.focusInput() },
    { id: 'agent.stop', title: 'Stop Agent', category: 'Agent', keybinding: 'ctrl+shift+x', run: () => orchestrator.stop() },
    { id: 'agent.clear', title: 'Clear Conversation', category: 'Agent', run: () => agentUI.clearConversation() },

    /* ── Help ── */
    {
      id: 'help.welcome',
      title: 'Welcome',
      category: 'Help',
      run: async () => {
        // Deactivating every editor is what reveals the welcome surface.
        await host.closeAll();
      },
    },
    {
      id: 'help.shortcuts',
      title: 'Keyboard Shortcuts',
      category: 'Help',
      run: () => palette.openCommands(),
    },
    {
      id: 'help.about',
      title: 'About Nova IDE',
      category: 'Help',
      run: async () => {
        const info = await window.nova.app.info();
        bus.emit('notify', {
          type: 'info',
          title: `Nova IDE ${info.version}`,
          message: `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
          timeout: 7000,
        });
      },
    },

    /* ── App ── */
    {
      id: 'app.quit',
      title: 'Exit',
      category: 'File',
      run: async () => {
        if (host.hasDirty()) {
          const { confirmed } = await window.nova.dialog.confirm({
            message: 'You have unsaved changes.',
            detail: 'Close Nova IDE anyway?',
            confirmLabel: 'Close',
            danger: true,
          });
          if (!confirmed) return;
        }
        window.nova.window.close();
      },
    },
    {
      id: 'app.reload',
      title: 'Reload Window',
      category: 'Developer',
      keybinding: 'ctrl+r',
      run: async () => {
        // Ctrl+R is muscle memory from the browser, and PowerShell's
        // reverse-search chord. Losing every unsaved buffer to it is brutal.
        if (host.hasDirty()) {
          const { confirmed } = await window.nova.dialog.confirm({
            message: 'You have unsaved changes.',
            detail: 'Reload the window anyway?',
            confirmLabel: 'Reload',
            danger: true,
          });
          if (!confirmed) return;
        }
        location.reload();
      },
    },
  ]);
}

/* ── Opening a workspace ──────────────────────────────────────────────── */

export async function openWorkspace(root) {
  setState({ workspace: { root, name: basename(root) } });

  try {
    await window.nova.store.pushRecent(root);
    const stored = await window.nova.store.all();
    updateSettings({ recentFolders: stored.recentFolders || [] });
  } catch {
    /* recents are a convenience, never a blocker */
  }

  await explorer.render();
  window.nova.watch.start(root).catch(() => {});

  // Build the quick-open index once per folder, off the critical path.
  window.nova.fs
    .indexFiles(root)
    .then(({ files, truncated }) => {
      setState({ fileIndex: files });
      if (truncated) {
        bus.emit('notify', {
          type: 'warn',
          title: 'Large workspace',
          message: 'Quick open is limited to the first 20,000 files.',
        });
      }
    })
    .catch(() => {});

  bus.emit('notify', { type: 'success', title: 'Folder opened', message: basename(root) });
}

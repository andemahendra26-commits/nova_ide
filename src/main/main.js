const path = require('path');
const { app, BrowserWindow, nativeTheme, screen } = require('electron');

const store = require('./store');
const appProtocol = require('./protocol');
const watcher = require('./watcher');
const fsIpc = require('./ipc/fs');
const searchIpc = require('./ipc/search');
const shellIpc = require('./ipc/shell');
const miscIpc = require('./ipc/misc');
const mcpIpc = require('./ipc/mcp');
const testIpc = require('./ipc/testrunner');

// Single instance: a second launch focuses the existing window instead of
// opening a rival copy that fights over the settings file.
appProtocol.registerScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  function clampToDisplay(bounds) {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(bounds.width, area.width);
    const height = Math.min(bounds.height, area.height);
    let { x, y } = bounds;
    // A monitor that has been unplugged leaves stale coordinates behind.
    if (x === null || y === null || x < area.x - width || x > area.x + area.width) x = undefined;
    if (y === null || y < area.y - height || y > area.y + area.height) y = undefined;
    return { width, height, x, y };
  }

  function createWindow() {
    const saved = store.get('window') || {};
    const bounds = clampToDisplay({
      width: saved.width || 1440,
      height: saved.height || 900,
      x: saved.x ?? null,
      y: saved.y ?? null,
    });

    mainWindow = new BrowserWindow({
      ...bounds,
      minWidth: 900,
      minHeight: 600,
      show: false,
      frame: false,
      backgroundColor: '#0a0a09',
      titleBarStyle: 'hidden',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // preload needs ipcRenderer; the page itself still has no Node
        webSecurity: true,
        spellcheck: false,
        // Chromium throttles timers and starves requestAnimationFrame in an
        // occluded window. The agent's live writer is driven by rAF, so without
        // this the whole run stalls the moment Nova loses focus.
        backgroundThrottling: false,
      },
    });

    if (saved.maximized) mainWindow.maximize();

    mainWindow.loadURL(appProtocol.INDEX_URL);

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      if (process.env.NOVA_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });
    });

    const pushState = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() });
    };
    mainWindow.on('maximize', pushState);
    mainWindow.on('unmaximize', pushState);
    mainWindow.on('enter-full-screen', pushState);
    mainWindow.on('leave-full-screen', pushState);

    const saveBounds = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const maximized = mainWindow.isMaximized();
      const b = maximized ? (store.get('window') || {}) : mainWindow.getBounds();
      store.set('window', {
        width: b.width || 1440,
        height: b.height || 900,
        x: b.x ?? null,
        y: b.y ?? null,
        maximized,
      });
    };
    mainWindow.on('resize', saveBounds);
    mainWindow.on('move', saveBounds);
    mainWindow.on('close', saveBounds);

    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // Never let the app navigate away from its own shell, and open any
    // outward link in the real browser instead of a rogue Electron window.
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    appProtocol.registerHandler();

    fsIpc.register();
    searchIpc.register();
    shellIpc.register();
    miscIpc.register();
    mcpIpc.register();
    testIpc.register();

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    watcher.stop();
    mcpIpc.shutdown();
    shellIpc.killAll();
    store.flush();
  });
}

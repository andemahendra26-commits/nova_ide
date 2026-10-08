const path = require('path');
const { ipcMain, dialog, BrowserWindow, app, shell } = require('electron');
const store = require('../store');
const watcher = require('../watcher');

function win(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function register() {
  /* ---------------- dialogs ---------------- */

  ipcMain.handle('dialog:openFolder', async (event) => {
    const r = await dialog.showOpenDialog(win(event), {
      properties: ['openDirectory'],
      title: 'Open Folder',
    });
    if (r.canceled || !r.filePaths.length) return { ok: true, data: null };
    const folder = r.filePaths[0];
    store.pushRecent(folder);
    return { ok: true, data: { path: folder, name: path.basename(folder) } };
  });

  ipcMain.handle('dialog:openFile', async (event) => {
    const r = await dialog.showOpenDialog(win(event), {
      properties: ['openFile'],
      title: 'Open File',
    });
    if (r.canceled || !r.filePaths.length) return { ok: true, data: null };
    return { ok: true, data: { path: r.filePaths[0] } };
  });

  ipcMain.handle('dialog:saveAs', async (event, { defaultPath }) => {
    const r = await dialog.showSaveDialog(win(event), { defaultPath, title: 'Save As' });
    if (r.canceled || !r.filePath) return { ok: true, data: null };
    return { ok: true, data: { path: r.filePath } };
  });

  ipcMain.handle('dialog:confirm', async (event, { message, detail, confirmLabel, danger }) => {
    const r = await dialog.showMessageBox(win(event), {
      type: danger ? 'warning' : 'question',
      buttons: [confirmLabel || 'OK', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message,
      detail,
    });
    return { ok: true, data: { confirmed: r.response === 0 } };
  });

  /* ---------------- settings store ---------------- */

  ipcMain.handle('store:all', async () => ({ ok: true, data: store.all() }));
  ipcMain.handle('store:merge', async (_e, patch) => ({ ok: true, data: store.merge(patch) }));
  ipcMain.handle('store:pushRecent', async (_e, { folder }) => ({
    ok: true,
    data: store.pushRecent(folder),
  }));

  /* ---------------- window controls ---------------- */

  ipcMain.on('window:minimize', (e) => win(e)?.minimize());
  ipcMain.on('window:maximize', (e) => {
    const w = win(e);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('window:close', (e) => win(e)?.close());
  ipcMain.handle('window:isMaximized', async (e) => ({ ok: true, data: !!win(e)?.isMaximized() }));

  /* ---------------- watcher ---------------- */

  ipcMain.handle('watch:start', async (event, { root }) => {
    watcher.start(root, event.sender);
    return { ok: true, data: { root } };
  });
  ipcMain.on('watch:stop', () => watcher.stop());

  /* ---------------- app info + external ---------------- */

  ipcMain.handle('app:info', async () => ({
    ok: true,
    data: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      home: app.getPath('home'),
      userData: app.getPath('userData'),
    },
  }));

  ipcMain.on('app:openExternal', (_e, { url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  /* ---------------- Claude API relay ----------------
   * Kept in the main process so the key never sits in a renderer-reachable
   * fetch and so we are not fighting the page's CSP. Streams SSE deltas back
   * on 'agent:delta'. No key is ever bundled; this is inert until the user
   * supplies one in settings.
   */
  ipcMain.handle('agent:claude', async (event, { apiKey, model, system, messages, maxTokens, token }) => {
    if (!apiKey) return { ok: false, error: 'No API key configured' };
    const send = (ch, p) => !event.sender.isDestroyed() && event.sender.send(ch, p);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model || 'claude-sonnet-5',
          max_tokens: maxTokens || 4096,
          stream: true,
          system,
          messages,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `API ${res.status}: ${body.slice(0, 300)}` };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let text = '';
      let usage = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let evt;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          if (evt.type === 'content_block_delta' && evt.delta?.text) {
            text += evt.delta.text;
            send('agent:delta', { token, text: evt.delta.text });
          } else if (evt.type === 'message_delta' && evt.usage) {
            usage = evt.usage;
          }
        }
      }
      return { ok: true, data: { text, usage } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { register };

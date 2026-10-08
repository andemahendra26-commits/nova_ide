'use strict';

/**
 * IPC surface for the built-in MCP server, plus the main <-> renderer bridge
 * the renderer-backed tools (open_file, run_agent, list_editors) run on.
 *
 * See the wiring comment at the top of ../mcp/server.js for the exact lines
 * main.js and preload.js need.
 */

const crypto = require('crypto');
const { ipcMain, BrowserWindow } = require('electron');

const server = require('../mcp/server');

// A renderer that is mid-reload, frozen or gone must not be able to wedge a
// tool call forever, so every bridge round trip is bounded.
const BRIDGE_TIMEOUT_MS = 8000;

/** In-flight bridge calls, keyed by correlation id. */
const pending = new Map();

/** Wrap a handler so Node errors become structured results instead of renderer rejections. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, args) => {
    try {
      return { ok: true, data: await fn(args || {}) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

/** The window an MCP tool should act on: whatever the user is actually looking at. */
function targetWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) || null;
}

/**
 * Send a request to the renderer and await its correlated reply.
 * Resolves with the renderer's payload, or rejects on error/timeout.
 */
function bridge(channel, payload) {
  return new Promise((resolve, reject) => {
    const win = targetWindow();
    if (!win || win.webContents.isDestroyed()) {
      reject(new Error('Nova IDE has no open window'));
      return;
    }

    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Renderer did not answer "${channel}" within ${BRIDGE_TIMEOUT_MS} ms`));
    }, BRIDGE_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();

    pending.set(id, { resolve, reject, timer });

    try {
      win.webContents.send('mcp:request', { id, channel, payload });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err);
    }
  });
}

function settle(id, ok, data, error) {
  const entry = pending.get(id);
  if (!entry) return; // a late reply after the timeout already fired
  pending.delete(id);
  clearTimeout(entry.timer);
  if (ok) entry.resolve(data);
  else entry.reject(new Error(error || 'Renderer reported a failure'));
}

function register() {
  server.setRendererBridge(bridge);

  ipcMain.on('mcp:response', (_e, msg) => {
    if (!msg || typeof msg.id !== 'string') return;
    settle(msg.id, msg.ok !== false, msg.data, msg.error);
  });

  // Calling start again with a new root is how the renderer reports that the
  // user opened a different folder; the listening socket is left untouched.
  handle('mcp:start', ({ port, root }) => {
    // Validate here rather than let an out-of-range port throw from inside
    // net.listen, where the failure arrives as an opaque RangeError.
    if (port !== undefined && port !== null) {
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid MCP port: ${port}`);
      }
    }
    return server.start({ port: port === undefined || port === null ? server.DEFAULT_PORT : port, root });
  });

  handle('mcp:stop', () => server.stop());

  handle('mcp:status', ({ root } = {}) => {
    if (root !== undefined) server.setWorkspaceRoot(root);
    return server.status();
  });
}

/** Called from app 'before-quit': drop the socket and fail anything still waiting. */
function shutdown() {
  for (const [id] of pending) settle(id, false, null, 'Nova IDE is shutting down');
  server.setRendererBridge(null);
  return server.stop();
}

module.exports = { register, shutdown, bridge };

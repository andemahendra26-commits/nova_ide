import { bus } from '../core/bus.js';
import { getState } from '../core/state.js';
import { basename } from '../core/util.js';
import * as host from '../editor/host.js';
import * as explorer from '../ui/explorer.js';
import * as orchestrator from '../agent/orchestrator.js';

/**
 * Renderer half of the MCP server.
 *
 * Three of the exposed tools need things that only live in the renderer — the
 * open editor set, the editor itself, and the agent — so the main process
 * forwards those calls here over a correlated request/response bridge.
 */

const DEFAULT_PORT = 4319;
let started = false;

export async function init() {
  window.nova.mcp.onRequest(async ({ id, channel, payload }) => {
    try {
      const data = await handle(channel, payload || {});
      window.nova.mcp.respond(id, true, data);
    } catch (err) {
      window.nova.mcp.respond(id, false, { error: err.message });
    }
  });

  // The workspace root lives here, so the server has to be told about it —
  // at startup and again every time the folder changes.
  bus.on('state:workspace', () => start());
  await start();
}

async function start() {
  const root = getState().workspace?.root || null;
  try {
    const status = await window.nova.mcp.start({ port: DEFAULT_PORT, root });
    if (!started) {
      started = true;
      console.info(`MCP server listening on http://127.0.0.1:${status?.port || DEFAULT_PORT}/mcp`);
    }
    bus.emit('mcp:status', status);
  } catch (err) {
    // A busy port is the common case and is not worth a modal; the IDE works
    // perfectly well without an external agent attached.
    console.warn('MCP server did not start:', err.message);
  }
}

export async function status() {
  try {
    return await window.nova.mcp.status();
  } catch {
    return null;
  }
}

async function handle(channel, payload) {
  switch (channel) {
    case 'open-file': {
      if (!payload.path) throw new Error('path is required');
      const file = await host.openFile(payload.path, {
        line: payload.line,
        column: payload.column,
        flash: true,
      });
      if (!file) throw new Error(`Could not open ${payload.path}`);
      explorer.reveal(payload.path).catch(() => {});
      bus.emit('notify', {
        type: 'info',
        title: 'Opened by MCP',
        message: basename(payload.path),
      });
      return { path: payload.path, opened: true };
    }

    case 'list-editors': {
      const s = getState();
      return {
        active: s.files.active,
        editors: s.files.order.map((p) => {
          const f = s.files.open.get(p);
          return { path: p, name: f?.name, language: f?.language, dirty: !!f?.dirty };
        }),
      };
    }

    case 'run-agent': {
      if (!payload.prompt) throw new Error('prompt is required');
      if (orchestrator.isRunning()) throw new Error('Agent is already running');
      // Fire and forget: a full run takes far longer than the bridge timeout,
      // so we acknowledge acceptance and let the run stream into the UI.
      orchestrator.send(payload.prompt);
      bus.emit('notify', {
        type: 'info',
        title: 'Agent triggered by MCP',
        message: payload.prompt.slice(0, 60),
      });
      return { accepted: true, prompt: payload.prompt };
    }

    default:
      throw new Error(`Unknown bridge channel: ${channel}`);
  }
}

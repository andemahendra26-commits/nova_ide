'use strict';

/**
 * Nova IDE - built-in MCP (Model Context Protocol) server.
 *
 * JSON-RPC 2.0 over a Streamable-HTTP + SSE transport, bound to loopback only.
 * Node built-ins exclusively (`http`, `crypto`): the product constraint in
 * docs/TRD.md section 1 is that the app installs and packages with no native
 * modules and no extra dependencies, so an SDK is not an option here.
 *
 * ---------------------------------------------------------------------------
 * WIRING - the exact lines to add by hand. This module edits nothing itself.
 * ---------------------------------------------------------------------------
 *
 * src/main/main.js
 *   1. With the other ipc requires (after `const miscIpc = require('./ipc/misc');`):
 *
 *        const mcpIpc = require('./ipc/mcp');
 *
 *   2. Inside `app.whenReady().then(() => { ... })`, after `miscIpc.register();`:
 *
 *        mcpIpc.register();
 *
 *   3. Inside `app.on('before-quit', () => { ... })`, before `store.flush();`:
 *
 *        mcpIpc.shutdown();
 *
 * src/main/preload.js
 *   4. Inside the `const api = { ... }` object, after the `agent: { ... }` block:
 *
 *        mcp: {
 *          start: (opts) => call('mcp:start', opts),
 *          stop: () => call('mcp:stop'),
 *          status: () => call('mcp:status'),
 *          onRequest: (h) => listen('mcp:request', h),
 *          respond: (id, ok, data) => ipcRenderer.send('mcp:response', { id, ok, data }),
 *        },
 *
 * Nothing else changes: no package.json entry, no new dependency.
 * ---------------------------------------------------------------------------
 */

const http = require('http');
const crypto = require('crypto');

const tools = require('./tools');

const HOST = '127.0.0.1'; // never 0.0.0.0 - see docs/MCP.md, "Security model"
const DEFAULT_PORT = 4319;
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'nova-ide', version: '1.0.0' };

const MAX_BODY = 1024 * 1024; // 1 MB of request JSON is already absurd for RPC
const MAX_RESULT = 1024 * 1024; // hard ceiling on what we serialize back
const SSE_HEARTBEAT_MS = 25000;

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

let server = null;
let boundPort = null;
let workspaceRoot = null;
let rendererBridge = null;
let initialized = false;

/** Open SSE channels keyed by session id, so a reconnect does not leak the old one. */
const streams = new Map();

/* ----------------------------------------------------------------- helpers */

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * DNS-rebinding defence: a page served from evil.com can resolve a hostname to
 * 127.0.0.1 and still reach us, but the browser stamps its own Origin on the
 * request. CLI clients send no Origin at all, which is the normal case.
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Stop reading rather than buffer an attacker-sized body.
        req.destroy();
        reject(new Error(`Request body exceeds ${MAX_BODY} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, extraHeaders) {
  let body;
  try {
    body = JSON.stringify(payload);
  } catch {
    body = JSON.stringify(rpcError(null, ERR.INTERNAL, 'Response is not serializable'));
  }
  if (Buffer.byteLength(body) > MAX_RESULT) {
    const id = payload && !Array.isArray(payload) && payload.id !== undefined ? payload.id : null;
    body = JSON.stringify(
      rpcError(id, ERR.INTERNAL, `Response exceeds the ${MAX_RESULT} byte cap`)
    );
  }
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...(extraHeaders || {}),
  });
  res.end(body);
}

/* ------------------------------------------------------------- rpc dispatch */

async function callTool(params) {
  if (!params || typeof params !== 'object' || typeof params.name !== 'string') {
    throw Object.assign(new Error('tools/call requires a string "name"'), {
      rpcCode: ERR.INVALID_PARAMS,
    });
  }
  const args = params.arguments === undefined ? {} : params.arguments;
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw Object.assign(new Error('tools/call "arguments" must be an object'), {
      rpcCode: ERR.INVALID_PARAMS,
    });
  }
  return tools.call(params.name, args, {
    workspaceRoot,
    bridge: rendererBridge,
    maxResult: MAX_RESULT,
  });
}

/** Handle one JSON-RPC message. Returns a response object, or null for notifications. */
async function dispatch(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return rpcError(null, ERR.INVALID_REQUEST, 'Request must be a JSON-RPC 2.0 object');
  }

  const { jsonrpc, method, id, params } = msg;
  // A notification is a message with no id at all; id must never be echoed back.
  const isNotification = !('id' in msg) || id === null;

  if (jsonrpc !== '2.0' || typeof method !== 'string') {
    if (isNotification) return null;
    return rpcError(id, ERR.INVALID_REQUEST, 'Missing "jsonrpc": "2.0" or "method"');
  }
  if (!isNotification && typeof id !== 'string' && typeof id !== 'number') {
    return rpcError(null, ERR.INVALID_REQUEST, 'Request "id" must be a string or a number');
  }

  try {
    switch (method) {
      case 'initialize':
        initialized = true;
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case 'notifications/initialized':
      case 'initialized':
        initialized = true;
        return null; // the spec forbids answering a notification

      case 'notifications/cancelled':
        return null;

      case 'ping':
        return isNotification ? null : rpcResult(id, {});

      case 'tools/list':
        return rpcResult(id, { tools: tools.definitions });

      case 'tools/call':
        return rpcResult(id, await callTool(params));

      default:
        if (isNotification) return null;
        return rpcError(id, ERR.METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  } catch (err) {
    if (isNotification) return null;
    const code = typeof err.rpcCode === 'number' ? err.rpcCode : ERR.INTERNAL;
    return rpcError(id, code, err.message || String(err));
  }
}

/** JSON-RPC allows a batch; only the non-notifications in it get answered. */
async function dispatchPayload(payload) {
  if (Array.isArray(payload)) {
    if (!payload.length) return rpcError(null, ERR.INVALID_REQUEST, 'Batch must not be empty');
    const out = [];
    for (const msg of payload) {
      const r = await dispatch(msg);
      if (r) out.push(r);
    }
    return out.length ? out : null;
  }
  return dispatch(payload);
}

/* ---------------------------------------------------------------- transport */

function openStream(req, res) {
  const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'mcp-session-id': sessionId,
  });
  res.write(': nova-ide mcp stream open\n\n');

  const beat = setInterval(() => {
    // A comment frame: keeps the client's idle timer from dropping the stream.
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(beat);
    }
  }, SSE_HEARTBEAT_MS);
  if (typeof beat.unref === 'function') beat.unref();

  const close = () => {
    clearInterval(beat);
    if (streams.get(sessionId) === res) streams.delete(sessionId);
  };
  req.on('close', close);
  res.on('close', close);
  res.on('error', close);

  const previous = streams.get(sessionId);
  if (previous && previous !== res) {
    try {
      previous.end();
    } catch {
      /* already gone */
    }
  }
  streams.set(sessionId, res);
}

/** Push a server-initiated JSON-RPC notification to every open SSE stream. */
function notify(method, params) {
  const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method, params })}\n\n`;
  for (const [sessionId, res] of streams) {
    try {
      res.write(frame);
    } catch {
      streams.delete(sessionId);
    }
  }
}

async function onRequest(req, res) {
  if (!originAllowed(req)) {
    sendJson(res, 403, rpcError(null, ERR.INVALID_REQUEST, 'Forbidden origin'));
    return;
  }

  const url = new URL(req.url, `http://${HOST}:${boundPort || DEFAULT_PORT}`);
  const route = url.pathname.replace(/\/+$/, '') || '/';
  // '/messages' and '/sse' are the legacy HTTP+SSE names; '/mcp' is the current one.
  const known = route === '/mcp' || route === '/messages' || route === '/sse';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': req.headers.origin || 'http://127.0.0.1',
      'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  if (!known) {
    sendJson(res, 404, rpcError(null, ERR.INVALID_REQUEST, `No such endpoint: ${route}`));
    return;
  }

  if (req.method === 'GET') {
    openStream(req, res);
    return;
  }

  if (req.method === 'DELETE') {
    const sessionId = req.headers['mcp-session-id'];
    const stream = sessionId ? streams.get(sessionId) : null;
    if (stream) {
      streams.delete(sessionId);
      try {
        stream.end();
      } catch {
        /* already gone */
      }
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, rpcError(null, ERR.INVALID_REQUEST, `Method ${req.method} not allowed`));
    return;
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    if (!res.writableEnded) sendJson(res, 413, rpcError(null, ERR.INVALID_REQUEST, err.message));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    sendJson(res, 400, rpcError(null, ERR.PARSE, `Parse error: ${err.message}`));
    return;
  }

  let response;
  try {
    response = await dispatchPayload(payload);
  } catch (err) {
    sendJson(res, 200, rpcError(null, ERR.INTERNAL, err.message || String(err)));
    return;
  }

  // A payload of pure notifications has nothing to answer with.
  if (response === null) {
    res.writeHead(202);
    res.end();
    return;
  }

  const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
  sendJson(res, 200, response, { 'mcp-session-id': sessionId });
}

/* --------------------------------------------------------------- public API */

/**
 * The renderer owns the truth about tabs, the editor and the agent, so tools
 * that need any of those call out through a bridge installed by
 * src/main/ipc/mcp.js. fn(channel, payload) -> Promise<any>.
 */
function setRendererBridge(fn) {
  rendererBridge = typeof fn === 'function' ? fn : null;
}

/** Every path a tool touches is validated against this root; null disables disk tools. */
function setWorkspaceRoot(root) {
  workspaceRoot = root ? String(root) : null;
  return workspaceRoot;
}

function getWorkspaceRoot() {
  return workspaceRoot;
}

function status() {
  const running = !!server && server.listening;
  return {
    running,
    host: HOST,
    port: running ? boundPort : null,
    url: running ? `http://${HOST}:${boundPort}/mcp` : null,
    workspaceRoot,
    initialized,
    streams: streams.size,
    protocolVersion: PROTOCOL_VERSION,
    tools: tools.definitions.map((t) => t.name),
  };
}

function start({ port = DEFAULT_PORT, root = null } = {}) {
  // Re-calling start is how the renderer tells us the workspace changed.
  if (root) setWorkspaceRoot(root);
  if (server && server.listening) return Promise.resolve(status());

  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      onRequest(req, res).catch((err) => {
        if (res.writableEnded || res.headersSent) return;
        sendJson(res, 500, rpcError(null, ERR.INTERNAL, err.message || String(err)));
      });
    });

    srv.on('error', (err) => {
      server = null;
      boundPort = null;
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${port} is already in use - choose another port for the MCP server`)
          : err
      );
    });

    // Loopback is a deliberate hard bind, not an inherited default.
    srv.listen(port, HOST, () => {
      server = srv;
      boundPort = srv.address().port;
      resolve(status());
    });
  });
}

function stop() {
  initialized = false;
  for (const [, res] of streams) {
    try {
      res.end();
    } catch {
      /* already gone */
    }
  }
  streams.clear();
  if (!server) return Promise.resolve(status());

  const srv = server;
  server = null;
  return new Promise((resolve) => {
    srv.close(() => {
      boundPort = null;
      resolve(status());
    });
    // close() waits for idle sockets, and an SSE client is never idle.
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
  });
}

module.exports = {
  start,
  stop,
  status,
  notify,
  setRendererBridge,
  setWorkspaceRoot,
  getWorkspaceRoot,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
};

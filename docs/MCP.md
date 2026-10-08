# Nova IDE — built-in MCP server

Nova IDE ships an [MCP](https://modelcontextprotocol.io) server inside its main process.
Any MCP client — Claude Code, Claude Desktop, an SDK agent — can drive the running IDE:
read and write files in the open workspace, search it, open a file in the editor, inspect
the open tabs, and start the Nova agent.

| | |
|---|---|
| Transport | HTTP + SSE (JSON-RPC 2.0) |
| Bind address | `127.0.0.1` only — never `0.0.0.0` |
| Default port | `4319` (configurable) |
| Endpoint | `POST`/`GET` `/mcp` (legacy aliases: `/messages`, `/sse`) |
| Protocol version | `2024-11-05` |
| Server identity | `{ "name": "nova-ide", "version": "1.0.0" }` |
| Capabilities | `{ "tools": {} }` |
| Dependencies | none — Node's `http` and `crypto` only |

The last row is a requirement, not a coincidence: [TRD](TRD.md) §1 forbids native modules and
extra install steps, so the transport is hand-rolled on Node built-ins.

---

## 1. Connecting

Start the server from the IDE (it is off until something starts it), then register it:

```
claude mcp add --transport http nova http://127.0.0.1:4319/mcp
```

Check it from the same machine:

```
curl -s http://127.0.0.1:4319/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Starting and stopping

The renderer controls the lifecycle over IPC (`{ ok, data }` / `{ ok, error }` like every
other Nova channel):

| Channel | Request | Response `data` |
|---|---|---|
| `mcp:start` | `{ port?, root? }` | status object |
| `mcp:stop` | — | status object |
| `mcp:status` | `{ root? }` | status object |

```js
await window.nova.mcp.start({ port: 4319, root: state.workspace.root });
```

`root` is the workspace the tools are allowed to touch. Call `mcp:start` again whenever the
user opens a different folder — it updates the root in place and leaves the socket alone.

The status object:

```json
{
  "running": true,
  "host": "127.0.0.1",
  "port": 4319,
  "url": "http://127.0.0.1:4319/mcp",
  "workspaceRoot": "C:\\code\\my-project",
  "initialized": true,
  "streams": 1,
  "protocolVersion": "2024-11-05",
  "tools": ["list_files", "read_file", "…"]
}
```

### Handshake

Standard MCP: `initialize` → `notifications/initialized` → `tools/list` → `tools/call`.
`ping` is answered, batches are supported, and notifications get `202` with no body.

```jsonc
// --> POST /mcp
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}
// <-- 200
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":"2024-11-05",
  "capabilities":{"tools":{}},
  "serverInfo":{"name":"nova-ide","version":"1.0.0"}}}
```

`GET /mcp` opens an SSE stream for server-initiated messages, with a keep-alive comment frame
every 25 s. `DELETE /mcp` with an `Mcp-Session-Id` header closes that session's stream.

### Errors

Protocol failures come back as JSON-RPC error objects:

| Code | Meaning | When Nova returns it |
|---|---|---|
| `-32700` | Parse error | The POST body is not JSON |
| `-32600` | Invalid request | Not a JSON-RPC 2.0 object, bad `id`, empty batch, forbidden origin |
| `-32601` | Method not found | Unknown `method` |
| `-32602` | Invalid params | Unknown tool, missing/mistyped argument, path outside the workspace |
| `-32603` | Internal error | Unexpected failure, or a response over the 1 MB cap |

Operational failures inside a tool (missing file, binary file, no renderer) are *not* RPC
errors. They come back as a normal `tools/call` result with `isError: true` and a text
explanation, so the model can read the message and recover.

---

## 2. Tools

All eight are advertised by `tools/list` with the schemas below. Every `path`/`dir` argument
is relative to the workspace root, or absolute *inside* it; anything else is rejected.

### `list_files`

List a directory. Directories first, then files, sorted case-insensitively.

```json
{
  "type": "object",
  "properties": {
    "dir": { "type": "string", "description": "Directory relative to the workspace root. Defaults to the root." }
  },
  "required": [],
  "additionalProperties": false
}
```

Returns `{ dir, count, truncated, entries: [{ name, rel, isDirectory, size }] }`, capped at
1000 entries.

### `read_file`

Read a UTF-8 text file. **Refuses files over 2 MB** and files that fail a binary sniff (a NUL
byte in the first 8 KB).

```json
{
  "type": "object",
  "properties": { "path": { "type": "string" } },
  "required": ["path"],
  "additionalProperties": false
}
```

### `write_file`

Write a UTF-8 text file, creating parent directories. Overwrites. Content is capped at 2 MB.

```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string" },
    "content": { "type": "string" }
  },
  "required": ["path", "content"],
  "additionalProperties": false
}
```

Returns `{ path, bytes, mtime }`.

### `search_code`

Case-insensitive text search across the workspace. Skips `node_modules`, `.git`, `dist`,
`out`, `build`, `release`, `.next`, `__pycache__`, `.venv`, `venv`, `.cache`, `coverage`,
`.idea`, `.vscode`, binary files and files over 2 MB — the same ignore set as the IDE's own
search (`src/main/ipc/search.js`).

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "regex": { "type": "boolean", "default": false }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

Returns `{ query, regex, files, matches, truncated, results: [{ file, hits: [{ line, column, preview }] }] }`,
capped at 200 matches across 100 files. An invalid regex is a `-32602`.

### `open_file`

Open a file in the Monaco editor and focus it. Goes through the renderer bridge.

```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string" },
    "line": { "type": "integer", "minimum": 1 }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

### `get_workspace`

```json
{ "type": "object", "properties": {}, "required": [], "additionalProperties": false }
```

Returns `{ open, root, name }`. The only tool that works with no folder open.

### `run_agent`

Start the Nova agent with a prompt. Returns once the run is **accepted**, not once it finishes
— agent runs outlive the 8 s bridge timeout, so progress is watched in the IDE.

```json
{
  "type": "object",
  "properties": { "prompt": { "type": "string", "minLength": 1, "maxLength": 8000 } },
  "required": ["prompt"],
  "additionalProperties": false
}
```

### `list_editors`

```json
{ "type": "object", "properties": {}, "required": [], "additionalProperties": false }
```

Returns whatever the renderer reports for the open tabs — path, active flag, dirty flag.

---

## 3. The renderer bridge

Three tools (`open_file`, `run_agent`, `list_editors`) need state that only the renderer has:
the Monaco models, the tab strip, the agent orchestrator. The main process cannot read any of
it, so `src/main/ipc/mcp.js` installs a request/response bridge into the server via
`setRendererBridge(fn)`.

```
tools/call open_file
  → server.js            ctx.bridge('open-file', { path, rel, line })
  → ipc/mcp.js           webContents.send('mcp:request', { id, channel, payload })
  → renderer             handles it, then
                         nova.mcp.respond(id, true, data)
  → ipc/mcp.js           ipcMain.on('mcp:response') resolves the correlated promise
  → tools/call result
```

The request goes to the focused `BrowserWindow` (falling back to the first live one). Every
round trip is correlated by a `crypto.randomUUID()` and **times out after 8 seconds**, so a
renderer that is reloading, frozen or gone can never wedge an MCP tool call — the tool returns
`isError: true` with a timeout message instead. On quit, `shutdown()` rejects everything still
in flight and closes the socket.

The renderer side to implement (one listener):

```js
window.nova.mcp.onRequest(async ({ id, channel, payload }) => {
  try {
    window.nova.mcp.respond(id, true, await handleMcp(channel, payload));
  } catch (err) {
    window.nova.mcp.respond(id, false, { error: err.message });
  }
});
```

---

## 4. Security model

The server is a local control surface for the running IDE, so it is scoped tightly.

**Loopback only.** `server.listen(port, '127.0.0.1')` is hard-coded; there is no host option to
misconfigure and nothing is ever reachable from the network.

**Origin checking.** A request carrying an `Origin` header is rejected with `403` unless that
origin is `127.0.0.1`, `localhost` or `[::1]`. This is DNS-rebinding defence: a page on a
hostile site can resolve its own hostname to loopback, but the browser still stamps the real
origin on the request. Non-browser clients send no `Origin` and are unaffected.

**Workspace containment.** Every filesystem tool resolves its path against the open workspace
root and then checks containment with `path.relative` — a result that is absolute (a different
Windows drive) or starts with `..` is refused with `-32602`. Symlinks are resolved first, on
the deepest ancestor that exists, so a link *inside* the workspace cannot aim the rest of the
path outside it. `..\..\..\Windows\System32\drivers\etc\hosts`, an absolute path elsewhere on
disk, and a symlinked escape hatch all fail the same way. With no folder open, every
filesystem tool refuses; only `get_workspace` answers.

**Size caps**, so neither side can be made to allocate without bound:

| Limit | Value |
|---|---|
| Request body | 1 MB (the socket is destroyed past it, not buffered) |
| Serialized response | 1 MB (replaced with `-32603` past it) |
| Single text block in a result | 256 KB (truncated with a marker) |
| `read_file` | 2 MB, refused past it |
| `write_file` content | 2 MB |
| `search_code` | 200 matches / 100 files / 2 MB per file |
| `list_files` | 1000 entries |
| `run_agent` prompt | 8000 characters |
| Renderer bridge round trip | 8 seconds |

**No authentication.** Anything that can open a loopback socket on this machine can drive the
IDE, exactly like any other local MCP server. That is the whole trust boundary: the server is
only running while the user has started it, and it can only touch the folder the user opened.

**No secrets.** The MCP server never reads or exposes the Claude API key in settings;
`run_agent` hands a prompt to the renderer and nothing else.

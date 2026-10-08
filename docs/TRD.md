# Nova IDE — Technical Requirements Document

| | |
|---|---|
| **Product** | Nova IDE |
| **Version** | 1.0 |
| **Status** | Approved for build |
| **Date** | 2026-09-19 |
| **Companion** | [PRD.md](PRD.md) |

---

## 1. Technology selection

| Concern | Choice | Rationale | Alternatives rejected |
|---|---|---|---|
| Application shell | **Electron 33** | Ships a Chromium renderer (the animation substrate) and a Node main process (filesystem, shell) in one executable with no user prerequisites | Tauri — smaller, but WebView2 lags on CSS/canvas features and complicates Monaco worker loading |
| Text editor | **Monaco 0.52** | The editor component of VS Code itself: tokenizers, decorations, view zones, and a public model API precise enough to drive character-by-character writing | CodeMirror 6 — excellent, but the decoration API is a poorer fit for the sweep-highlight effect |
| Terminal surface | **xterm.js 5.5** with fit and web-links addons | The de facto standard; correct ANSI handling and fast canvas renderer | Hand-rolled — not worth it |
| Shell bridge | **`child_process.spawn`** over pipes | Zero native dependencies, so the build never needs a C++ toolchain on the target | `node-pty` — true PTY semantics, but a native module and a packaging liability. Kept as a runtime-optional upgrade |
| Module system | **Native ES modules**, no bundler | The renderer is loaded from disk by a Chromium that supports ESM natively; a bundler adds build latency and obscures stack traces for no gain here | webpack/vite |
| Packaging | **electron-builder 25** | Produces both an NSIS installer and a portable single-file executable from one configuration | Squirrel, Forge |
| State persistence | JSON in `app.getPath('userData')` | Trivial, inspectable, no dependency | electron-store |

**Explicit constraint: no native modules.** Every dependency must be pure JavaScript so that
`npm install` and the packaging step succeed on a clean Windows machine with no Visual Studio
build tools present. This constraint drives the shell-bridge and persistence choices above.

---

## 2. Process architecture

```
┌──────────────────────────────── Main process (Node) ────────────────────────────────┐
│                                                                                      │
│   window.js      BrowserWindow lifecycle, frameless chrome, geometry persistence     │
│   ipc/fs.js      readDir · readFile · writeFile · rename · delete · create · stat    │
│   ipc/dialog.js  native folder/file pickers, confirmation dialogs                    │
│   ipc/search.js  streaming recursive text search with ignore rules                   │
│   ipc/shell.js   shell session registry — spawn, write, resize, kill                 │
│   ipc/store.js   settings and recent-folder persistence                              │
│   watcher.js     chokidar workspace watcher, debounced change events                 │
│                                                                                      │
└───────────────────────────────── contextBridge ─────────────────────────────────────┘
                                        │  window.nova  (frozen, allow-listed surface)
┌──────────────────────────────── Renderer (Chromium) ────────────────────────────────┐
│                                                                                      │
│   core/       bus · state · settings · keymap · commands                             │
│   ui/         titlebar · activitybar · explorer · tabs · statusbar · panel           │
│               palette · quickopen · searchview · notifications · settingsview        │
│   editor/     monaco host · models · languages · decorations                         │
│   terminal/   xterm host · session multiplexing                                      │
│   agent/      orchestrator · phases · engine (offline) · api (Claude) · writer       │
│   viz/        thinking canvas · particles · boot sequence · motion tokens            │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Security posture

| Setting | Value | Consequence |
|---|---|---|
| `nodeIntegration` | `false` | Renderer cannot reach Node built-ins directly |
| `contextIsolation` | `true` | Preload and page scripts run in separate worlds |
| `sandbox` | `false` | Required so the preload can use `ipcRenderer`; the renderer itself still has no Node access |
| `webSecurity` | `true` | Default protections retained |
| Remote content | none | Every asset is local; the app performs no network I/O except an explicit, user-configured Claude API call |

All filesystem paths crossing IPC are resolved and validated in the main process against the
open workspace root. A renderer compromise cannot read outside the opened folder except
through a path the user themselves chose in a native dialog.

---

## 3. IPC contract

All channels are `invoke`/`handle` (promise-based) except the streaming ones, which are
main-to-renderer `send` events. Every handler returns `{ ok: true, data }` or
`{ ok: false, error: string }`; the preload never throws raw Node errors into the page.

### 3.1 Filesystem — `fs:*`

| Channel | Request | Response |
|---|---|---|
| `fs:readDir` | `{ path }` | `{ entries: [{ name, path, isDirectory, size, mtime }] }` sorted directories-first, then case-insensitive by name |
| `fs:readFile` | `{ path }` | `{ content, encoding, tooLarge }` — refuses over 12 MB with `tooLarge: true` |
| `fs:writeFile` | `{ path, content }` | `{ path, bytes }` — creates parent directories as needed |
| `fs:createFile` | `{ path }` | `{ path }` — fails if it already exists |
| `fs:createDir` | `{ path }` | `{ path }` |
| `fs:rename` | `{ from, to }` | `{ path }` |
| `fs:delete` | `{ path }` | `{ path }` — recursive for directories |
| `fs:stat` | `{ path }` | `{ exists, isDirectory, size, mtime }` |

### 3.2 Dialog — `dialog:*`

`dialog:openFolder`, `dialog:openFile`, `dialog:saveAs`, `dialog:confirm`.

### 3.3 Search — `search:*`

`search:run` accepts `{ root, query, caseSensitive, wholeWord, regex, includeGlob, maxResults }`.
Results stream back on `search:result` as per-file batches so the UI can render progressively;
`search:done` carries totals. `search:cancel` aborts by token.

Traversal skips `node_modules`, `.git`, `dist`, `out`, `build`, `.next`, `__pycache__`,
`.venv`, and any file that fails a binary sniff (a NUL byte inside the first 8 KB) or exceeds
2 MB.

### 3.4 Shell — `shell:*`

| Channel | Direction | Payload |
|---|---|---|
| `shell:create` | invoke | `{ cwd, cols, rows }` → `{ id }` |
| `shell:write` | send | `{ id, data }` |
| `shell:resize` | send | `{ id, cols, rows }` |
| `shell:kill` | send | `{ id }` |
| `shell:data` | event | `{ id, data }` |
| `shell:exit` | event | `{ id, code }` |

**Revised during implementation.** The original design kept one long-lived
`powershell.exe -Command -` process and fed it lines. That does not work: in `-Command -` mode
PowerShell reads stdin to EOF before executing anything, so an interactive session produces no
output whatsoever. This was caught by testing the bridge in isolation — the terminal was dead.

The shipped bridge spawns **one process per command** instead. Output streams as it is produced
(a long `npm install` scrolls live), exit codes are real, and Ctrl+C kills exactly one command
via `taskkill /t` so the whole child tree goes down. The trade-off is that shell state does not
persist between commands, so the bridge tracks the working directory itself: it appends a
marker command that prints `$PWD`, parses that out of the stream (holding back partial markers
across chunk boundaries), and strips it from what the user sees. `cd` therefore works across
commands; exported variables do not.

Because pipes are not a TTY, the renderer performs local line editing — echoing keystrokes,
maintaining history, handling arrows and backspace — and sends whole command lines.

### 3.5 Store and window

`store:get`, `store:set`, `store:recentFolders`, `window:minimize`, `window:maximize`,
`window:close`, `window:isMaximized`, plus a `window:state` event.

### 3.6 Watcher

`watch:start { root }`, `watch:stop`, and a `watch:change { type, path }` event, debounced at
120 ms and coalesced per path.

---

## 4. Renderer module design

### 4.1 Core

**`bus.js`** — a minimal typed event emitter (`on`, `off`, `once`, `emit`). Every cross-module
interaction goes through it, so no UI module imports another UI module. This is what keeps the
dependency graph acyclic without a framework.

**`state.js`** — a single observable store:

```js
{
  workspace: { root, name } | null,
  files:     { openFiles: Map<path, FileModel>, activePath },
  ui:        { sidebarView, sidebarWidth, panelOpen, panelHeight, zen, agentOpen },
  agent:     { status, phase, runId, tokens, elapsed },
  settings:  Settings
}
```

Mutation is through `setState(patch)`, which shallow-merges and emits `state:change` with the
set of changed top-level keys. Subscribers filter by key. No proxies, no reactivity magic.

**`commands.js`** — the single registry backing the palette, the menus, the keymap, and the
context menus. One command definition feeds all four surfaces:

```js
{ id, title, category, keybinding, when?: () => boolean, run: async () => void }
```

**`keymap.js`** — parses keybinding strings, supports chords, resolves against the registry,
and refuses to fire when focus sits inside the editor and Monaco owns the binding.

### 4.2 Editor layer

One Monaco instance per editor group. Files are backed by persistent `ITextModel`s keyed by
path, so switching tabs restores cursor position, selection, scroll offset, and undo history.

`FileModel = { path, name, language, model, viewState, dirty, savedVersionId }`.

Dirtiness is computed as `model.getAlternativeVersionId() !== savedVersionId`, which correctly
reports clean after an undo back to the saved state.

Language is resolved from the extension against a 40-entry map, falling back to
`plaintext`. Monaco's workers are configured through `MonacoEnvironment.getWorkerUrl`, which
returns a `blob:` shim that `importScripts` the vendored worker — the standard pattern for
loading Monaco from a `file://` origin.

### 4.3 The agent subsystem

This is the product's differentiator and gets the most deliberate design.

#### 4.3.1 Orchestrator

A phase state machine. Phases are declarative and each one owns an async generator that emits
timed events; the orchestrator renders those events and enforces cancellation between every
step.

```
idle → understanding → thinking → planning → writing → reviewing → done
                                                    ↘ stopped (from any phase)
                                                    ↘ error
```

A single `AbortController` per run is checked at every `await` boundary. Stopping never
rolls back written text — the PRD requires partial work to survive.

#### 4.3.2 Providers

The orchestrator depends on a provider interface, not on a specific backend:

```js
interface AgentProvider {
  understand(request)        -> { summary, intent, targets }
  think(ctx, onThought)      -> Promise<void>        // emits thought lines over time
  plan(ctx)                  -> Step[]
  generate(ctx, step)        -> { path, language, content }
  review(ctx, artifacts)     -> { summary, notes[] }
}
```

Two implementations:

- **`engine.js` (Nova Engine, offline, P0).** Intent classification by weighted keyword
  scoring over a template catalogue — React component, Express server, Python CLI, HTML page,
  test suite, REST client, data model, README, and a generic fallback. Templates are real
  parameterized generators producing runnable files, not lorem ipsum. Thought lines and plan
  steps are drawn per template so the reasoning shown corresponds to the code produced.
- **`api.js` (Claude provider, P1).** Streams from the Messages API using a key the user
  supplies in settings. Streamed deltas feed the same thought and writer pipelines, so the
  visual experience is identical. Never bundled with a key; absent a key the provider is not
  offered.

#### 4.3.3 The live writer

The most demanding component. It types generated content into a real Monaco model while
keeping the editor responsive.

- **Loop.** Driven by `requestAnimationFrame`, not `setInterval`. Each frame computes a
  character budget from elapsed time and the configured characters-per-second, so the pace is
  correct regardless of frame rate and never blocks the main thread.
- **Chunking.** Characters are applied in per-frame batches through a single
  `model.applyEdits` call. One edit per frame, not one per character — this is the difference
  between 60 fps and 6 fps.
- **Rhythm.** A deliberate micro-pause after `\n`, `;`, `{`, and `}` and a longer one at blank
  lines. This is what makes the typing read as composition rather than as a paste.
- **Caret.** A Monaco content-widget positioned at the write head, carrying the glow. It is a
  widget rather than a real cursor so the user's own cursor and selection are never hijacked.
- **Active line.** A decoration class applied to the current write line, animated by CSS
  keyframes, plus a decoration on the last few completed lines that fades from accent to
  transparent over 900 ms.
- **Scroll.** `revealLineInCenterIfOutsideViewport` on line change only, never per character.
- **Backpressure.** If a frame's applied edit exceeds a 6 ms budget, the next frame's budget
  is reduced. The loop degrades pace before it degrades frame rate.

#### 4.3.4 The thinking visualization

A `<canvas>` running an independent `requestAnimationFrame` loop, sized to its container by
`ResizeObserver` and scaled by `devicePixelRatio`.

Model: up to 48 nodes, each `{ x, y, vx, vy, r, charge, born, life }`. Nodes drift under weak
mutual repulsion with soft-boundary reflection. Edges are drawn between node pairs within a
threshold distance, their alpha proportional to proximity. A pulse travels an edge when a
thought line is emitted, giving the reasoning stream a visual correlate. Node count scales with
phase intensity: sparse while understanding, dense while thinking, settling while planning.

Cost control: no shadows in the per-frame path (an offscreen pre-rendered radial sprite is
blitted instead), a single path batch per edge alpha bucket, and the loop is fully suspended
when the canvas is not visible or reduced motion is on.

### 4.4 Motion system

Durations, easings, and stagger units live as CSS custom properties on `:root` and are scaled
by a single `--motion-scale` variable. The reduced-motion setting sets `--motion-scale: 0`,
which collapses every duration to zero through `calc()` and simultaneously suspends the canvas
loops. One switch, complete coverage.

Animation is restricted to `transform`, `opacity`, `filter`, and `clip-path` so that work stays
on the compositor. No animated `width`, `height`, `top`, or `left` on any element in a hot path.

---

## 5. Data models

```js
Settings = {
  theme: 'nova-dark' | 'nova-light' | 'midnight' | 'synthwave',
  fontSize: number,            // 10–28, default 14
  fontFamily: string,
  tabSize: number,             // default 2
  wordWrap: boolean,
  minimap: boolean,
  lineNumbers: boolean,
  animationSpeed: number,      // 0.25–2, default 1
  reducedMotion: boolean,
  agentTypingSpeed: number,    // chars/sec, 20–400, default 70
  agentProvider: 'engine' | 'claude',
  apiKey: string               // empty by default; never transmitted anywhere but the API host
}

AgentRun = {
  id, request, startedAt, phase, tokens,
  thoughts: string[],
  steps: [{ id, label, status: 'pending'|'active'|'done' }],
  artifacts: [{ path, language, bytes }],
  status: 'running' | 'done' | 'stopped' | 'error'
}
```

---

## 6. File layout

```
nova-ide/
├─ package.json
├─ docs/
│  ├─ PRD.md
│  └─ TRD.md
├─ build/
│  ├─ icon.ico                 generated at build time
│  └─ installer.nsh
├─ scripts/
│  └─ vendor.js                copies Monaco + xterm into renderer/vendor
├─ src/
│  ├─ main/
│  │  ├─ main.js               entry, app lifecycle
│  │  ├─ preload.js            contextBridge surface
│  │  ├─ window.js
│  │  ├─ store.js
│  │  ├─ watcher.js
│  │  └─ ipc/{fs,dialog,search,shell,store}.js
│  └─ renderer/
│     ├─ index.html
│     ├─ css/{tokens,themes,layout,components,animations,agent}.css
│     ├─ vendor/{vs,xterm}/    vendored, generated
│     └─ js/
│        ├─ boot.js
│        ├─ core/{bus,state,settings,commands,keymap,util}.js
│        ├─ ui/{titlebar,activitybar,explorer,tabs,statusbar,panel,
│        │      palette,quickopen,searchview,notifications,settingsview,welcome}.js
│        ├─ editor/{host,models,languages,decorations}.js
│        ├─ terminal/host.js
│        ├─ agent/{orchestrator,engine,api,writer,ui}.js
│        └─ viz/{thinking,particles,bootseq}.js
```

`scripts/vendor.js` runs before packaging and copies `monaco-editor/min/vs` and the xterm
distribution into `src/renderer/vendor`. This keeps renderer asset paths identical in
development and in the packaged app, and lets `node_modules` be excluded from the build
entirely — the single largest lever on installer size.

---

## 7. Build and packaging

```jsonc
"build": {
  "appId": "com.nova.ide",
  "productName": "Nova IDE",
  "files": ["src/**/*", "package.json", "!src/renderer/vendor/**/*.map"],
  "win": { "target": ["nsis", "portable"], "icon": "build/icon.ico" },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "shortcutName": "Nova IDE"
  }
}
```

Outputs, in `release/`:

- `Nova IDE Setup 1.0.0.exe` — NSIS installer with Start Menu and desktop shortcuts.
- `Nova IDE 1.0.0.exe` — portable, single file, no installation.

The icon is generated at build time from the product mark rather than committed as a binary,
so the repository stays text-only.

### 7.1 Verification before release

| Check | Method |
|---|---|
| Renderer has no syntax errors | `node --check` over every renderer module |
| The app boots and the window appears | Launch headless-ish with a smoke flag; assert `did-finish-load` and zero renderer console errors |
| Core flows work | Manual script: open folder, open file, edit, save, search, terminal command, agent run |
| Packaged app launches from a clean path | Run the portable executable from a directory with no `node_modules` present |

---

## 8. Performance budgets

| Path | Budget | Technique |
|---|---|---|
| Frame during thinking + writing | 16.6 ms | Canvas and DOM loops are separate; one `applyEdits` per frame; pre-rendered glow sprite |
| Explorer expand, 1 000 entries | 600 ms | Lazy directory loading, `DocumentFragment` batch insert, CSS-only stagger via `animation-delay` |
| Quick open over 10 000 files | 120 ms per keystroke | Index built once on folder open; scoring is a single pass with early termination |
| Global search, 5 000 files | 1.5 s | Streaming results, binary sniff, size cap, ignore list |
| Cold start | 2.5 s | Monaco loaded after first paint; the boot animation covers the load |

---

## 9. Error handling

- Every IPC handler is wrapped so a thrown Node error becomes `{ ok: false, error }` rather
  than an unhandled rejection in the renderer.
- The renderer installs `window.onerror` and `unhandledrejection` handlers that surface a
  dismissible error toast instead of failing silently.
- Filesystem failures (permission denied, file vanished, path too long) produce a specific
  message naming the path, never a bare "operation failed".
- An agent run that throws transitions to `error`, keeps its partial artifacts, and shows the
  message in the transcript.
- A missing vendored asset fails loudly at boot with an actionable message rather than
  rendering a blank window.

---

## 10. Known limitations of v1

1. The pipe-based shell is not a true PTY, and runs one process per command. Full-screen TUI
   programs (`vim`, `htop`) and interactive prompts will not render correctly, and exported
   environment variables do not survive between commands (`cd` does). Ordinary command
   execution is unaffected.
2. No language servers: completion is Monaco's word-based suggestion, not semantic.
3. The offline agent creates and appends files; it does not perform surgical edits to existing
   code.
4. Search is literal and regex over file contents, with no symbol index.
5. Windows x64 only in this release.

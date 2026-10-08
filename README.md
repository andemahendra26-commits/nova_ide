# Nova IDE

A desktop code editor that **shows its work**.

Nova adapts the interaction model you already know — explorer, tabs, editor, terminal, command
palette — and adds a collaborator you can actually watch: an agent that reads, thinks, plans,
and types code into your buffer in real time, with a pixel character that mirrors every phase.

Windows 10/11 · x64 · no prerequisites to install.

---

## Install

Both installers are committed to this repository under [`release/`](release/).

**Installer** — run `Nova IDE Setup 1.0.0.exe`. Creates Start Menu and desktop shortcuts.

**Portable** — run `Nova IDE Portable 1.0.0.exe`. No installation, no registry writes.

### Build from source

```bash
npm install
npm run vendor     # copy Monaco + xterm into src/renderer/vendor
npm start          # run in development
npm run dist       # produce release/*.exe
```

---

## What it does

### Editor
Monaco — the editor engine from VS Code — with syntax highlighting for 40+ languages,
tabs with drag-reorder and dirty indicators, minimap, code folding, multi-cursor,
bracket-pair colourisation, sticky scroll, and find/replace.

### Files and search
Lazy-loading file tree with create, rename, delete, and a live filesystem watcher.
Fuzzy quick-open across the workspace (`Ctrl+P`), and streaming full-text search with
per-file grouped results (`Ctrl+Shift+F`).

### Terminal
Integrated PowerShell with multiple sessions, scrollback, ANSI colour, command history,
and live streaming output. Working directory persists across commands.

### The agent
Six visible phases — **Understanding → Thinking → Planning → Writing → Reviewing → Done** —
each with its own visual language:

- a **neural canvas** whose nodes spawn, wire together and pulse as reasoning runs
- a **thought stream** that types out and drifts away
- a **plan board** that assembles and ticks itself off
- **live writing**: generated code typed character by character into the real buffer under a
  glowing caret, with the active line highlighted and the view auto-scrolling

Everything is interruptible. Stop mid-run and whatever was written stays.

Two providers: an offline **Nova Engine** that emits genuinely runnable files (React components,
Express servers, Python CLIs, pages, test suites, READMEs, data models, utilities) with no
network and no API key; or the **Claude API** with your own key, streaming through the identical
animation pipeline.

It also knows the difference between a build instruction and conversation — saying "hello"
gets a reply, not a file.

### Test Studio
FireFlink-style codeless QA built in: an element repository, a step builder over a fixed verb
set, test cases and suites, data-driven runs, API testing with response chaining, and live
execution reports with screenshots on failure.

Web automation drives a hidden Electron `BrowserWindow` rather than Playwright or Selenium —
real Chromium automation with zero extra downloads and full offline operation.

### MCP server
Nova hosts a Model Context Protocol server on `127.0.0.1:4319`, so external agents can drive it:

```bash
claude mcp add --transport http nova http://127.0.0.1:4319/mcp
```

Eight tools: `list_files`, `read_file`, `write_file`, `search_code`, `open_file`,
`get_workspace`, `run_agent`, `list_editors`. Loopback-only, with symlink-aware path
containment against the open workspace.

### Themes
**Claude Dark** (default), Nova Dark, Midnight, Synthwave, Nova Light. Chrome, syntax,
and terminal switch together.

---

## Keyboard

| | |
|---|---|
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+P` | Go to file |
| `Ctrl+Shift+F` | Find in files |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+Shift+A` | Toggle agent panel |
| `` Ctrl+` `` | Toggle terminal |
| `Ctrl+Shift+T` | Test Studio |
| `Ctrl+K Z` | Zen mode |
| `Ctrl+K Ctrl+T` | Change theme |
| `Ctrl+,` | Settings |

Standard editing bindings (`Ctrl+S`, `Ctrl+F`, `Ctrl+D`, `Alt+↑/↓`, …) behave as expected.

---

## Accessibility

Every animation duration derives from one `--motion-scale` variable. **Reduced motion** in
Settings sets it to zero, which collapses the entire motion system and suspends the canvas
loops — including the agent's live writing, which places text instantly instead.

---

## Architecture

No bundler, no native modules. The renderer is native ES modules served over a custom
`app://` protocol; the main process is CommonJS. Every dependency is pure JavaScript, so the
build succeeds on a clean Windows machine with no C++ toolchain.

- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/TRD.md`](docs/TRD.md) — technical design, IPC contract, performance budgets
- [`docs/MCP.md`](docs/MCP.md) — MCP tools and security model
- [`docs/TESTSTUDIO.md`](docs/TESTSTUDIO.md) — Test Studio reference

---

## Known limitations

- The terminal is pipe-based, not a true PTY. Full-screen TUI programs (`vim`, `htop`) will not
  render, and exported environment variables do not persist between commands (`cd` does).
- No language servers — completion is word-based, not semantic.
- The offline agent creates and appends files; it does not perform surgical edits to existing code.
- Windows x64 only in this release.

---

MIT

# Nova IDE — Product Requirements Document

| | |
|---|---|
| **Product** | Nova IDE |
| **Version** | 1.0 |
| **Status** | Approved for build |
| **Date** | 2026-09-19 |
| **Owner** | Project owner |
| **Target platform** | Windows 11 / 10 (x64), shipped as an NSIS installer plus a portable `.exe` |

---

## 1. Summary

Nova IDE is a desktop code editor that makes the machine's work **visible**. It adapts the
proven interaction model of Visual Studio Code — explorer, tabs, editor, terminal, command
palette — and layers on a first-class *agent presence*: a collaborator that visibly thinks,
plans, and writes code into your buffers in real time, with motion design treated as a
product feature rather than decoration.

Where a conventional editor shows a spinner while something happens, Nova shows **what is
happening**: thoughts streaming, a plan assembling itself, characters landing in the editor
one at a time under a glowing caret.

---

## 2. Problem statement

Modern AI-assisted editors are functionally impressive and experientially opaque. A user
issues a request and receives a wall of completed diff. Three problems follow:

1. **No trust surface.** The user cannot tell whether the tool understood the request until
   after it has already rewritten their file.
2. **No interruption point.** Because the work is atomic and instant, there is no moment at
   which the user can say "no, not like that."
3. **No sense of collaboration.** The interaction feels like a vending machine, not a pair
   programmer.

Nova's thesis: **rendering the process at human-legible speed converts a black box into a
collaborator.** The animation is the trust mechanism.

---

## 3. Goals and non-goals

### 3.1 Goals

| # | Goal | Measure of success |
|---|---|---|
| G1 | Ship a genuinely usable code editor, not a demo | Can open a real folder, edit, save, run a terminal command, and search across files without falling back to another editor |
| G2 | Make agent cognition visible and beautiful | Every agent action has a distinct visual phase; no unexplained spinner exceeds 400 ms |
| G3 | Keep animation from costing usability | Editor keystroke latency stays under 16 ms at p95 while animations run |
| G4 | Ship as a double-clickable Windows executable | The app launches with no prerequisites installed |
| G5 | Adapt existing editor muscle memory | A VS Code user is productive with zero documentation; core keybindings are identical |

### 3.2 Non-goals for v1

- Cross-platform builds for macOS and Linux. The architecture must not preclude them; we simply do not ship them.
- An extension marketplace or third-party plugin API.
- Multi-user or real-time collaborative editing.
- A debugger with breakpoints and step-through.
- A full Git client (staging, merge conflict resolution, rebase UI).
- Remote, SSH, or container development.

---

## 4. Target users

| Persona | Description | What they need from Nova |
|---|---|---|
| **The builder** | Writes code daily, lives in VS Code, curious about agentic tooling | Familiar shortcuts, fast file open, a real terminal — plus an agent they can actually watch |
| **The demonstrator** | Shows software to other people: teaching, streaming, pitching | Motion that reads on a projector; an interface that explains itself on screen |
| **The tinkerer** | Owns this codebase and wants a playground to extend | Clean module boundaries, no bundler ceremony, readable source |

---

## 5. Experience principles

1. **Motion carries meaning.** Every animation encodes state. Nothing moves for its own sake.
2. **Legible speed.** Agent output types at a pace a human can read (roughly 55–90 characters
   per second), not at machine speed. Speed is a setting, never a surprise.
3. **Always interruptible.** Any agent phase can be stopped mid-flight; partial work is kept,
   never silently rolled back.
4. **Dark by default.** A deep blue-black canvas, a single cyan-to-violet accent spectrum, and
   light used sparingly so that glow means something.
5. **The editor is sacred.** Chrome, panels, and effects may be expressive. The text surface
   itself stays calm and high-contrast.

---

## 6. Functional requirements

Priorities: **P0** ships in v1.0 · **P1** ships in v1.0 if schedule holds · **P2** is post-v1.

### 6.1 Shell and window

| ID | Requirement | Pri |
|---|---|---|
| SH-1 | Frameless window with a custom title bar: logo, menu bar, centered document title, minimize/maximize/close | P0 |
| SH-2 | Window geometry (size, position, maximized state) persists across sessions | P0 |
| SH-3 | Animated boot sequence: the logo assembles from particles over a progress rail, then fades into the shell (about 1.6 s, skippable by click) | P0 |
| SH-4 | Welcome tab when no folder is open: recent folders, quick actions, animated hero | P0 |
| SH-5 | Zen mode hides all chrome except the editor | P1 |
| SH-6 | Drag and drop a folder or file onto the window to open it | P1 |

### 6.2 File explorer

| ID | Requirement | Pri |
|---|---|---|
| FE-1 | Tree view of the open folder with lazily loaded directories | P0 |
| FE-2 | File-type icons driven by extension; folders animate open and closed with a chevron rotation | P0 |
| FE-3 | Create file, create folder, rename, and delete via context menu | P0 |
| FE-4 | Staggered reveal animation when a directory expands — rows cascade in | P0 |
| FE-5 | The active file is highlighted and auto-revealed in the tree | P0 |
| FE-6 | Live filesystem watching, so external changes appear without a manual refresh | P1 |
| FE-7 | A filter box that narrows the tree as you type | P2 |

### 6.3 Editor

| ID | Requirement | Pri |
|---|---|---|
| ED-1 | Monaco editor with syntax highlighting for at least 30 languages, detected by extension | P0 |
| ED-2 | Tabs: open, close, close-others, reorder, dirty indicator, middle-click to close | P0 |
| ED-3 | Save, Save As, and Save All; dirty state reflected in the tab and the title bar | P0 |
| ED-4 | Find and replace within a file | P0 |
| ED-5 | Minimap, line numbers, bracket-pair colorization, code folding, multi-cursor | P0 |
| ED-6 | A breadcrumb bar showing the path segments of the active file | P1 |
| ED-7 | Split the editor into two independent groups | P1 |
| ED-8 | Font size zoom and a word wrap toggle | P1 |

### 6.4 Terminal

| ID | Requirement | Pri |
|---|---|---|
| TM-1 | Integrated terminal panel running PowerShell, rooted at the open folder | P0 |
| TM-2 | Multiple terminal instances with a tab strip; create and kill | P0 |
| TM-3 | The panel is resizable by drag and toggled by keyboard | P0 |
| TM-4 | ANSI colour, scrollback, copy and paste, link detection | P0 |
| TM-5 | Output arriving while the panel is hidden triggers a subtle pulse on the panel tab | P1 |

### 6.5 Navigation and search

| ID | Requirement | Pri |
|---|---|---|
| NV-1 | Command palette with fuzzy match, keyboard navigation, and per-command shortcut hints | P0 |
| NV-2 | Quick open — fuzzy file search across the workspace | P0 |
| NV-3 | Global text search with results grouped per file; click to jump to the line | P0 |
| NV-4 | Go to line | P1 |
| NV-5 | Both overlays animate in with a scale-and-blur entrance and highlight matched characters | P0 |

### 6.6 Agent — the signature experience

| ID | Requirement | Pri |
|---|---|---|
| AG-1 | A dedicated agent sidebar with a conversation transcript | P0 |
| AG-2 | Six visible phases, each with its own visual language: **Understanding → Thinking → Planning → Writing → Reviewing → Done** | P0 |
| AG-3 | **Thinking visualization**: a live canvas of neural nodes that spawn, connect, pulse, and decay while reasoning runs | P0 |
| AG-4 | **Thought stream**: short reasoning lines type out, linger, and fade upward | P0 |
| AG-5 | **Plan board**: steps materialize one by one, then check off with a stroke-draw animation as they complete | P0 |
| AG-6 | **Live writing**: generated code is typed into the real editor buffer character by character, with a glowing caret, a sweep highlight on the active line, and auto-scroll that keeps the caret in view | P0 |
| AG-7 | A stop control that halts any phase immediately and keeps whatever was written | P0 |
| AG-8 | Live telemetry: elapsed timer, token counter, current phase pill | P0 |
| AG-9 | An offline **Nova Engine** — a local deterministic generator that produces real, runnable files for common intents (React component, Express server, Python CLI, HTML page, test suite, README, and more) so the product works with no network and no API key | P0 |
| AG-10 | An optional **Claude API connection**: the user supplies their own key in settings, and requests then stream from the real model through the identical phase and animation pipeline | P1 |
| AG-11 | Agent output lands in real files on disk and is undoable through normal editor undo | P0 |

### 6.7 Theming and settings

| ID | Requirement | Pri |
|---|---|---|
| TH-1 | Four built-in themes: **Nova Dark** (default), **Nova Light**, **Midnight**, **Synthwave** | P0 |
| TH-2 | A theme switch applies to the chrome and the editor simultaneously, with a cross-fade | P0 |
| TH-3 | Settings panel: theme, editor font size and family, tab size, word wrap, minimap, animation speed, reduced motion, agent typing speed, API key | P0 |
| TH-4 | Settings persist to the user data directory and reload on launch | P0 |
| TH-5 | **Reduced motion** disables decorative animation while preserving state-carrying transitions | P0 |

### 6.8 Status bar

| ID | Requirement | Pri |
|---|---|---|
| ST-1 | Left: workspace name and an agent state indicator with an animated dot | P0 |
| ST-2 | Right: cursor line and column, selection count, indentation, encoding, language, notification bell | P0 |
| ST-3 | Clicking the language opens a language picker; clicking indentation opens a tab-size picker | P1 |

### 6.9 Notifications

| ID | Requirement | Pri |
|---|---|---|
| NT-1 | Toasts for save, error, and agent completion; they slide in from the bottom right and auto-dismiss | P0 |
| NT-2 | Error toasts persist until dismissed and carry an action button where relevant | P1 |

---

## 7. Key user flows

### 7.1 First launch

Boot animation, then the Welcome tab. The user picks "Open Folder", the native folder picker
appears, and the explorer populates with a cascading reveal. The status bar names the
workspace and the agent sidebar greets the user with its capability list.

### 7.2 Editing

Click a file in the explorer and a tab slides in. Monaco loads with a fade. The user edits, a
dirty dot appears on the tab, and on save the dot resolves into a checkmark that fades out
while a toast confirms the write.

### 7.3 Agent write — the showpiece

1. The user types *"create a React component for a pricing card"* into the agent sidebar and presses Enter.
2. **Understanding.** The request echoes as a message, the phase pill lights, and a scan line sweeps the sidebar.
3. **Thinking.** The neural canvas ignites. Nodes spawn and wire themselves together, thought lines type out and drift upward, and the token counter climbs.
4. **Planning.** The nodes settle and a plan board assembles: create file, scaffold component, add props, style, export. Each step slides in on a stagger.
5. **Writing.** A new tab opens and the caret begins typing real code into the editor at readable speed. The active line carries a sweep highlight, the caret glows, and the view auto-scrolls. Plan steps tick off as their section completes.
6. **Reviewing.** A pass sweeps the written region and a summary of what was produced appears.
7. **Done.** The file is saved to disk, a success toast fires, and the transcript shows a result card with the file path.

At any point the **Stop** control ends the run and leaves the partial file intact and editable.

### 7.4 Search and jump

The search overlay scales in, the query is typed, and results stream in grouped by file with
match counts. Clicking a match opens the editor at that line with a flash highlight on the
target range.

---

## 8. Design direction

- **Palette.** Base `#0a0c14`, surface `#111420`, elevated `#161a2a`. Accent spectrum cyan `#22d3ee` to violet `#a78bfa`. Success `#34d399`, warning `#fbbf24`, danger `#f87171`.
- **Type.** UI in Inter or Segoe UI Variable. Code in JetBrains Mono, Cascadia Code, or Consolas as a fallback chain.
- **Depth.** Layered translucency, one-pixel hairline borders at 8 % white, and a single soft accent glow reserved for the active element.
- **Motion vocabulary.** Entrances run 180–260 ms on `cubic-bezier(.16,1,.3,1)`, state changes 120 ms, ambient loops 3–8 s. The stagger unit is 28 ms.
- **The glow rule.** Only one element on screen glows at a time. Glow means "this is where the work is."

---

## 9. Success metrics

| Metric | Target |
|---|---|
| Cold start to an interactive shell | under 2.5 s |
| Editor keystroke latency at p95 with the agent idle | under 16 ms |
| Frame rate during the thinking visualization | at least 55 fps on integrated graphics |
| Folder open to rendered tree, 1 000 entries | under 600 ms |
| Global search across 5 000 files | under 1.5 s |
| Installed footprint | under 400 MB |
| Crash-free sessions | above 99 % |

---

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Animation degrades editing responsiveness | High | Keep ambient animation on canvas and compositor layers; yield the typing loop through `requestAnimationFrame`; provide a hard kill switch in reduced motion |
| A native terminal module fails to build on target machines | Medium | Ship a pipe-based shell bridge with no native dependency and treat a true PTY as an optional enhancement |
| The Monaco bundle bloats the installer | Medium | Vendor only `monaco-editor/min/vs` and exclude `node_modules` from the package |
| The offline agent reads as a toy | High | The generator must emit real, runnable, non-placeholder files, with the API path available for genuine model output |
| Motion triggers vestibular discomfort | Medium | Honour `prefers-reduced-motion` and expose an explicit setting |

---

## 11. Release plan

| Milestone | Contents |
|---|---|
| **M1 — Shell** | Window, title bar, layout, theming, boot animation, settings persistence |
| **M2 — Editing core** | Explorer, tabs, Monaco, save and load, status bar |
| **M3 — Power tools** | Command palette, quick open, global search, terminal |
| **M4 — Agent** | Phase machine, thinking canvas, plan board, live writer, Nova Engine |
| **M5 — Package** | Icon, builder configuration, NSIS installer and portable executable, smoke test |

---

## 12. Open questions

1. Should the agent be permitted to modify existing files in v1, or only create new ones? *(v1 answer: create and append, with full in-place edit deferred to v1.1.)*
2. Does the API path need a proxy for users behind corporate TLS inspection? *(Deferred; document the failure mode.)*
3. Should the thinking canvas double as an idle ambient background on the welcome screen? *(Yes — the same engine at lower density.)*

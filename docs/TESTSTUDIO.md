# Test Studio

A codeless QA / test-automation module for Nova IDE, in the spirit of FireFlink:
a named **element repository**, a **step builder** over a fixed verb set,
**test cases and suites**, **data-driven runs**, **API testing with chaining**,
and **live streaming execution reports**.

---

## 1. Why a hidden BrowserWindow

Web execution does **not** use Playwright, Selenium, WebDriver, or any new npm
dependency. Nova is an Electron app, so it already ships Chromium. The runner
opens a `BrowserWindow` with `show: false` and drives it:

| Need | Mechanism |
| --- | --- |
| Navigation | `win.loadURL(url)` |
| Actions and assertions | `win.webContents.executeJavaScript(src, userGesture)` |
| Screenshots | `win.webContents.capturePage()` → `resize({width:520})` → `toDataURL()` |
| API calls | `fetch` in the main process |

Consequences worth knowing:

* **Zero install, fully offline.** No driver download, no browser download, no
  driver/browser version drift.
* `paintWhenInitiallyHidden: true` is set deliberately — a hidden window that
  never paints captures as an *empty* image, and screenshots would silently
  come back blank.
* The automation window uses its own session partition (`nova-test-runner`), so
  test cookies and storage never touch the IDE's own state.
* Every run tears the window down in a `finally`, and `test:cancel` destroys all
  live windows, so a failed or cancelled run cannot leak an invisible Chromium
  process.
* Trade-off: because actions are synthesised in-page (`el.click()`,
  `dispatchEvent`) rather than through the OS input stack, they are not true
  trusted user gestures. This covers the overwhelming majority of web apps but
  will not exercise browser-native file pickers or OS dialogs.

---

## 2. Files

| Path | Role |
| --- | --- |
| `src/main/ipc/testrunner.js` | Main process. Owns the hidden window, the step executor, the API client, and the IPC channels. CommonJS. |
| `src/renderer/js/testing/model.js` | Verb metadata, factories, and persistence to `.nova/`. ES module. |
| `src/renderer/js/testing/studio.js` | The sidebar UI: tree, step editor, element repository, live results. ES module. |
| `src/renderer/css/testing.css` | All `.ts-*` styling, on the existing token contract. |

Persistence lives in the workspace, so tests travel with the project:

* `.nova/elements.json` — `{ version: 1, elements: [...] }`
* `.nova/tests.json` — `{ version: 1, suites: [...] }`

---

## 3. Wiring

The exact lines to add are repeated in the comment block at the top of
`src/renderer/js/testing/studio.js`. In summary:

1. `src/renderer/index.html` — `<link rel="stylesheet" href="css/testing.css" />`
2. `src/renderer/index.html` — `<section class="sb-view" id="view-tests" data-view="tests" hidden></section>`
3. `src/main/preload.js` — a `test:` block in the `api` object
4. `src/main/main.js` — `require('./ipc/testrunner').register()`
5. renderer boot — `teststudio.init(document.getElementById('view-tests'))`
6. commands — register `view.tests`, which calls `activitybar.selectView('tests')`
7. `activitybar.js` — optional `VIEWS` entry pointing at `view.tests`

The status bar needs no change: it already listens for the `test:summary` bus
event and reads `getState().testSummary`, and the studio sets both.

---

## 4. Data model

### Element

```json
{ "id": "el-8fj2", "name": "Login button", "strategy": "css", "value": "#login" }
```

`strategy` is one of `css` | `xpath` | `text` | `id`.

* `css` → `document.querySelector(value)`
* `id` → `document.getElementById(value)`
* `xpath` → `document.evaluate(value, document, null, 9, null).singleNodeValue`
* `text` → the *deepest* (childless) element whose trimmed text equals `value`,
  falling back to the first that contains it — a wrapping `<div>` never wins.

Locator values support `{{placeholders}}` too, so one element can target a
different row of a table per dataset row.

### Step

Every step is `{ id, verb, element, enabled, ...verb fields }`. The field keys
below are the contract shared by `model.js` (which renders them) and
`testrunner.js` (which reads them).

| Verb | Element? | Fields |
| --- | --- | --- |
| `navigate` | – | `value` = URL |
| `click` | yes | – |
| `type` | yes | `value` = text |
| `select` | yes | `value` = option value or visible label |
| `hover` | yes | – |
| `wait` | – | `value` = milliseconds |
| `waitForElement` | yes | `timeout` = ms (default 10000, polled every 120 ms) |
| `assertText` | yes | `value` = expected, `match` = `contains` \| `equals` |
| `assertVisible` | yes | – |
| `assertUrl` | – | `value` = expected, `match` |
| `assertAttribute` | yes | `value` = attribute name, `value2` = expected |
| `screenshot` | – | `value` = label |
| `script` | – | `value` = JS body (use `return`), `saveAs` |
| `apiRequest` | – | `method`, `url`, `headers`, `body`, `capture`, `saveAs` |
| `assertStatus` | – | `value` = expected status code |
| `assertJsonPath` | – | `value` = path, `value2` = expected, `saveAs` |

`type` writes through the native `value` setter before dispatching
`input`/`change`, so framework value trackers (React and friends) see the edit.

### Case and suite

```json
{
  "id": "tc-1", "name": "Login", "continueOnFailure": false,
  "steps": [ ... ],
  "dataset": [ { "user": "ada", "pass": "secret" } ]
}
```

A suite is `{ id, name, cases: [ ... ] }`. A case with an empty `dataset` runs
once; otherwise it runs once per row.

---

## 5. Variables and `{{placeholders}}`

One variable bag per run. It is seeded per data row and then written to by any
step with a `saveAs`, and it **persists across cases in a suite** — which is
what makes API chaining work.

* Dataset columns shadow carried-over variables, so a column always wins.
* Dotted lookups work: `{{user.email}}`, `{{data.items.0.id}}`.
* An **unknown token is left verbatim** rather than replaced with an empty
  string. A visible `{{typo}}` in a failure message beats a silent blank.
* Substitution applies to every string step field, and recursively through
  parsed API headers and bodies.

Chaining example:

```
1. apiRequest  POST https://api.example.com/login
               body    { "user": "{{user}}", "pass": "{{pass}}" }
               capture data.token
               saveAs  token
2. assertStatus 200
3. apiRequest  GET https://api.example.com/me
               headers { "Authorization": "Bearer {{token}}" }
4. assertJsonPath  data.email  {{user}}
```

`apiRequest` sets `Content-Type: application/json` automatically when the body
parses as JSON and no content-type header was supplied. A body that is not JSON
is sent as a raw string.

---

## 6. IPC contract

Handlers follow the `{ ok: true, data }` / `{ ok: false, error }` convention
from `src/main/ipc/fs.js`; the preload `call()` helper unwraps them.

### Invocations

| Channel | Payload | Returns |
| --- | --- | --- |
| `test:runCase` | `{ runId, elements, cases }` | `{ runId, summary }` when the run ends |
| `test:runSuite` | `{ runId, elements, cases }` | same |
| `test:cancel` | `{ runId }` | `{ runId, cancelled: true }` |

Both run channels accept the same shape (`cases`, or `suite.cases`, or
`testCase`), so the renderer never has to branch.

### Events (main → renderer)

`test:step`, emitted before and after every step:

```js
{
  runId, caseId, caseName,
  rowIndex, rowCount,        // data-driven position
  stepId, index, verb,
  status,                    // 'running' | 'pass' | 'fail' | 'skip'
  durationMs,
  error,                     // string on failure
  detail,                    // actual value / URL / status line
  screenshot                 // PNG data URL, auto-captured on web failures
}
```

`test:done`:

```js
{ runId, summary: { total, passed, failed, skipped, durationMs }, cancelled }
```

The **unit of the summary is a step execution**, not a case — which is what
streams, and what the status bar's `passed/total` reflects.

### Cancellation

`test:cancel` adds the run id to a cancelled set *and* destroys every live
automation window. Killing the window is what turns a long `loadURL` or a
`waitForElement` poll into an instant stop instead of a ten-second wait.
Remaining steps are emitted as `skip` so the UI does not leave rows stranded in
`running`.

---

## 7. Failure behaviour

* A failed step aborts the rest of that data row; the remaining steps report
  `skip`. Set `continueOnFailure` on the case to keep going.
* A failed *web* step auto-captures a screenshot of the page as it was when the
  step gave up, and it is attached to the `test:step` event and rendered inline
  in the results panel.
* A thrown error inside `executeJavaScript` is caught **inside the page** and
  returned as `{ ok: false, error }`, so a DOM exception becomes a readable step
  failure instead of an opaque rejected promise.
* An API-only case never creates a browser window at all — the window is created
  lazily on the first web step.

---

## 8. UI notes

* Sidebar view with a toolbar (run all / stop / reload / new suite), a
  Tests | Elements segmented control, a scrolling tree, and a results panel.
* Tree is Suites → Cases → Steps. Double-click a suite or case name to rename.
  Click a step to open its inline editor.
* Live results patch the DOM by `stepId` rather than re-rendering, so an open
  editor and the caret inside it survive a run.
* Motion: rows enter with `row-in` and a stagger of
  `calc(min(var(--i), 12) * var(--stagger))` — capped so a hundred-step case
  does not take three seconds to appear. Pass/fail is a colour *transition* over
  `var(--d-base)` plus a one-shot settle. Every duration is a `--d-*` token, so
  the reduced-motion switch in `tokens.css` collapses all of it.
* All colour comes from the theme contract (`--bg-surface`, `--accent`,
  `--fg-muted`, `--success`, `--danger`, …), so the studio themes along with the
  rest of the IDE.

---

## 9. Security

The automation window runs with `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, and `webSecurity: true`. Injected scripts are plain
page-scope JavaScript with no bridge to Node. All step and locator values are
embedded into injected source through `JSON.stringify`, never by string
concatenation, so a selector containing quotes cannot break out of the snippet.

The `script` verb is an intentional exception: it runs author-supplied
JavaScript in the page, exactly like a browser console. It is as trusted as the
`.nova/tests.json` in the workspace — treat an untrusted workspace's tests the
same way you would treat its build scripts.

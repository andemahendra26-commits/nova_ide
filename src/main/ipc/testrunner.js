const { ipcMain, BrowserWindow } = require('electron');

/**
 * Test Studio runner.
 *
 * Why a hidden BrowserWindow rather than Playwright or Selenium: Electron
 * already ships Chromium, so a windowless BrowserWindow is real browser
 * automation with no extra dependency, no driver/browser version drift, and
 * nothing to download — the IDE stays fully offline-capable. executeJavaScript
 * is the action/assertion channel; capturePage is the evidence channel.
 */

const DEFAULT_TIMEOUT = 10000;
const POLL_MS = 120;
const SHOT_WIDTH = 520;

/** Run ids the renderer asked to stop. Checked between steps and inside polls. */
const cancelled = new Set();
/** Every live automation window, so a cancel can tear them down immediately. */
const liveWindows = new Set();

/* ── result plumbing (same contract as ipc/fs.js) ─────────────────────── */

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, args) => {
    try {
      return { ok: true, data: await fn(args || {}, event) };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
}

function sender(event) {
  return (channel, payload) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
  };
}

/* ── variables and {{placeholder}} substitution ───────────────────────── */

function readPath(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
}

/** Unknown tokens are left verbatim on purpose: a visible {{typo}} beats a silent ''. */
function subst(input, vars) {
  if (typeof input !== 'string') return input;
  return input.replace(/\{\{\s*([\w$.-]+)\s*\}\}/g, (match, key) => {
    const value = readPath(vars, key);
    if (value === undefined || value === null) return match;
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

function substDeep(value, vars) {
  if (typeof value === 'string') return subst(value, vars);
  if (Array.isArray(value)) return value.map((v) => substDeep(v, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[subst(k, vars)] = substDeep(v, vars);
    return out;
  }
  return value;
}

function parseMaybeJson(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/* ── locators ─────────────────────────────────────────────────────────── */

/** Build the page-side expression that resolves one repository element. */
function findExpr(locator) {
  const v = JSON.stringify(String(locator.value || ''));
  switch (locator.strategy) {
    case 'id':
      return `document.getElementById(${v})`;
    case 'xpath':
      // 9 === XPathResult.FIRST_ORDERED_NODE_TYPE, spelled numerically because
      // the constant is not guaranteed on every page's global object.
      return `document.evaluate(${v}, document, null, 9, null).singleNodeValue`;
    case 'text':
      // Deepest node whose own text matches, so a wrapping <div> never wins.
      return `(function(){
        var leaves = Array.prototype.slice.call(document.querySelectorAll('body *'))
          .filter(function(n){ return n.children.length === 0; });
        var want = ${v}.trim();
        return leaves.find(function(n){ return (n.textContent || '').trim() === want; })
          || leaves.find(function(n){ return (n.textContent || '').trim().indexOf(want) !== -1; })
          || null;
      })()`;
    default:
      return `document.querySelector(${v})`;
  }
}

function describeLocator(locator) {
  return `${locator.name || 'element'} (${locator.strategy}: ${locator.value})`;
}

/* ── page evaluation ──────────────────────────────────────────────────── */

/**
 * Run a statement body in the page and get a plain object back. The try/catch
 * lives inside the page so a thrown DOM error becomes a step failure with a
 * message rather than an opaque rejected promise.
 */
function evalInPage(win, body, userGesture = false) {
  const code = `(function(){ try { ${body} } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } })()`;
  return win.webContents.executeJavaScript(code, userGesture);
}

function guard(find, label) {
  return `var t = ${find};
    if (!t) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(label)} };`;
}

/** Page-side literal for a substituted step value. */
function lit(value) {
  return JSON.stringify(value === undefined || value === null ? '' : String(value));
}

/* ── the hidden browser ───────────────────────────────────────────────── */

function createWindow(viewport) {
  const win = new BrowserWindow({
    show: false,
    width: (viewport && viewport.width) || 1280,
    height: (viewport && viewport.height) || 800,
    // A hidden window skips painting unless asked, and an unpainted window
    // captures as an empty image — screenshots depend on this flag.
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
      partition: 'nova-test-runner',
    },
  });
  win.webContents.setAudioMuted(true);
  liveWindows.add(win);
  return win;
}

function destroyWindow(win) {
  if (!win) return;
  liveWindows.delete(win);
  if (!win.isDestroyed()) win.destroy();
}

async function capture(win) {
  try {
    if (!win || win.isDestroyed()) return null;
    const image = await win.webContents.capturePage();
    if (image.isEmpty()) return null;
    return image.resize({ width: SHOT_WIDTH }).toDataURL();
  } catch {
    // Evidence is best-effort; never let a capture failure mask the real result.
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function summarise(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/* ── step execution ───────────────────────────────────────────────────── */

const ELEMENT_VERBS = new Set([
  'click', 'type', 'select', 'hover', 'waitForElement',
  'assertText', 'assertVisible', 'assertAttribute',
]);

async function runStep(ctx, step) {
  const vars = ctx.vars;

  if (ELEMENT_VERBS.has(step.verb)) return runElementStep(ctx, step);

  switch (step.verb) {
    case 'navigate': {
      const url = subst(step.value, vars);
      if (!url) return { ok: false, error: 'No URL given' };
      const win = await ctx.getWin();
      try {
        await win.loadURL(url);
      } catch (err) {
        // ERR_ABORTED is what a same-page redirect looks like from out here.
        if (err && err.code !== 'ERR_ABORTED' && err.errno !== -3) throw err;
      }
      return { ok: true, detail: win.webContents.getURL() };
    }

    case 'wait': {
      const ms = Math.max(0, Number(subst(step.value, vars)) || 0);
      await sleep(ms);
      return { ok: true, detail: `${ms} ms` };
    }

    case 'screenshot': {
      const win = await ctx.getWin();
      return { ok: true, detail: subst(step.value, vars) || 'screenshot', screenshot: await capture(win) };
    }

    case 'script': {
      const win = await ctx.getWin();
      const source = subst(step.value, vars) || 'return null;';
      const result = await win.webContents.executeJavaScript(`(function(){ ${source} })()`, true);
      if (step.saveAs) vars[step.saveAs] = result;
      return { ok: true, detail: summarise(result) };
    }

    case 'assertUrl': {
      const win = await ctx.getWin();
      const actual = win.webContents.getURL();
      const expected = subst(step.value, vars) || '';
      const exact = step.match === 'equals';
      const ok = exact ? actual === expected : actual.includes(expected);
      if (ok) return { ok: true, detail: actual };
      return { ok: false, error: `URL ${exact ? 'is not' : 'does not contain'} "${expected}"`, detail: actual };
    }

    case 'apiRequest':
      return runApiRequest(ctx, step);

    case 'assertStatus': {
      if (!ctx.last) return { ok: false, error: 'No API response yet — add an API request step first' };
      const expected = Number(subst(step.value, vars));
      if (ctx.last.status === expected) return { ok: true, detail: String(ctx.last.status) };
      return { ok: false, error: `Expected status ${expected}, got ${ctx.last.status}`, detail: String(ctx.last.status) };
    }

    case 'assertJsonPath': {
      if (!ctx.last) return { ok: false, error: 'No API response yet — add an API request step first' };
      const jsonPath = subst(step.value, vars) || '';
      const actual = readPath(ctx.last.json, jsonPath);
      if (step.saveAs) vars[step.saveAs] = actual;

      // With no expected value the step is purely a capture: existence is the assertion.
      if (step.value2 === undefined || step.value2 === null || step.value2 === '') {
        if (actual === undefined) return { ok: false, error: `No value at "${jsonPath}"`, detail: jsonPath };
        return { ok: true, detail: summarise(actual) };
      }
      const expected = subst(step.value2, vars);
      if (String(actual) === String(expected)) return { ok: true, detail: summarise(actual) };
      return { ok: false, error: `Expected "${expected}" at "${jsonPath}", got ${summarise(actual)}` };
    }

    default:
      return { ok: false, error: `Unknown step type "${step.verb}"` };
  }
}

async function runElementStep(ctx, step) {
  const vars = ctx.vars;
  const locator = ctx.elements.find((e) => e.id === step.element);
  if (!locator) return { ok: false, error: 'Step has no element from the repository' };

  // Locator values take placeholders too, so one row can target one card.
  const resolved = { ...locator, value: subst(locator.value, vars) };
  const find = findExpr(resolved);
  const label = describeLocator(resolved);
  const win = await ctx.getWin();
  const value = subst(step.value, vars);

  switch (step.verb) {
    case 'waitForElement': {
      const timeout = Math.max(250, Number(subst(step.timeout, vars)) || DEFAULT_TIMEOUT);
      const deadline = Date.now() + timeout;
      for (;;) {
        if (cancelled.has(ctx.runId)) return { ok: false, error: 'Cancelled' };
        const res = await evalInPage(win, `return { ok: !!(${find}) };`);
        if (res && res.ok) return { ok: true, detail: label };
        if (Date.now() >= deadline) return { ok: false, error: `Timed out after ${timeout} ms waiting for ${label}` };
        await sleep(POLL_MS);
      }
    }

    case 'click':
      return evalInPage(win, [
        guard(find, label),
        "t.scrollIntoView({ block: 'center', inline: 'center' });",
        'if (t.focus) t.focus();',
        't.click();',
        "return { ok: true, detail: (t.tagName || '').toLowerCase() };",
      ].join('\n'), true);

    case 'type':
      return evalInPage(win, [
        guard(find, label),
        `var text = ${lit(value)};`,
        "t.scrollIntoView({ block: 'center' });",
        'if (t.focus) t.focus();',
        "if ('value' in t) {",
        '  var proto = t instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;',
        "  var desc = Object.getOwnPropertyDescriptor(proto, 'value');",
        '  // Go through the native setter so React-style value trackers see the change.',
        '  if (desc && desc.set) desc.set.call(t, text); else t.value = text;',
        '} else {',
        '  t.textContent = text;',
        '}',
        "t.dispatchEvent(new Event('input', { bubbles: true }));",
        "t.dispatchEvent(new Event('change', { bubbles: true }));",
        'return { ok: true, detail: text };',
      ].join('\n'), true);

    case 'select':
      return evalInPage(win, [
        guard(find, label),
        `var want = ${lit(value)};`,
        "if (!t.options) return { ok: false, error: 'Not a <select> element' };",
        'var opts = Array.prototype.slice.call(t.options);',
        'var hit = opts.filter(function(o){ return o.value === want; })[0]',
        "  || opts.filter(function(o){ return (o.textContent || '').trim() === want; })[0];",
        'if (!hit) return { ok: false, error: \'No option matching "\' + want + \'"\' };',
        't.value = hit.value;',
        "t.dispatchEvent(new Event('input', { bubbles: true }));",
        "t.dispatchEvent(new Event('change', { bubbles: true }));",
        'return { ok: true, detail: hit.value };',
      ].join('\n'), true);

    case 'hover':
      return evalInPage(win, [
        guard(find, label),
        "t.scrollIntoView({ block: 'center' });",
        'var r = t.getBoundingClientRect();',
        'var init = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };',
        "['pointerover', 'mouseover', 'mouseenter', 'mousemove'].forEach(function(type){",
        '  t.dispatchEvent(new MouseEvent(type, init));',
        '});',
        'return { ok: true };',
      ].join('\n'), true);

    case 'assertText': {
      const exact = step.match === 'equals';
      return evalInPage(win, [
        guard(find, label),
        "var actual = ((('value' in t) ? t.value : t.textContent) || '').trim();",
        `var want = ${lit(value)}.trim();`,
        `var ok = ${exact ? 'actual === want' : 'actual.indexOf(want) !== -1'};`,
        'if (ok) return { ok: true, detail: actual };',
        `return { ok: false, error: 'Text ${exact ? 'is not' : 'does not contain'} "' + want + '"', detail: actual };`,
      ].join('\n'));
    }

    case 'assertVisible':
      return evalInPage(win, [
        guard(find, label),
        'var s = getComputedStyle(t);',
        'var r = t.getBoundingClientRect();',
        "var visible = s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01 && r.width > 0 && r.height > 0;",
        "if (visible) return { ok: true, detail: Math.round(r.width) + 'x' + Math.round(r.height) };",
        "return { ok: false, error: 'Element is present but not visible' };",
      ].join('\n'));

    case 'assertAttribute':
      return evalInPage(win, [
        guard(find, label),
        `var name = ${lit(value)};`,
        `var want = ${lit(subst(step.value2, vars))};`,
        'var actual = t.getAttribute(name);',
        "if (String(actual) === want) return { ok: true, detail: name + '=' + actual };",
        'return { ok: false, error: \'Expected \' + name + \'="\' + want + \'", got "\' + actual + \'"\', detail: String(actual) };',
      ].join('\n'));

    default:
      return { ok: false, error: `Unknown element step "${step.verb}"` };
  }
}

async function runApiRequest(ctx, step) {
  const vars = ctx.vars;
  const url = subst(step.url, vars);
  if (!url) return { ok: false, error: 'No URL given' };

  const method = (step.method || 'GET').toUpperCase();
  const headers = substDeep(parseMaybeJson(step.headers) || {}, vars);
  const timeout = Math.max(500, Number(subst(step.timeout, vars)) || DEFAULT_TIMEOUT);

  const init = { method, headers: { ...headers } };
  if (method !== 'GET' && method !== 'HEAD' && step.body) {
    const parsed = substDeep(parseMaybeJson(step.body), vars);
    if (parsed && typeof parsed === 'object') {
      init.body = JSON.stringify(parsed);
      if (!Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) {
        init.headers['Content-Type'] = 'application/json';
      }
    } else {
      init.body = String(parsed);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  init.signal = controller.signal;

  const started = Date.now();
  let response;
  let text = '';
  try {
    response = await fetch(url, init);
    text = await response.text();
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted ? `Request timed out after ${timeout} ms` : `Request failed: ${(err && err.message) || err}`,
    };
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON bodies are fine; assertJsonPath will simply find nothing.
  }

  const headerObj = {};
  response.headers.forEach((v, k) => { headerObj[k] = v; });

  ctx.last = {
    status: response.status,
    ok: response.ok,
    headers: headerObj,
    body: text,
    json,
    durationMs: Date.now() - started,
  };

  if (step.saveAs) {
    const captured = step.capture ? readPath(json, subst(step.capture, vars)) : (json !== null ? json : text);
    vars[step.saveAs] = captured;
  }

  return { ok: true, detail: `${response.status} ${response.statusText || ''} · ${ctx.last.durationMs} ms`.trim() };
}

/* ── run orchestration ────────────────────────────────────────────────── */

const WEB_VERBS = new Set([
  'navigate', 'click', 'type', 'select', 'hover', 'waitForElement',
  'assertText', 'assertVisible', 'assertUrl', 'assertAttribute', 'screenshot', 'script',
]);

async function runRow({ runId, testCase, rowIndex, rowCount, row, elements, vars, send, summary }) {
  let win = null;
  const ctx = {
    runId,
    elements,
    vars,
    last: null,
    // Lazily created: an API-only case never opens a browser at all.
    getWin: async () => {
      if (!win) win = createWindow(testCase.viewport);
      return win;
    },
  };

  // A data row shadows carried-over variables, so a dataset column always wins.
  if (row) Object.assign(vars, row);

  const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
  let aborted = false;

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const base = {
        runId,
        caseId: testCase.id,
        caseName: testCase.name,
        rowIndex,
        rowCount,
        stepId: step.id,
        index: i,
        verb: step.verb,
      };

      if (aborted || cancelled.has(runId) || step.enabled === false) {
        summary.total++;
        summary.skipped++;
        send('test:step', { ...base, status: 'skip', durationMs: 0 });
        continue;
      }

      send('test:step', { ...base, status: 'running' });
      const t0 = Date.now();
      let res;
      try {
        res = await runStep(ctx, step);
      } catch (err) {
        res = { ok: false, error: (err && err.message) || String(err) };
      }
      const durationMs = Date.now() - t0;

      // Failure evidence: the page as it was at the moment the step gave up.
      if (!res.ok && !res.screenshot && win && WEB_VERBS.has(step.verb)) {
        res.screenshot = await capture(win);
      }

      summary.total++;
      if (res.ok) {
        summary.passed++;
      } else {
        summary.failed++;
        aborted = testCase.continueOnFailure !== true;
      }

      send('test:step', {
        ...base,
        status: res.ok ? 'pass' : 'fail',
        durationMs,
        error: res.error || null,
        detail: res.detail === undefined ? null : res.detail,
        screenshot: res.screenshot || null,
      });
    }
  } finally {
    // Unconditional: a thrown step, a cancel, or a crashed page must never
    // leave an invisible Chromium window alive behind the IDE.
    destroyWindow(win);
  }
}

async function executeRun({ runId, cases, elements, send }) {
  const started = Date.now();
  const summary = { total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 };
  // Shared across cases so an API chain can hand a token to the next case.
  const vars = {};

  try {
    for (const testCase of cases) {
      const dataset = Array.isArray(testCase.dataset) && testCase.dataset.length ? testCase.dataset : [null];
      for (let r = 0; r < dataset.length; r++) {
        await runRow({
          runId,
          testCase,
          rowIndex: r,
          rowCount: dataset.length,
          row: dataset[r],
          elements,
          vars,
          send,
          summary,
        });
      }
    }
  } finally {
    summary.durationMs = Date.now() - started;
    const wasCancelled = cancelled.has(runId);
    cancelled.delete(runId);
    send('test:done', { runId, summary, cancelled: wasCancelled });
  }

  return { runId, summary };
}

/** One payload shape for both run channels keeps the renderer side trivial. */
function normaliseCases(payload) {
  if (Array.isArray(payload.cases)) return payload.cases;
  if (payload.suite && Array.isArray(payload.suite.cases)) return payload.suite.cases;
  if (payload.testCase) return [payload.testCase];
  return [];
}

function register() {
  const start = async (payload, event) => {
    const runId = payload.runId || `run-${Date.now()}`;
    cancelled.delete(runId);
    return executeRun({
      runId,
      cases: normaliseCases(payload),
      elements: payload.elements || [],
      send: sender(event),
    });
  };

  handle('test:runCase', start);
  handle('test:runSuite', start);

  handle('test:cancel', async ({ runId }) => {
    if (runId) cancelled.add(runId);
    // Tearing the windows down turns a long loadURL or poll into an instant stop.
    for (const win of [...liveWindows]) destroyWindow(win);
    return { runId: runId || null, cancelled: true };
  });
}

module.exports = { register };

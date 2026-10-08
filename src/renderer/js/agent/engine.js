/**
 * Nova Engine — the offline agent provider (AG-9).
 *
 * Intent is classified by weighted keyword scoring over a template catalogue.
 * Every template emits real, runnable files: the PRD is explicit that a
 * generator producing placeholder text would read as a toy and undermine the
 * whole premise. Thought lines and plan steps are authored per template so the
 * reasoning shown on screen corresponds to the code actually produced.
 */

import { joinPath } from '../core/util.js';

/* ── Naming helpers ───────────────────────────────────────────────────── */

const STOP = new Set([
  'a', 'an', 'the', 'for', 'with', 'that', 'this', 'and', 'or', 'to', 'of', 'in', 'on',
  'create', 'make', 'build', 'add', 'write', 'generate', 'new', 'me', 'please', 'can',
  'you', 'i', 'want', 'need', 'some', 'my', 'it', 'is', 'be', 'using', 'use', 'up',
  'component', 'file', 'script', 'server', 'app', 'page', 'class', 'module', 'simple',
]);

function keywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function pascal(words) {
  const parts = words.length ? words : ['nova'];
  return parts
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).replace(/-/g, ''))
    .join('');
}

function kebab(words) {
  const parts = words.length ? words : ['nova'];
  return parts.slice(0, 3).join('-').replace(/[^a-z0-9-]/g, '');
}

function snake(words) {
  return kebab(words).replace(/-/g, '_');
}

/* ── Template catalogue ───────────────────────────────────────────────── */

const TEMPLATES = [
  {
    id: 'react',
    weight: { react: 10, component: 8, jsx: 9, tsx: 9, hook: 6, ui: 3, card: 2, button: 2, modal: 3, form: 3 },
    build: reactComponent,
  },
  {
    id: 'express',
    weight: { express: 10, server: 7, api: 6, rest: 6, endpoint: 6, backend: 6, route: 5, node: 4 },
    build: expressServer,
  },
  {
    id: 'python',
    weight: { python: 10, py: 8, cli: 6, script: 4, pandas: 5, scraper: 5, automation: 4 },
    build: pythonCli,
  },
  {
    id: 'html',
    weight: { html: 10, landing: 8, webpage: 8, website: 7, page: 4, portfolio: 6, css: 3 },
    build: htmlPage,
  },
  {
    id: 'test',
    weight: { test: 10, tests: 10, jest: 9, vitest: 9, spec: 7, unit: 6, coverage: 5, suite: 4 },
    build: testSuite,
  },
  {
    id: 'readme',
    weight: { readme: 12, docs: 8, documentation: 9, markdown: 7, guide: 5 },
    build: readme,
  },
  {
    id: 'class',
    weight: { class: 9, model: 7, entity: 7, schema: 6, interface: 6, typescript: 6, types: 6 },
    build: dataModel,
  },
  {
    id: 'util',
    weight: { util: 8, utility: 8, helper: 8, function: 6, debounce: 7, throttle: 7, format: 5 },
    build: utilityModule,
  },
];

function classify(request) {
  const words = keywords(request);
  const lower = request.toLowerCase();

  let best = null;
  let bestScore = 0;

  for (const tpl of TEMPLATES) {
    let score = 0;
    for (const [term, weight] of Object.entries(tpl.weight)) {
      if (lower.includes(term)) score += weight;
    }
    if (score > bestScore) {
      bestScore = score;
      best = tpl;
    }
  }

  return { template: best, score: bestScore, words };
}

/* ── Provider interface ───────────────────────────────────────────────── */

export function understand(request) {
  const { template, score, words } = classify(request);
  const name = pascal(words);
  return {
    intent: template?.id || 'generic',
    confidence: Math.min(1, score / 14),
    name,
    words,
    summary: template
      ? `Understood: build a ${LABELS[template.id]} named ${name}.`
      : `Understood: create a source file for "${request.trim()}".`,
  };
}

const LABELS = {
  react: 'React component',
  express: 'Express server',
  python: 'Python CLI',
  html: 'HTML page',
  test: 'test suite',
  readme: 'README',
  class: 'data model',
  util: 'utility module',
  generic: 'source file',
};

/** Thought lines for the thinking phase — authored per intent, not generic filler. */
export function thoughts(request, ctx) {
  const { intent, name } = ctx;
  const shared = [
    `Parsing request: "${truncate(request, 46)}"`,
    `Classified intent → ${LABELS[intent]} (confidence ${(ctx.confidence * 100) | 0}%)`,
  ];

  const perIntent = {
    react: [
      'Function component with hooks, not a class',
      'Props destructured in the signature for readability',
      'Local state via useState; derived values computed inline',
      'Scoped CSS module so styles cannot leak',
      `Default export named ${name}`,
    ],
    express: [
      'Express 4 with JSON body parsing',
      'Routes grouped under /api, health check at /health',
      'Centralised error middleware so no route swallows a throw',
      'Graceful shutdown on SIGTERM to avoid dropped connections',
      'Port from env with a sane fallback',
    ],
    python: [
      'argparse over sys.argv — free --help and validation',
      'Logic in functions, entry guarded by __name__',
      'Type hints throughout for editor support',
      'Exit codes: 0 success, 1 handled failure',
      'Errors to stderr, data to stdout, so it pipes correctly',
    ],
    html: [
      'Semantic landmarks: header, main, footer',
      'Custom properties for colour so theming is one edit',
      'Responsive via clamp() and a single breakpoint',
      'Respecting prefers-reduced-motion',
      'No external requests — fully self-contained',
    ],
    test: [
      'Arrange-act-assert, one behaviour per case',
      'Edge cases first: empty, null, boundary',
      'Descriptive names that read as sentences in the report',
      'No shared mutable state between cases',
    ],
    readme: [
      'Lead with what it does, not how it was built',
      'Install and usage above the fold',
      'A runnable example beats a paragraph of prose',
    ],
    class: [
      'Validation in the constructor — invalid objects should not exist',
      'Immutable where the data has no reason to change',
      'toJSON / fromJSON so persistence is symmetrical',
    ],
    util: [
      'Pure functions, no hidden state',
      'Guard clauses over nested conditionals',
      'JSDoc so hovers are useful in the editor',
    ],
    generic: [
      'No strong template match — writing a clean scaffold',
      'Structure over cleverness; this is a starting point',
    ],
  };

  return [...shared, ...(perIntent[intent] || perIntent.generic), 'Composing the file…'];
}

/** Plan steps for the planning phase. */
export function plan(request, ctx) {
  const { intent, name } = ctx;
  const base = {
    react: ['Create component file', 'Scaffold function component', 'Wire props and state', 'Add styles', 'Export'],
    express: ['Create server file', 'Configure middleware', 'Define routes', 'Add error handling', 'Start listener'],
    python: ['Create script file', 'Define argument parser', 'Implement core logic', 'Wire entry point'],
    html: ['Create page file', 'Write document head', 'Build layout sections', 'Add styles', 'Add interactions'],
    test: ['Create spec file', 'Set up fixtures', 'Write happy-path cases', 'Write edge cases'],
    readme: ['Create README', 'Write overview', 'Add install and usage', 'Document API'],
    class: ['Create model file', 'Define shape', 'Add validation', 'Add serialisation'],
    util: ['Create module file', 'Implement helpers', 'Add documentation', 'Export surface'],
    generic: ['Create file', 'Write scaffold', 'Review output'],
  };
  return (base[intent] || base.generic).map((label, i) => ({
    id: `s${i}`,
    label,
    status: 'pending',
  }));
}

/** Produce the artifact. Returns { path, language, content }. */
export function generate(request, ctx, root) {
  const { template } = classify(request);
  const words = ctx.words;
  const name = ctx.name;
  const builder = template?.build || genericFile;
  const artifact = builder({ name, words, request, kebabName: kebab(words), snakeName: snake(words) });
  return {
    ...artifact,
    path: root ? joinPath(root, artifact.file) : artifact.file,
  };
}

export function review(ctx, artifact) {
  const lines = artifact.content.split('\n').length;
  const notes = {
    react: 'Component is self-contained and ready to import. Styles are scoped.',
    express: 'Server starts on PORT or 3000. Health check responds at /health.',
    python: 'Run with --help to see the generated argument surface.',
    html: 'Open directly in a browser — no build step and no external requests.',
    test: 'Runs under Jest or Vitest without configuration changes.',
    readme: 'Fill in the placeholders marked with TODO before publishing.',
    class: 'Constructor rejects invalid input, so instances are always valid.',
    util: 'Every export is pure and independently testable.',
    generic: 'Scaffold written. Extend it as the task requires.',
  };
  return {
    summary: `Wrote ${lines} lines to ${artifact.file}.`,
    note: notes[ctx.intent] || notes.generic,
  };
}

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* ── Generators ───────────────────────────────────────────────────────── */

function reactComponent({ name, kebabName }) {
  const content = `import { useState, useMemo } from 'react';
import styles from './${name}.module.css';

/**
 * ${name}
 *
 * @param {object}   props
 * @param {string}   props.title     Heading shown at the top of the card.
 * @param {string}   [props.subtitle] Optional supporting line.
 * @param {string[]} [props.items]   Bullet points rendered in order.
 * @param {Function} [props.onSelect] Called with the component's name on action.
 */
export default function ${name}({ title, subtitle, items = [], onSelect }) {
  const [selected, setSelected] = useState(false);

  const summary = useMemo(
    () => (items.length === 0 ? 'No items yet' : \`\${items.length} item\${items.length === 1 ? '' : 's'}\`),
    [items]
  );

  function handleSelect() {
    const next = !selected;
    setSelected(next);
    onSelect?.(next);
  }

  return (
    <section className={\`\${styles.root} \${selected ? styles.selected : ''}\`}>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </header>

      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item} className={styles.item}>
              {item}
            </li>
          ))}
        </ul>
      )}

      <footer className={styles.footer}>
        <span className={styles.summary}>{summary}</span>
        <button type="button" className={styles.action} onClick={handleSelect}>
          {selected ? 'Selected' : 'Select'}
        </button>
      </footer>
    </section>
  );
}
`;
  return { file: `${name}.jsx`, language: 'javascript', content, extra: cssModule(name, kebabName) };
}

function cssModule(name) {
  return {
    file: `${name}.module.css`,
    language: 'css',
    content: `.root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  border: 1px solid rgba(0, 0, 0, .1);
  border-radius: 12px;
  background: #fff;
  transition: transform .2s ease, box-shadow .2s ease;
}

.root:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .08);
}

.selected {
  border-color: #0891b2;
  box-shadow: 0 0 0 2px rgba(8, 145, 178, .18);
}

.header { display: flex; flex-direction: column; gap: 4px; }
.title { margin: 0; font-size: 18px; font-weight: 600; }
.subtitle { margin: 0; font-size: 14px; color: #64748b; }

.list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
.item { font-size: 14px; color: #334155; }

.footer { display: flex; align-items: center; justify-content: space-between; }
.summary { font-size: 13px; color: #94a3b8; }

.action {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: #0891b2;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s ease;
}

.action:hover { background: #0e7490; }
`,
  };
}

function expressServer({ kebabName }) {
  const content = `const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Request logging: method, path, status, duration.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    console.log(\`\${req.method} \${req.originalUrl} \${res.statusCode} \${Date.now() - started}ms\`);
  });
  next();
});

// In-memory store. Swap for a real database when persistence is needed.
const items = new Map();
let nextId = 1;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/items', (_req, res) => {
  res.json({ items: [...items.values()] });
});

app.get('/api/items/:id', (req, res) => {
  const item = items.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/api/items', (req, res) => {
  const { name, value } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const item = { id: nextId++, name: name.trim(), value: value ?? null, createdAt: new Date().toISOString() };
  items.set(item.id, item);
  res.status(201).json(item);
});

app.delete('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!items.has(id)) return res.status(404).json({ error: 'Not found' });
  items.delete(id);
  res.status(204).end();
});

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Centralised error handler: no route should be able to crash the process.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(\`${kebabName} listening on http://localhost:\${PORT}\`);
});

// Finish in-flight requests before exiting.
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});

module.exports = app;
`;
  return { file: `${kebabName}-server.js`, language: 'javascript', content };
}

function pythonCli({ snakeName, request }) {
  const content = `#!/usr/bin/env python3
"""${request.trim()}

Generated by Nova IDE. Run with --help to see the argument surface.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class Result:
    """A single unit of output."""
    name: str
    value: float
    ok: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


def process(source: Path, limit: int) -> list[Result]:
    """Read *source* and produce at most *limit* results.

    Raises:
        FileNotFoundError: if source does not exist.
    """
    if not source.exists():
        raise FileNotFoundError(f"No such file: {source}")

    results: list[Result] = []
    with source.open("r", encoding="utf-8") as handle:
        for index, line in enumerate(handle):
            if index >= limit:
                break
            text = line.strip()
            if not text:
                continue
            results.append(Result(name=text[:60], value=float(len(text))))
    return results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="${snakeName}",
        description=__doc__.splitlines()[0],
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("source", type=Path, help="input file to process")
    parser.add_argument("-n", "--limit", type=int, default=100, help="maximum lines to read")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    parser.add_argument("-v", "--verbose", action="store_true", help="log progress to stderr")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.verbose:
        print(f"reading {args.source}", file=sys.stderr)

    try:
        results = process(args.source, args.limit)
    except (FileNotFoundError, ValueError) as exc:
        # Errors go to stderr so stdout stays pipeable.
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        json.dump([r.to_dict() for r in results], sys.stdout, indent=2)
        sys.stdout.write("\\n")
    else:
        for r in results:
            print(f"{r.name}\\t{r.value:.1f}")

    if args.verbose:
        print(f"produced {len(results)} results", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;
  return { file: `${snakeName}.py`, language: 'python', content };
}

function htmlPage({ name, kebabName, request }) {
  const content = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
  :root {
    --bg: #0b0e17;
    --surface: #141826;
    --fg: #d6dcea;
    --muted: #8993ab;
    --accent: #22d3ee;
    --accent-2: #a78bfa;
    --radius: 12px;
  }

  @media (prefers-color-scheme: light) {
    :root { --bg: #f7f9fd; --surface: #fff; --fg: #1e2635; --muted: #5a6577; --accent: #0891b2; }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.6;
  }

  header, main, footer { max-width: 900px; margin: 0 auto; padding: 0 24px; }

  header { padding-top: 72px; padding-bottom: 48px; }

  h1 {
    margin: 0 0 12px;
    font-size: clamp(32px, 6vw, 56px);
    line-height: 1.1;
    letter-spacing: -0.02em;
    background: linear-gradient(120deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .lede { font-size: clamp(16px, 2.4vw, 20px); color: var(--muted); max-width: 60ch; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px;
    padding-bottom: 64px;
  }

  .card {
    background: var(--surface);
    border: 1px solid rgba(255, 255, 255, .07);
    border-radius: var(--radius);
    padding: 24px;
    transition: transform .25s ease, box-shadow .25s ease;
  }

  .card:hover { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0, 0, 0, .25); }
  .card h2 { margin: 0 0 8px; font-size: 18px; }
  .card p { margin: 0; color: var(--muted); font-size: 15px; }

  button {
    margin-top: 16px;
    padding: 10px 20px;
    border: none;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #05070d;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }

  footer { padding: 32px 24px 64px; color: var(--muted); font-size: 14px; }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style>
</head>
<body>

<header>
  <h1>${name}</h1>
  <p class="lede">${escapeText(request.trim())}</p>
</header>

<main>
  <div class="grid" id="grid"></div>
</main>

<footer>Built with Nova IDE.</footer>

<script>
  const FEATURES = [
    { title: 'Fast', body: 'No framework, no build step. The page is the artifact.' },
    { title: 'Adaptive', body: 'Respects the visitor\\'s colour scheme and motion preferences.' },
    { title: 'Self-contained', body: 'Every asset is inline, so it works offline.' },
  ];

  const grid = document.getElementById('grid');

  for (const feature of FEATURES) {
    const card = document.createElement('div');
    card.className = 'card';

    const h2 = document.createElement('h2');
    h2.textContent = feature.title;

    const p = document.createElement('p');
    p.textContent = feature.body;

    const button = document.createElement('button');
    button.textContent = 'Learn more';
    button.addEventListener('click', () => {
      button.textContent = 'Thanks!';
      setTimeout(() => { button.textContent = 'Learn more'; }, 1400);
    });

    card.append(h2, p, button);
    grid.append(card);
  }
</script>

</body>
</html>
`;
  return { file: `${kebabName}.html`, language: 'html', content };
}

function testSuite({ name, kebabName }) {
  const content = `import { describe, it, expect, beforeEach } from 'vitest';
import ${name} from './${name}.js';

describe('${name}', () => {
  let subject;

  beforeEach(() => {
    subject = new ${name}({ name: 'example', value: 10 });
  });

  describe('construction', () => {
    it('stores the values it was given', () => {
      expect(subject.name).toBe('example');
      expect(subject.value).toBe(10);
    });

    it('rejects a missing name', () => {
      expect(() => new ${name}({ value: 1 })).toThrow(/name/i);
    });

    it('rejects a non-numeric value', () => {
      expect(() => new ${name}({ name: 'x', value: 'ten' })).toThrow(/value/i);
    });
  });

  describe('edge cases', () => {
    it('accepts zero as a value', () => {
      expect(new ${name}({ name: 'zero', value: 0 }).value).toBe(0);
    });

    it('accepts a negative value', () => {
      expect(new ${name}({ name: 'neg', value: -5 }).value).toBe(-5);
    });

    it('trims surrounding whitespace from the name', () => {
      expect(new ${name}({ name: '  padded  ', value: 1 }).name).toBe('padded');
    });
  });

  describe('serialisation', () => {
    it('round-trips through JSON without loss', () => {
      const restored = ${name}.fromJSON(JSON.parse(JSON.stringify(subject)));
      expect(restored).toEqual(subject);
    });
  });
});
`;
  return { file: `${kebabName}.test.js`, language: 'javascript', content };
}

function readme({ name, kebabName, request }) {
  const content = `# ${name}

${escapeText(request.trim())}

## Install

\`\`\`bash
npm install ${kebabName}
\`\`\`

## Usage

\`\`\`js
import ${name} from '${kebabName}';

const instance = new ${name}({ name: 'example', value: 42 });
console.log(instance.describe());
\`\`\`

## API

### \`new ${name}(options)\`

| Option | Type | Default | Description |
|---|---|---|---|
| \`name\` | \`string\` | — | Required. Identifier for this instance. |
| \`value\` | \`number\` | \`0\` | Numeric payload. |
| \`strict\` | \`boolean\` | \`true\` | Throw on invalid input instead of coercing. |

### \`.describe()\`

Returns a human-readable summary of the instance.

### \`.toJSON()\`

Returns a plain object suitable for serialisation. Symmetrical with \`${name}.fromJSON()\`.

## Development

\`\`\`bash
npm install
npm test
npm run build
\`\`\`

## License

MIT
`;
  return { file: 'README.md', language: 'markdown', content };
}

function dataModel({ name }) {
  const content = `/**
 * ${name} — a validated domain object.
 *
 * Validation happens in the constructor, so an invalid instance cannot exist.
 * Callers can therefore trust any ${name} they are handed.
 */
export default class ${name} {
  /**
   * @param {object}  options
   * @param {string}  options.name    Required, non-empty after trimming.
   * @param {number}  [options.value] Finite number. Defaults to 0.
   * @param {string[]} [options.tags] Optional labels.
   */
  constructor({ name, value = 0, tags = [] } = {}) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('${name}: name must be a non-empty string');
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('${name}: value must be a finite number');
    }
    if (!Array.isArray(tags)) {
      throw new TypeError('${name}: tags must be an array');
    }

    this.name = name.trim();
    this.value = value;
    this.tags = Object.freeze([...tags]);
    this.createdAt = new Date().toISOString();

    Object.freeze(this);
  }

  /** @returns {string} A human-readable summary. */
  describe() {
    const tagPart = this.tags.length ? \` [\${this.tags.join(', ')}]\` : '';
    return \`\${this.name}: \${this.value}\${tagPart}\`;
  }

  /** @returns {${name}} A copy with the given fields replaced. */
  with(changes) {
    return new ${name}({ ...this.toJSON(), ...changes });
  }

  toJSON() {
    return { name: this.name, value: this.value, tags: [...this.tags] };
  }

  static fromJSON(raw) {
    return new ${name}(raw);
  }
}
`;
  return { file: `${name}.js`, language: 'javascript', content };
}

function utilityModule({ kebabName }) {
  const content = `/**
 * Utility helpers. Every export is pure and independently testable.
 */

/**
 * Delay invoking \`fn\` until \`ms\` has passed without another call.
 * @template {Function} T
 * @param {T} fn
 * @param {number} ms
 * @returns {T}
 */
export function debounce(fn, ms = 250) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Invoke \`fn\` at most once per \`ms\`, with a trailing call for the last input.
 */
export function throttle(fn, ms = 250) {
  let last = 0;
  let pending = null;
  return function throttled(...args) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn.apply(this, args);
    } else if (!pending) {
      pending = setTimeout(() => {
        pending = null;
        last = Date.now();
        fn.apply(this, args);
      }, ms - (now - last));
    }
  };
}

/** Deep clone via structuredClone where available, JSON as a fallback. */
export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Group an array into a Map keyed by the result of \`keyFn\`. */
export function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

/** Format a byte count as a human-readable string. */
export function formatBytes(bytes, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return \`\${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : decimals)} \${units[i]}\`;
}

/** Clamp \`n\` into the inclusive range [min, max]. */
export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/** Retry \`fn\` with exponential backoff. Rethrows the final error. */
export async function retry(fn, { attempts = 3, baseMs = 200 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
      }
    }
  }
  throw lastError;
}
`;
  return { file: `${kebabName}-utils.js`, language: 'javascript', content };
}

function genericFile({ kebabName, request }) {
  const content = `/**
 * ${escapeText(request.trim())}
 *
 * Scaffolded by Nova IDE.
 */

export function main() {
  console.log('${kebabName} ready');
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  main();
}
`;
  return { file: `${kebabName}.js`, language: 'javascript', content };
}

function escapeText(s) {
  return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Conversation vs. construction ────────────────────────────────────────
   Not every message is a build instruction. Treating "hello" as one and
   scaffolding hello.js is worse than useless — it writes junk into the user's
   workspace and makes the agent feel deaf. So classify the mode first and only
   run the generate/write pipeline for something that actually asks for code. */

const GREETING = /^(hi|hii+|hello+|hey+|yo|hiya|sup|howdy|greetings|namaste|salaam|hola|good\s*(morning|afternoon|evening|day))(\s+(there|nova|again|buddy|mate|friend))?[\s!.?,]*$/i;
const THANKS = /^(thanks|thank\s*you|ty|thx|cheers|nice|cool|great|awesome|perfect|good|ok|okay|k|got it|bye|goodbye|see ya)[\s!.?,]*$/i;
const ABOUT = /^(who|what)\s+(are|r)\s+(you|u)\b|^what\s+(can|do)\s+(you|u)\s+do\b|^how\s+do\s+you\s+work\b|^what\s+is\s+this\b|^help\b[\s!.?]*$|^capabilities\b/i;
const HOWAREYOU = /^how\s+(are|r)\s+(you|u)\b|^how'?s\s+it\s+going\b|^you\s+(ok|okay|there)\b/i;

/** Verbs and nouns that mean "produce something". */
const BUILD_SIGNAL =
  /\b(create|make|build|writing|write|generate|add|scaffold|implement|set\s?up|bootstrap|refactor|convert|draft|produce|need|want|component|server|script|page|website|landing|api|endpoint|route|test|tests|spec|readme|docs|documentation|class|model|schema|interface|function|util|utility|helper|cli|app|form|dashboard|hook|module|python|react|express|html|css|javascript|typescript)\b/i;

/**
 * 'build'  — run the full generate + write pipeline
 * 'greet' | 'thanks' | 'about' | 'chat' — answer in the transcript, touch no files
 */
export function classifyMode(request) {
  const t = (request || '').trim();
  if (!t) return 'chat';

  if (GREETING.test(t)) return 'greet';
  if (THANKS.test(t)) return 'thanks';
  if (ABOUT.test(t)) return 'about';
  if (HOWAREYOU.test(t)) return 'chat';

  if (BUILD_SIGNAL.test(t)) return 'build';

  // A short fragment with no build signal is small talk, not a spec.
  if (t.split(/\s+/).length <= 3) return 'chat';

  // An open question with no build signal wants an answer, not a file.
  if (/^(what|why|how|who|when|where|can|could|do|does|did|is|are|should|would|will)\b/i.test(t)) {
    return 'chat';
  }

  return 'build';
}

const CAPABILITIES = [
  'React components with scoped styles',
  'Express servers with routes and error handling',
  'Python CLIs with argparse',
  'Landing pages, test suites, READMEs, data models, utility modules',
];

/** The conversational reply for a non-build message. */
export function converse(mode, request) {
  switch (mode) {
    case 'greet':
      return {
        text:
          'Hey. I build things into your workspace — tell me what you need and ' +
          'you will see me think it through, plan it, then type it into the editor.',
        hint: 'Try: "create a React pricing card component"',
      };

    case 'thanks':
      return { text: 'Any time. Point me at the next thing whenever you are ready.' };

    case 'about':
      return {
        text:
          'I am the Nova agent. I scaffold real, runnable files into the folder you have open, ' +
          'and I show my work while doing it: reasoning, then a plan, then the code typed out live. ' +
          `Right now I can produce ${CAPABILITIES.join('; ')}.`,
        hint: 'Describe what you want built and I will start.',
      };

    default:
      return {
        text:
          'I am built for making things rather than answering questions — ' +
          'describe something you want created and I will scaffold it for you.',
        hint: 'For example: "build an Express REST server"',
      };
  }
}

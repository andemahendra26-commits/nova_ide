'use strict';

/**
 * Nova IDE - MCP tool surface.
 *
 * Every tool is declared once here: the JSON Schema an MCP client reads from
 * `tools/list` and the implementation `tools/call` runs sit side by side, so
 * the two cannot drift apart.
 *
 * Two kinds of failure are distinguished on purpose:
 *   - a caller mistake (bad argument, path outside the workspace) throws with
 *     `rpcCode` set, and the transport turns it into a JSON-RPC error object;
 *   - an operational failure (missing file, dead renderer) comes back as a
 *     normal tool result with `isError: true`, because the model calling the
 *     tool should see the message and recover rather than have the RPC fail.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MAX_READ = 2 * 1024 * 1024; // the brief's hard refusal point for read_file
const MAX_WRITE = 2 * 1024 * 1024;
const MAX_TEXT = 256 * 1024; // ceiling on any single text block we hand back
const MAX_ENTRIES = 1000;
const MAX_MATCHES = 200;
const MAX_MATCH_FILES = 100;
const MAX_SEARCH_FILE = 2 * 1024 * 1024;
const MAX_PROMPT = 8000;

// Mirrors src/main/ipc/search.js so MCP search and the IDE's own search agree.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'release', '.next',
  '__pycache__', '.venv', 'venv', '.cache', 'coverage', '.idea', '.vscode',
]);

/* ----------------------------------------------------------------- helpers */

/** An argument-level failure: the transport maps `rpcCode` onto a JSON-RPC error. */
function invalid(message) {
  return Object.assign(new Error(message), { rpcCode: -32602 });
}

function internal(message) {
  return Object.assign(new Error(message), { rpcCode: -32603 });
}

function text(value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const clipped =
    body.length > MAX_TEXT
      ? `${body.slice(0, MAX_TEXT)}\n\n[truncated: ${body.length} characters, limit ${MAX_TEXT}]`
      : body;
  return { content: [{ type: 'text', text: clipped }] };
}

function failure(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function requireString(args, key, { optional = false, fallback = null } = {}) {
  const value = args[key];
  if (value === undefined || value === null) {
    if (optional) return fallback;
    throw invalid(`"${key}" is required`);
  }
  if (typeof value !== 'string') throw invalid(`"${key}" must be a string`);
  return value;
}

function requireWorkspace(ctx) {
  if (!ctx.workspaceRoot) {
    throw invalid('No workspace is open in Nova IDE - open a folder first');
  }
  return path.resolve(ctx.workspaceRoot);
}

/**
 * Resolve symlinks on the deepest ancestor that actually exists, so a link
 * sitting inside the workspace cannot aim the rest of the path outside it.
 */
function realpathDeepest(target) {
  let current = path.resolve(target);
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail) : real;
    } catch (err) {
      if (err.code !== 'ENOENT') return path.resolve(target);
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** True when `target` is the root itself or lives underneath it. */
function contains(root, target) {
  const rel = path.relative(root, target);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // different drive on Windows
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/**
 * The single gate every filesystem tool passes through. Relative input is
 * anchored at the workspace root; absolute input must already be inside it.
 */
function resolveInWorkspace(ctx, input, field) {
  const root = realpathDeepest(requireWorkspace(ctx));
  if (typeof input !== 'string' || !input.trim()) {
    throw invalid(`"${field}" must be a non-empty string`);
  }
  if (input.includes('\0')) throw invalid(`"${field}" contains a NUL byte`);

  const resolved = realpathDeepest(path.resolve(root, input));
  if (!contains(root, resolved)) {
    throw invalid(`"${field}" resolves outside the workspace root and was rejected: ${input}`);
  }
  return { root, target: resolved, rel: path.relative(root, resolved) || '.' };
}

/** Ask the renderer to do something only it can do. Never hangs: the bridge times out. */
async function viaRenderer(ctx, channel, payload) {
  if (typeof ctx.bridge !== 'function') {
    throw internal('No renderer is connected to the MCP bridge');
  }
  return ctx.bridge(channel, payload);
}

function describeFsError(err, target) {
  switch (err.code) {
    case 'ENOENT':
      return `No such file or directory (${target})`;
    case 'EACCES':
    case 'EPERM':
      return `Permission denied (${target})`;
    case 'EISDIR':
      return `That path is a directory (${target})`;
    case 'ENOTDIR':
      return `That path is not a directory (${target})`;
    default:
      return err.message || String(err);
  }
}

/* ------------------------------------------------------------- definitions */

const definitions = [
  {
    name: 'list_files',
    description:
      'List the entries of a directory inside the open Nova IDE workspace. ' +
      'Directories come first, then files, both sorted by name.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description:
            'Directory to list, relative to the workspace root (or an absolute path inside it). Defaults to the workspace root.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description:
      'Read a UTF-8 text file from the open workspace. Refuses files larger than 2 MB and binary files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path, relative to the workspace root or absolute inside it.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description:
      'Write a UTF-8 text file in the open workspace, creating parent directories as needed. Overwrites an existing file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path, relative to the workspace root or absolute inside it.',
        },
        content: {
          type: 'string',
          description: 'Full new contents of the file.',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_code',
    description:
      'Search the workspace text files for a string or regular expression. ' +
      'Skips node_modules, .git, build output, binaries and files over 2 MB. Case-insensitive.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Literal text to find, or a JavaScript regular expression when regex is true.',
          minLength: 1,
        },
        regex: {
          type: 'boolean',
          description: 'Treat query as a regular expression instead of literal text.',
          default: false,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_file',
    description:
      'Open a workspace file in the Nova IDE editor and focus it, optionally jumping to a line.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path, relative to the workspace root or absolute inside it.',
        },
        line: {
          type: 'integer',
          description: 'One-based line number to reveal and place the cursor on.',
          minimum: 1,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_workspace',
    description: 'Return the folder currently open in Nova IDE, if any.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'run_agent',
    description:
      'Start the Nova agent in the IDE with the given prompt. Returns once the run has been accepted, not once it has finished.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The instruction to hand the Nova agent.',
          minLength: 1,
          maxLength: MAX_PROMPT,
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_editors',
    description: 'List the editor tabs currently open in Nova IDE, including which one is active and which are unsaved.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

/* --------------------------------------------------------- implementations */

const handlers = {
  async list_files(args, ctx) {
    const input = requireString(args, 'dir', { optional: true, fallback: '.' });
    const { root, target, rel } = resolveInWorkspace(ctx, input || '.', 'dir');

    let dirents;
    try {
      dirents = await fsp.readdir(target, { withFileTypes: true });
    } catch (err) {
      return failure(describeFsError(err, rel));
    }

    const entries = [];
    for (const d of dirents.slice(0, MAX_ENTRIES)) {
      const full = path.join(target, d.name);
      let size = 0;
      try {
        // A broken symlink or a file that vanished mid-listing still gets listed.
        size = d.isDirectory() ? 0 : (await fsp.stat(full)).size;
      } catch {
        size = 0;
      }
      entries.push({
        name: d.name,
        rel: path.relative(root, full),
        isDirectory: d.isDirectory(),
        size,
      });
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return text({
      dir: rel,
      count: entries.length,
      truncated: dirents.length > MAX_ENTRIES,
      entries,
    });
  },

  async read_file(args, ctx) {
    const input = requireString(args, 'path');
    const { target, rel } = resolveInWorkspace(ctx, input, 'path');

    let st;
    try {
      st = await fsp.stat(target);
    } catch (err) {
      return failure(describeFsError(err, rel));
    }
    if (st.isDirectory()) return failure(`That path is a directory (${rel})`);
    if (st.size > MAX_READ) {
      return failure(`File is ${st.size} bytes, over the ${MAX_READ} byte read limit (${rel})`);
    }

    let buf;
    try {
      buf = await fsp.readFile(target);
    } catch (err) {
      return failure(describeFsError(err, rel));
    }
    // Binary sniff: a NUL in the first 8 KB means this is not text.
    if (buf.subarray(0, 8192).includes(0)) return failure(`File appears to be binary (${rel})`);

    return text(buf.toString('utf8'));
  },

  async write_file(args, ctx) {
    const input = requireString(args, 'path');
    const content = requireString(args, 'content');
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE) {
      throw invalid(`"content" exceeds the ${MAX_WRITE} byte write limit`);
    }
    const { target, rel } = resolveInWorkspace(ctx, input, 'path');

    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
      const st = await fsp.stat(target);
      return text({ path: rel, bytes: st.size, mtime: st.mtimeMs });
    } catch (err) {
      return failure(describeFsError(err, rel));
    }
  },

  async search_code(args, ctx) {
    const query = requireString(args, 'query');
    if (!query) throw invalid('"query" must not be empty');
    const useRegex = args.regex === undefined ? false : args.regex;
    if (typeof useRegex !== 'boolean') throw invalid('"regex" must be a boolean');

    const root = realpathDeepest(requireWorkspace(ctx));

    let matcher;
    try {
      const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      matcher = new RegExp(source, 'gi');
    } catch (err) {
      throw invalid(`Invalid pattern: ${err.message}`);
    }

    const results = [];
    let matches = 0;
    let truncated = false;

    const walk = async (dir) => {
      if (truncated) return;
      let dirents;
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return; // an unreadable directory is not worth failing the whole search
      }
      for (const d of dirents) {
        if (truncated) return;
        if (IGNORE_DIRS.has(d.name)) continue;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) {
          await walk(full);
          continue;
        }

        let st;
        try {
          st = await fsp.stat(full);
        } catch {
          continue;
        }
        if (!st.size || st.size > MAX_SEARCH_FILE) continue;

        let buf;
        try {
          buf = await fsp.readFile(full);
        } catch {
          continue;
        }
        if (buf.subarray(0, 8192).includes(0)) continue; // binary

        const body = buf.toString('utf8');
        matcher.lastIndex = 0;
        if (!matcher.test(body)) continue;

        const lines = body.split(/\r?\n/);
        const hits = [];
        for (let i = 0; i < lines.length && matches + hits.length < MAX_MATCHES; i++) {
          const line = lines[i];
          if (line.length > 500) continue;
          matcher.lastIndex = 0;
          let m;
          while ((m = matcher.exec(line)) !== null) {
            hits.push({ line: i + 1, column: m.index + 1, preview: line.trim().slice(0, 200) });
            if (m.index === matcher.lastIndex) matcher.lastIndex++; // zero-width match guard
            if (hits.length >= 50) break;
          }
        }
        if (!hits.length) continue;

        matches += hits.length;
        results.push({ file: path.relative(root, full), hits });
        if (results.length >= MAX_MATCH_FILES || matches >= MAX_MATCHES) {
          truncated = true;
          return;
        }
      }
    };

    await walk(root);

    return text({
      query,
      regex: useRegex,
      files: results.length,
      matches,
      truncated,
      results,
    });
  },

  async open_file(args, ctx) {
    const input = requireString(args, 'path');
    const { target, rel } = resolveInWorkspace(ctx, input, 'path');

    let line;
    if (args.line !== undefined && args.line !== null) {
      if (!Number.isInteger(args.line) || args.line < 1) {
        throw invalid('"line" must be an integer of 1 or more');
      }
      line = args.line;
    }

    try {
      await fsp.access(target);
    } catch (err) {
      return failure(describeFsError(err, rel));
    }

    try {
      const data = await viaRenderer(ctx, 'open-file', { path: target, rel, line });
      return text(data === undefined ? { opened: rel, line: line || 1 } : data);
    } catch (err) {
      return failure(`Could not open ${rel} in the editor: ${err.message}`);
    }
  },

  async get_workspace(_args, ctx) {
    if (!ctx.workspaceRoot) return text({ open: false, root: null, name: null });
    const root = path.resolve(ctx.workspaceRoot);
    return text({ open: true, root, name: path.basename(root) });
  },

  async run_agent(args, ctx) {
    const prompt = requireString(args, 'prompt');
    if (!prompt.trim()) throw invalid('"prompt" must not be empty');
    if (prompt.length > MAX_PROMPT) throw invalid(`"prompt" exceeds ${MAX_PROMPT} characters`);

    try {
      const data = await viaRenderer(ctx, 'run-agent', { prompt });
      return text(data === undefined ? { started: true } : data);
    } catch (err) {
      return failure(`Could not start the Nova agent: ${err.message}`);
    }
  },

  async list_editors(_args, ctx) {
    try {
      const data = await viaRenderer(ctx, 'list-editors', {});
      return text(data === undefined ? { editors: [] } : data);
    } catch (err) {
      return failure(`Could not read the open editors: ${err.message}`);
    }
  },
};

/**
 * Run one tool. An unknown name is a caller mistake (-32602); anything the
 * handler throws without an `rpcCode` is reported as a tool-level error so the
 * client sees the message instead of a dead RPC.
 */
async function call(name, args, ctx) {
  const handler = handlers[name];
  if (!handler) throw invalid(`Unknown tool: ${name}`);
  try {
    return await handler(args || {}, ctx || {});
  } catch (err) {
    if (typeof err.rpcCode === 'number') throw err;
    return failure(err.message || String(err));
  }
}

module.exports = { definitions, call, resolveInWorkspace, MAX_READ, MAX_WRITE };

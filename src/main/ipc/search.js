const fsp = require('fs/promises');
const path = require('path');
const { ipcMain } = require('electron');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'release', '.next',
  '__pycache__', '.venv', 'venv', '.cache', 'coverage', '.idea', '.vscode',
]);
const MAX_FILE = 2 * 1024 * 1024;

const cancelled = new Set();

function buildMatcher({ query, regex, caseSensitive, wholeWord }) {
  let source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (wholeWord) source = `\\b${source}\\b`;
  return new RegExp(source, caseSensitive ? 'g' : 'gi');
}

async function* walk(dir) {
  let dirents;
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of dirents) {
    if (IGNORE_DIRS.has(d.name)) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function register() {
  ipcMain.handle('search:run', async (event, opts) => {
    const { token, root, query, maxResults = 2000 } = opts;
    cancelled.delete(token);
    if (!query) return { ok: true, data: { files: 0, matches: 0 } };

    let matcher;
    try {
      matcher = buildMatcher(opts);
    } catch (e) {
      return { ok: false, error: `Invalid pattern: ${e.message}` };
    }

    const send = (channel, payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    };

    let fileCount = 0;
    let matchCount = 0;

    for await (const file of walk(root)) {
      if (cancelled.has(token)) break;
      if (matchCount >= maxResults) break;

      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE || st.size === 0) continue;

      let buf;
      try {
        buf = await fsp.readFile(file);
      } catch {
        continue;
      }
      if (buf.subarray(0, 8192).includes(0)) continue; // binary

      const text = buf.toString('utf8');
      matcher.lastIndex = 0;
      if (!matcher.test(text)) continue;

      const lines = text.split(/\r?\n/);
      const hits = [];
      for (let i = 0; i < lines.length && matchCount + hits.length < maxResults; i++) {
        const line = lines[i];
        if (line.length > 500) continue;
        matcher.lastIndex = 0;
        let m;
        while ((m = matcher.exec(line)) !== null) {
          hits.push({
            line: i + 1,
            column: m.index + 1,
            length: m[0].length,
            preview: line.length > 200 ? line.slice(0, 200) : line,
          });
          if (m.index === matcher.lastIndex) matcher.lastIndex++;
          if (hits.length > 50) break;
        }
      }
      if (!hits.length) continue;

      fileCount++;
      matchCount += hits.length;
      send('search:result', {
        token,
        file: { path: file, rel: path.relative(root, file), name: path.basename(file) },
        hits,
      });
    }

    send('search:done', { token, files: fileCount, matches: matchCount, cancelled: cancelled.has(token) });
    cancelled.delete(token);
    return { ok: true, data: { files: fileCount, matches: matchCount } };
  });

  ipcMain.on('search:cancel', (_e, { token }) => cancelled.add(token));
}

module.exports = { register };

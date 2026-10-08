const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { ipcMain, shell } = require('electron');

const MAX_READ = 12 * 1024 * 1024;

/** Wrap a handler so Node errors become structured results instead of renderer rejections. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, args) => {
    try {
      return { ok: true, data: await fn(args || {}) };
    } catch (err) {
      return { ok: false, error: describe(err) };
    }
  });
}

function describe(err) {
  const p = err.path ? ` (${err.path})` : '';
  switch (err.code) {
    case 'ENOENT':
      return `No such file or directory${p}`;
    case 'EACCES':
    case 'EPERM':
      return `Permission denied${p}`;
    case 'EEXIST':
      return `Already exists${p}`;
    case 'ENOTEMPTY':
      return `Directory is not empty${p}`;
    case 'EISDIR':
      return `That path is a directory${p}`;
    case 'ENAMETOOLONG':
      return `Path is too long${p}`;
    default:
      return err.message || String(err);
  }
}

function register() {
  handle('fs:readDir', async ({ dirPath }) => {
    const dirents = await fsp.readdir(dirPath, { withFileTypes: true });
    const entries = [];
    for (const d of dirents) {
      const full = path.join(dirPath, d.name);
      let size = 0;
      let mtime = 0;
      try {
        const st = await fsp.stat(full);
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        // Broken symlink or a file that vanished between readdir and stat: still list it.
      }
      entries.push({
        name: d.name,
        path: full,
        isDirectory: d.isDirectory(),
        size,
        mtime,
      });
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return { entries };
  });

  handle('fs:readFile', async ({ filePath }) => {
    const st = await fsp.stat(filePath);
    if (st.size > MAX_READ) {
      return { tooLarge: true, size: st.size, content: '' };
    }
    const buf = await fsp.readFile(filePath);
    // Binary sniff: a NUL in the first 8 KB means this is not text.
    const probe = buf.subarray(0, 8192);
    if (probe.includes(0)) return { binary: true, size: st.size, content: '' };
    return { content: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs };
  });

  handle('fs:writeFile', async ({ filePath, content }) => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, 'utf8');
    const st = await fsp.stat(filePath);
    return { path: filePath, bytes: st.size, mtime: st.mtimeMs };
  });

  handle('fs:createFile', async ({ filePath }) => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const fd = await fsp.open(filePath, 'wx');
    await fd.close();
    return { path: filePath };
  });

  handle('fs:createDir', async ({ dirPath }) => {
    await fsp.mkdir(dirPath, { recursive: false });
    return { path: dirPath };
  });

  handle('fs:rename', async ({ from, to }) => {
    if (fs.existsSync(to)) throw Object.assign(new Error('Target exists'), { code: 'EEXIST', path: to });
    await fsp.rename(from, to);
    return { path: to };
  });

  handle('fs:delete', async ({ targetPath }) => {
    // Recycle bin where the platform allows it, so a misclick is recoverable.
    try {
      await shell.trashItem(targetPath);
    } catch {
      await fsp.rm(targetPath, { recursive: true, force: true });
    }
    return { path: targetPath };
  });

  handle('fs:stat', async ({ targetPath }) => {
    try {
      const st = await fsp.stat(targetPath);
      return {
        exists: true,
        isDirectory: st.isDirectory(),
        size: st.size,
        mtime: st.mtimeMs,
      };
    } catch {
      return { exists: false };
    }
  });

  /** Flat file index for quick-open. Bounded so a huge tree cannot hang the UI. */
  handle('fs:indexFiles', async ({ root, limit = 20000 }) => {
    const IGNORE = new Set([
      'node_modules', '.git', 'dist', 'out', 'build', 'release',
      '.next', '__pycache__', '.venv', 'venv', '.cache', 'coverage', 'vendor',
    ]);
    const files = [];
    const queue = [root];
    while (queue.length && files.length < limit) {
      const dir = queue.shift();
      let dirents;
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const d of dirents) {
        if (d.name.startsWith('.') && d.name !== '.env') continue;
        if (IGNORE.has(d.name)) continue;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) queue.push(full);
        else {
          files.push({ path: full, name: d.name, rel: path.relative(root, full) });
          if (files.length >= limit) break;
        }
      }
    }
    return { files, truncated: files.length >= limit };
  });

  handle('fs:revealInExplorer', async ({ targetPath }) => {
    shell.showItemInFolder(targetPath);
    return { path: targetPath };
  });
}

module.exports = { register, describe };

/**
 * Shell bridge.
 *
 * Deliberately pipe-based (TRD §1): a true PTY means a native module, which
 * means every target machine needs a C++ toolchain or a matching prebuild.
 *
 * The first implementation kept ONE long-lived `powershell -Command -` process
 * and fed it lines. That does not work: in `-Command -` mode PowerShell reads
 * stdin to EOF before executing anything, so an interactive session produces no
 * output at all. Verified empirically — the terminal was simply dead.
 *
 * So each command gets its own process instead. Output streams as it is
 * produced (npm install scrolls live), exit codes are real, and Ctrl+C can kill
 * exactly one command. The cost is that shell state does not persist between
 * commands, so we track the working directory ourselves by appending a marker
 * that prints $PWD and strip it from the visible output.
 */
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { ipcMain } = require('electron');

const MARK = '__NOVA_CWD__';
const sessions = new Map();
let nextId = 1;

const isWin = process.platform === 'win32';

/** Wrap the user's command so the resulting working directory comes back with it. */
function wrap(command) {
  if (isWin) {
    return ['-NoLogo', '-NoProfile', '-Command', `${command}\n Write-Host "${MARK}$($PWD.Path)"`];
  }
  return ['-c', `${command}\n echo "${MARK}$PWD"`];
}

function shellBin() {
  return isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
}

function register() {
  ipcMain.handle('shell:create', async (event, { cwd } = {}) => {
    try {
      const id = String(nextId++);
      sessions.set(id, {
        id,
        cwd: cwd && path.isAbsolute(cwd) ? cwd : os.homedir(),
        child: null,
        sender: event.sender,
      });
      const s = sessions.get(id);
      // Prime the prompt so the terminal is usable immediately.
      setImmediate(() => {
        if (!event.sender.isDestroyed()) event.sender.send('shell:prompt', { id, cwd: s.cwd });
      });
      return { ok: true, data: { id, cwd: s.cwd, pty: false } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.on('shell:exec', (event, { id, command }) => {
    const s = sessions.get(id);
    if (!s) return;

    const send = (channel, payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
    };

    if (s.child) {
      send('shell:data', { id, data: '\r\n\x1b[33mA command is already running.\x1b[0m\r\n' });
      return;
    }

    let child;
    try {
      child = spawn(shellBin(), wrap(command), {
        cwd: s.cwd,
        env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
        windowsHide: true,
      });
    } catch (err) {
      send('shell:data', { id, data: `\r\n\x1b[31m${err.message}\x1b[0m\r\n` });
      send('shell:prompt', { id, cwd: s.cwd });
      return;
    }

    s.child = child;
    let tail = '';

    /**
     * Strip the trailing cwd marker out of the stream. It can straddle a chunk
     * boundary, so hold back anything that might be the start of it.
     */
    const onChunk = (buf) => {
      let text = tail + buf.toString('utf8');
      tail = '';

      const idx = text.indexOf(MARK);
      if (idx !== -1) {
        const eol = text.indexOf('\n', idx);
        if (eol === -1) {
          tail = text.slice(idx);
          text = text.slice(0, idx);
        } else {
          const cwd = text.slice(idx + MARK.length, eol).trim();
          if (cwd) s.cwd = cwd;
          text = text.slice(0, idx) + text.slice(eol + 1);
        }
      } else {
        // Keep back a possible partial marker.
        const cut = Math.max(0, text.length - MARK.length);
        if (text.slice(cut).includes(MARK[0])) {
          tail = text.slice(cut);
          text = text.slice(0, cut);
        }
      }

      // xterm needs CRLF; a bare LF leaves the cursor in the wrong column.
      if (text) send('shell:data', { id, data: text.replace(/(?<!\r)\n/g, '\r\n') });
    };

    child.stdout.on('data', onChunk);
    child.stderr.on('data', (b) =>
      send('shell:data', { id, data: b.toString('utf8').replace(/(?<!\r)\n/g, '\r\n') })
    );

    child.on('error', (err) => {
      send('shell:data', { id, data: `\r\n\x1b[31m${err.message}\x1b[0m\r\n` });
    });

    child.on('close', (code) => {
      s.child = null;
      if (tail && !tail.includes(MARK)) send('shell:data', { id, data: tail });
      tail = '';
      if (code !== 0 && code !== null) {
        send('shell:data', { id, data: `\x1b[90mexit ${code}\x1b[0m\r\n` });
      }
      send('shell:prompt', { id, cwd: s.cwd });
    });
  });

  /** Raw stdin passthrough for a command that is currently reading input. */
  ipcMain.on('shell:write', (_e, { id, data }) => {
    const s = sessions.get(id);
    if (!s?.child) return;
    try {
      s.child.stdin.write(data);
    } catch {
      /* the child closed stdin underneath us */
    }
  });

  ipcMain.on('shell:kill', (_e, { id }) => {
    const s = sessions.get(id);
    if (!s) return;
    killChild(s);
    sessions.delete(id);
  });

  /** Ctrl+C: kill the running command but keep the session and its cwd. */
  ipcMain.handle('shell:interrupt', async (_e, { id }) => {
    const s = sessions.get(id);
    if (!s) return { ok: false, error: 'No such terminal' };
    killChild(s);
    return { ok: true, data: { id: s.id, cwd: s.cwd, pty: false } };
  });
}

function killChild(s) {
  if (!s.child) return;
  try {
    // A shell spawns children of its own; on Windows only taskkill reliably
    // takes the whole tree down.
    if (isWin) {
      spawn('taskkill', ['/pid', String(s.child.pid), '/t', '/f'], { windowsHide: true });
    } else {
      s.child.kill('SIGINT');
    }
  } catch {
    /* best effort */
  }
  s.child = null;
}

function killAll() {
  for (const s of sessions.values()) killChild(s);
  sessions.clear();
}

module.exports = { register, killAll };

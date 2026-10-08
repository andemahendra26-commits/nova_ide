const chokidar = require('chokidar');

let current = null;
let pending = new Map();
let timer = null;

function flush(sender) {
  timer = null;
  if (!pending.size) return;
  const changes = [...pending.values()];
  pending = new Map();
  if (!sender.isDestroyed()) sender.send('watch:change', { changes });
}

function start(root, sender) {
  stop();
  current = chokidar.watch(root, {
    ignored: /(^|[\\/])(\.git|node_modules|dist|out|build|release|__pycache__|\.venv)([\\/]|$)/,
    ignoreInitial: true,
    depth: 8,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });

  const queue = (type) => (path) => {
    // Coalesce per path: the last event for a path within the window wins.
    pending.set(path, { type, path });
    if (!timer) timer = setTimeout(() => flush(sender), 120);
  };

  current
    .on('add', queue('add'))
    .on('change', queue('change'))
    .on('unlink', queue('unlink'))
    .on('addDir', queue('addDir'))
    .on('unlinkDir', queue('unlinkDir'))
    .on('error', () => {
      /* permission errors on subtrees are expected; keep watching the rest */
    });
}

function stop() {
  clearTimeout(timer);
  timer = null;
  pending = new Map();
  if (current) {
    current.close().catch(() => {});
    current = null;
  }
}

module.exports = { start, stop };

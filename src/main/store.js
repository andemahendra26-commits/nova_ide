const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'nova-settings.json');

const DEFAULTS = {
  theme: 'claude-dark',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  lineNumbers: true,
  animationSpeed: 1,
  reducedMotion: false,
  agentTypingSpeed: 70,
  agentProvider: 'engine',
  apiKey: '',
  recentFolders: [],
  window: { width: 1440, height: 900, x: null, y: null, maximized: false },
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE(), 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

let writeTimer = null;
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE()), { recursive: true });
      fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2), 'utf8');
    } catch (e) {
      console.error('settings write failed:', e.message);
    }
  }, 150);
}

module.exports = {
  all: () => ({ ...load() }),
  get(key) {
    return load()[key];
  },
  set(key, value) {
    load()[key] = value;
    persist();
    return value;
  },
  merge(patch) {
    Object.assign(load(), patch);
    persist();
    return { ...cache };
  },
  pushRecent(folder) {
    const s = load();
    s.recentFolders = [folder, ...s.recentFolders.filter((f) => f !== folder)].slice(0, 10);
    persist();
    return s.recentFolders;
  },
  flush() {
    clearTimeout(writeTimer);
    if (!cache) return;
    try {
      fs.mkdirSync(path.dirname(FILE()), { recursive: true });
      fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2), 'utf8');
    } catch {
      /* best effort on quit */
    }
  },
  DEFAULTS,
};

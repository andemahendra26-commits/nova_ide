const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * The entire surface the renderer is allowed to reach. Every filesystem and
 * shell capability the page has is enumerated here — there is no dynamic
 * channel construction, so the allow-list is the code.
 */

/** Unwrap { ok, data | error } into a value or a thrown Error with a real message. */
async function call(channel, args) {
  const res = await ipcRenderer.invoke(channel, args);
  if (!res) throw new Error(`No response from ${channel}`);
  if (!res.ok) throw new Error(res.error || 'Unknown error');
  return res.data;
}

/** Subscribe to a main->renderer event; returns an unsubscribe function. */
function listen(channel, handler) {
  const wrapped = (_e, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

const api = {
  fs: {
    readDir: (dirPath) => call('fs:readDir', { dirPath }),
    readFile: (filePath) => call('fs:readFile', { filePath }),
    writeFile: (filePath, content) => call('fs:writeFile', { filePath, content }),
    createFile: (filePath) => call('fs:createFile', { filePath }),
    createDir: (dirPath) => call('fs:createDir', { dirPath }),
    rename: (from, to) => call('fs:rename', { from, to }),
    delete: (targetPath) => call('fs:delete', { targetPath }),
    stat: (targetPath) => call('fs:stat', { targetPath }),
    indexFiles: (root, limit) => call('fs:indexFiles', { root, limit }),
    reveal: (targetPath) => call('fs:revealInExplorer', { targetPath }),
  },

  dialog: {
    openFolder: () => call('dialog:openFolder'),
    openFile: () => call('dialog:openFile'),
    saveAs: (defaultPath) => call('dialog:saveAs', { defaultPath }),
    confirm: (opts) => call('dialog:confirm', opts),
  },

  search: {
    run: (opts) => call('search:run', opts),
    cancel: (token) => ipcRenderer.send('search:cancel', { token }),
    onResult: (h) => listen('search:result', h),
    onDone: (h) => listen('search:done', h),
  },

  test: {
    runCase: (payload) => call('test:runCase', payload),
    runSuite: (payload) => call('test:runSuite', payload),
    cancel: (runId) => call('test:cancel', { runId }),
    onStep: (h) => listen('test:step', h),
    onDone: (h) => listen('test:done', h),
  },

  shell: {
    create: (opts) => call('shell:create', opts),
    exec: (id, command) => ipcRenderer.send('shell:exec', { id, command }),
    write: (id, data) => ipcRenderer.send('shell:write', { id, data }),
    kill: (id) => ipcRenderer.send('shell:kill', { id }),
    interrupt: (id) => call('shell:interrupt', { id }),
    onData: (h) => listen('shell:data', h),
    onPrompt: (h) => listen('shell:prompt', h),
    onExit: (h) => listen('shell:exit', h),
  },

  store: {
    all: () => call('store:all'),
    merge: (patch) => call('store:merge', patch),
    pushRecent: (folder) => call('store:pushRecent', { folder }),
  },

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => call('window:isMaximized'),
    onState: (h) => listen('window:state', h),
  },

  watch: {
    start: (root) => call('watch:start', { root }),
    stop: () => ipcRenderer.send('watch:stop'),
    onChange: (h) => listen('watch:change', h),
  },

  agent: {
    claude: (opts) => call('agent:claude', opts),
    onDelta: (h) => listen('agent:delta', h),
  },


  mcp: {
    start: (opts) => call('mcp:start', opts),
    stop: () => call('mcp:stop'),
    status: () => call('mcp:status'),
    onRequest: (h) => listen('mcp:request', h),
    respond: (id, ok, data) => ipcRenderer.send('mcp:response', { id, ok, data }),
  },

  app: {
    info: () => call('app:info'),
    openExternal: (url) => ipcRenderer.send('app:openExternal', { url }),
  },

  /** Electron >= 32 removed File.path; this is the supported replacement. */
  pathFor: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('nova', Object.freeze(api));

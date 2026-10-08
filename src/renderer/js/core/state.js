import { bus } from './bus.js';

/**
 * One observable store. Mutation goes through setState, which shallow-merges
 * top-level keys and emits the set of keys that changed. Subscribers filter by
 * key. No proxies, no reactivity magic — the whole contract is visible here.
 */
const state = {
  workspace: null,          // { root, name }
  files: {
    open: new Map(),        // path -> FileModel
    order: [],              // tab order, array of paths
    active: null,
  },
  ui: {
    sidebarView: 'explorer',
    sidebarOpen: true,
    sidebarWidth: 260,
    agentOpen: true,
    agentWidth: 360,
    panelOpen: false,
    panelHeight: 240,
    zen: false,
  },
  agent: {
    status: 'idle',         // idle | running | done | stopped | error
    phase: null,
    runId: null,
    tokens: 0,
  },
  settings: {},
  fileIndex: [],            // flat list for quick open
};

export function getState() {
  return state;
}

export function setState(patch) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Map)) {
      state[key] = { ...state[key], ...value };
    } else {
      state[key] = value;
    }
    changed.push(key);
  }
  bus.emit('state:change', { changed, state });
  for (const key of changed) bus.emit(`state:${key}`, state[key]);
  return state;
}

/** Subscribe to one top-level key; fires immediately with the current value. */
export function subscribe(key, handler) {
  handler(state[key]);
  return bus.on(`state:${key}`, handler);
}

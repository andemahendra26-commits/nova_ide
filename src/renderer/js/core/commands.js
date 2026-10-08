import { bus } from './bus.js';

/**
 * One registry behind four surfaces: the command palette, the menu bar, the
 * keymap, and context menus. A command is defined once and appears everywhere.
 */
const registry = new Map();

export function register(cmd) {
  if (!cmd?.id || typeof cmd.run !== 'function') {
    throw new Error(`Invalid command: ${JSON.stringify(cmd?.id)}`);
  }
  registry.set(cmd.id, {
    category: 'Nova',
    keybinding: null,
    when: () => true,
    paletteHidden: false,
    ...cmd,
  });
  return cmd.id;
}

export function registerAll(cmds) {
  cmds.forEach(register);
}

export function get(id) {
  return registry.get(id);
}

export function all() {
  return [...registry.values()];
}

/** Commands eligible for the palette right now. */
export function available() {
  return all().filter((c) => !c.paletteHidden && safeWhen(c));
}

function safeWhen(cmd) {
  try {
    return cmd.when();
  } catch {
    return false;
  }
}

export async function run(id, arg) {
  const cmd = registry.get(id);
  if (!cmd) {
    console.warn(`No such command: ${id}`);
    return;
  }
  if (!safeWhen(cmd)) return;
  try {
    bus.emit('command:before', { id });
    await cmd.run(arg);
    bus.emit('command:after', { id });
  } catch (err) {
    console.error(`Command "${id}" failed:`, err);
    bus.emit('notify', { type: 'error', title: cmd.title || id, message: err.message });
  }
}

/** Reverse lookup so menus and the palette can print the right shortcut. */
export function keyFor(id) {
  return registry.get(id)?.keybinding || null;
}

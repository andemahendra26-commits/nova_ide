/**
 * The only channel between UI modules. No UI module imports another UI module,
 * which is what keeps the dependency graph acyclic without a framework.
 */
const map = new Map();

export const bus = {
  on(event, handler) {
    if (!map.has(event)) map.set(event, new Set());
    map.get(event).add(handler);
    return () => bus.off(event, handler);
  },

  once(event, handler) {
    const wrapped = (payload) => {
      bus.off(event, wrapped);
      handler(payload);
    };
    return bus.on(event, wrapped);
  },

  off(event, handler) {
    map.get(event)?.delete(handler);
  },

  emit(event, payload) {
    const set = map.get(event);
    if (!set) return;
    // Copy first: a handler may unsubscribe itself while we iterate.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`bus handler failed for "${event}":`, err);
      }
    }
  },
};

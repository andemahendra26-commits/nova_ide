import { bus } from './bus.js';
import { getState, setState } from './state.js';

export const DEFAULTS = {
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
};

export const THEMES = [
  { id: 'claude-dark', name: 'Claude Dark', swatches: ['#0a0a09', '#191714', '#d97757', '#f0a868'] },
  { id: 'nova-dark', name: 'Nova Dark', swatches: ['#0a0c14', '#141826', '#22d3ee', '#a78bfa'] },
  { id: 'midnight', name: 'Midnight', swatches: ['#05070d', '#0d1119', '#818cf8', '#38bdf8'] },
  { id: 'synthwave', name: 'Synthwave', swatches: ['#17112b', '#251c44', '#f472b6', '#22d3ee'] },
  { id: 'nova-light', name: 'Nova Light', swatches: ['#f4f6fb', '#ffffff', '#0891b2', '#7c3aed'] },
];

export async function loadSettings() {
  let stored = {};
  try {
    stored = await window.nova.store.all();
  } catch (err) {
    console.warn('settings load failed, using defaults:', err.message);
  }
  const settings = { ...DEFAULTS, ...stored };
  setState({ settings });
  applyToDocument(settings);
  return settings;
}

export function getSettings() {
  return getState().settings;
}

export async function updateSettings(patch) {
  const settings = { ...getState().settings, ...patch };
  setState({ settings });
  applyToDocument(settings, patch);
  bus.emit('settings:change', { settings, patch });
  try {
    await window.nova.store.merge(patch);
  } catch (err) {
    console.warn('settings persist failed:', err.message);
  }
  return settings;
}

/**
 * Push the settings that the CSS layer owns onto the document element.
 * Theme changes get a brief cross-fade class (TH-2), removed afterwards so it
 * never taxes ordinary interaction.
 */
function applyToDocument(settings, patch = null) {
  const root = document.documentElement;

  if (!patch || 'theme' in patch) {
    if (patch) {
      document.body.classList.add('theme-transition');
      setTimeout(() => document.body.classList.remove('theme-transition'), 420);
    }
    root.dataset.theme = settings.theme;
  }

  if (!patch || 'reducedMotion' in patch || 'animationSpeed' in patch) {
    if (settings.reducedMotion) {
      root.dataset.motion = 'reduced';
    } else {
      delete root.dataset.motion;
      // animationSpeed is a multiplier on duration, so a faster setting is a
      // smaller scale. Guard against 0, which would freeze every animation.
      const scale = Math.max(0.05, 1 / Math.max(0.1, Number(settings.animationSpeed) || 1));
      root.style.setProperty('--motion-scale', String(scale));
    }
  }
}

/** True when decorative animation should be suppressed entirely. */
export function motionOff() {
  return !!getState().settings.reducedMotion;
}

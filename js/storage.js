// localStorage persistence: current game, per-draw-mode stats, settings.

const GAME_KEY = 'sol.game';
const STATS_KEY = 'sol.stats';
const SETTINGS_KEY = 'sol.settings';

export function saveGame(state) {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify(state));
  } catch {}
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.tableau) || s.tableau.length !== 7 || !Array.isArray(s.faceUp)) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearGame() {
  try { localStorage.removeItem(GAME_KEY); } catch {}
}

const DEFAULT_STATS = () => ({ played: 0, won: 0, streak: 0, bestStreak: 0, bestTimeMs: null, fewestMoves: null });

export function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY));
    return { 1: { ...DEFAULT_STATS(), ...(s?.[1] || {}) }, 3: { ...DEFAULT_STATS(), ...(s?.[3] || {}) } };
  } catch {
    return { 1: DEFAULT_STATS(), 3: DEFAULT_STATS() };
  }
}

export function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch {}
}

const DEFAULT_SETTINGS = { drawMode: 1, sound: true, lefty: false, a2hsDismissed: false };

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

// Bootstrap and conductor: owns the state, wires input actions to game
// mutations, renders, persists, and runs the chrome (HUD, dialogs, timer).

import * as game from './game.js';
import * as render from './render.js';
import * as input from './input.js';
import * as audio from './audio.js';
import * as storage from './storage.js';
import * as cascade from './cascade.js';
import { computeLayout } from './layout.js';

const $ = (id) => document.getElementById(id);
const board = $('board');

let settings = storage.loadSettings();
let stats = storage.loadStats();
let state = null;
let layout = null;
let lastTick = performance.now();
let busy = false; // deal / auto-complete / cascade in progress

audio.setSoundOn(settings.sound);

// ---------- Layout ----------
function relayout(instant = true) {
  layout = computeLayout(board.clientWidth, board.clientHeight, { lefty: settings.lefty });
  render.applyLayout(layout);
  if (state) render.sync(state, layout, { instant });
}

// ---------- HUD ----------
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function updateHUD() {
  $('hud-moves').textContent = state.moves.length;
  $('hud-time').textContent = fmtTime(state.elapsedMs);
  $('btn-undo').disabled = state.moves.length === 0 || busy;
}

setInterval(() => {
  const now = performance.now();
  if (state && state.started && !state.won && document.visibilityState === 'visible') {
    state.elapsedMs += now - lastTick;
    $('hud-time').textContent = fmtTime(state.elapsedMs);
  }
  lastTick = now;
}, 250);

// ---------- Game flow ----------
function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

async function startNewGame(seed, drawMode) {
  busy = true;
  input.setEnabled(false);
  hideAll();
  cascade.clear($('cascade'));
  $('cascade').classList.add('hidden');
  $('btn-autocomplete').classList.add('hidden');
  state = game.newGame(seed, drawMode);
  storage.saveGame(state);
  updateHUD();
  audio.drawSound();
  await render.dealAnimation(state, layout);
  render.sync(state, layout, { instant: true });
  busy = false;
  input.setEnabled(true);
  updateHUD();
}

function afterMove(rec) {
  updateHUD();
  storage.saveGame(state);

  if (rec && rec.t === 'move' && !state.countedPlayed) {
    state.countedPlayed = true;
    stats[state.drawMode].played++;
    storage.saveStats(stats);
    storage.saveGame(state);
  }

  if (state.won) {
    onWin();
    return;
  }
  const canAuto = game.canAutoComplete(state);
  $('btn-autocomplete').classList.toggle('hidden', !canAuto);
}

function handleAction(action) {
  if (busy || !state) return;
  if (action.type === 'draw') {
    const rec = game.draw(state);
    if (!rec) return;
    audio.drawSound();
    render.sync(state, layout);
    afterMove(rec);
  } else if (action.type === 'move') {
    const rec = game.move(state, action.src, action.dest, action.n);
    if (!rec) {
      render.sync(state, layout);
      return;
    }
    if (action.dest[0] === 'F') audio.foundation();
    else audio.place();
    if (rec.flipped) setTimeout(() => audio.flip(), 120);
    render.sync(state, layout);
    afterMove(rec);
  } else if (action.type === 'invalid') {
    audio.error();
    render.sync(state, layout);
    render.shake(action.ids);
  } else if (action.type === 'settle') {
    audio.place();
    render.sync(state, layout);
  }
}

function doUndo() {
  if (busy || !state || !state.moves.length) return;
  game.undo(state);
  audio.undoSound();
  render.sync(state, layout);
  updateHUD();
  storage.saveGame(state);
  $('btn-autocomplete').classList.toggle('hidden', !game.canAutoComplete(state));
}

async function autoComplete() {
  if (busy || !game.canAutoComplete(state)) return;
  busy = true;
  input.setEnabled(false);
  $('btn-autocomplete').classList.add('hidden');
  let next;
  while ((next = game.nextAutoMove(state))) {
    game.move(state, next.src, next.dest, 1);
    audio.foundation();
    render.sync(state, layout);
    updateHUD();
    await new Promise((r) => setTimeout(r, 95));
  }
  storage.saveGame(state);
  busy = false;
  input.setEnabled(true);
  if (state.won) onWin();
}

function onWin() {
  busy = true;
  input.setEnabled(false);
  const s = stats[state.drawMode];
  s.won++;
  s.streak++;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  if (s.bestTimeMs === null || state.elapsedMs < s.bestTimeMs) s.bestTimeMs = state.elapsedMs;
  if (s.fewestMoves === null || state.moves.length < s.fewestMoves) s.fewestMoves = state.moves.length;
  storage.saveStats(stats);
  storage.clearGame();
  audio.win();

  const canvas = $('cascade');
  canvas.classList.remove('hidden');
  const boardRect = board.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const offset = { x: boardRect.left - canvasRect.left, y: boardRect.top - canvasRect.top };
  cascade.play(canvas, state, layout, offset, () => {
    showWinDialog();
  });
}

function showWinDialog() {
  const s = stats[state.drawMode];
  const isBestTime = s.bestTimeMs !== null && state.elapsedMs <= s.bestTimeMs;
  $('win-detail').innerHTML =
    `Time <b>${fmtTime(state.elapsedMs)}</b>${isBestTime && s.won > 1 ? ' — new best! 🌟' : ''}<br>` +
    `Moves <b>${state.moves.length}</b><br>` +
    `Win streak <b>${s.streak}</b>`;
  $('dlg-win').classList.remove('hidden');
  busy = false;
}

// A deal abandoned mid-way breaks the streak when a new one is started.
function abandonIfStarted() {
  if (state && state.countedPlayed && !state.won) {
    stats[state.drawMode].streak = 0;
    storage.saveStats(stats);
  }
}

// ---------- Dialogs ----------
const overlays = ['dlg-menu', 'dlg-settings', 'dlg-stats', 'dlg-win'];
function hideAll() {
  overlays.forEach((id) => $(id).classList.add('hidden'));
}
function show(id) {
  hideAll();
  $(id).classList.remove('hidden');
}

$('btn-menu').addEventListener('click', () => show('dlg-menu'));
$('menu-close').addEventListener('click', hideAll);
$('menu-new').addEventListener('click', () => {
  abandonIfStarted();
  startNewGame(randomSeed(), settings.drawMode);
});
$('menu-restart').addEventListener('click', () => {
  abandonIfStarted();
  startNewGame(state.seed, state.drawMode);
});
$('menu-settings').addEventListener('click', () => { syncSettingsUI(); show('dlg-settings'); });
$('menu-stats').addEventListener('click', () => { renderStats(state?.drawMode ?? settings.drawMode); show('dlg-stats'); });
$('settings-close').addEventListener('click', hideAll);
$('stats-close').addEventListener('click', hideAll);
$('win-new').addEventListener('click', () => startNewGame(randomSeed(), settings.drawMode));
$('win-close').addEventListener('click', () => {
  hideAll();
  cascade.clear($('cascade'));
  $('cascade').classList.add('hidden');
});
overlays.forEach((id) => {
  $(id).addEventListener('click', (e) => {
    if (e.target === $(id) && id !== 'dlg-win') hideAll();
  });
});
$('btn-undo').addEventListener('click', doUndo);
$('btn-autocomplete').addEventListener('click', autoComplete);

// ---------- Settings UI ----------
function syncSettingsUI() {
  document.querySelectorAll('#set-draw .seg-btn').forEach((b) => {
    b.classList.toggle('on', +b.dataset.v === settings.drawMode);
  });
  $('set-sound').setAttribute('aria-checked', settings.sound);
  $('set-lefty').setAttribute('aria-checked', settings.lefty);
  $('draw-hint').classList.toggle('hidden', !(state && state.started && state.drawMode !== settings.drawMode));
}

document.querySelectorAll('#set-draw .seg-btn').forEach((b) => {
  b.addEventListener('click', () => {
    settings.drawMode = +b.dataset.v;
    storage.saveSettings(settings);
    // Apply immediately if the current game hasn't been touched yet.
    if (state && !state.started && state.drawMode !== settings.drawMode) {
      state = game.newGame(state.seed, settings.drawMode);
      render.sync(state, layout, { instant: true });
      storage.saveGame(state);
    }
    syncSettingsUI();
  });
});
$('set-sound').addEventListener('click', () => {
  settings.sound = !settings.sound;
  audio.setSoundOn(settings.sound);
  if (settings.sound) audio.place();
  storage.saveSettings(settings);
  syncSettingsUI();
});
$('set-lefty').addEventListener('click', () => {
  settings.lefty = !settings.lefty;
  storage.saveSettings(settings);
  relayout(true);
  syncSettingsUI();
});

// ---------- Stats UI ----------
function renderStats(mode) {
  document.querySelectorAll('#stats-mode .seg-btn').forEach((b) => {
    b.classList.toggle('on', +b.dataset.v === mode);
  });
  const s = stats[mode];
  const rate = s.played ? Math.round((100 * s.won) / s.played) + '%' : '—';
  const cells = [
    [s.played, 'Played'], [s.won, 'Won'], [rate, 'Win rate'],
    [s.streak, 'Streak'], [s.bestStreak, 'Best streak'],
    [s.bestTimeMs !== null ? fmtTime(s.bestTimeMs) : '—', 'Best time'],
  ];
  $('stats-grid').innerHTML = cells
    .map(([v, k]) => `<div class="stat-cell"><div class="v">${v}</div><div class="k">${k}</div></div>`)
    .join('');
}
document.querySelectorAll('#stats-mode .seg-btn').forEach((b) => {
  b.addEventListener('click', () => renderStats(+b.dataset.v));
});

// ---------- Lifecycle ----------
function persist() {
  if (state && !state.won) storage.saveGame(state);
  storage.saveStats(stats);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
  else { lastTick = performance.now(); audio.resume(); }
});
window.addEventListener('pagehide', persist);
window.addEventListener('resize', () => relayout(true));
window.addEventListener('orientationchange', () => setTimeout(() => relayout(true), 60));
document.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// Add-to-Home-Screen hint: iOS Safari, not installed, not dismissed.
(function a2hs() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true ||
    matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !standalone && !settings.a2hsDismissed) {
    $('a2hs').classList.remove('hidden');
    $('a2hs-close').addEventListener('click', () => {
      $('a2hs').classList.add('hidden');
      settings.a2hsDismissed = true;
      storage.saveSettings(settings);
    });
  }
})();

// ---------- Boot ----------
render.init(board);
input.init({
  board,
  getState: () => state,
  getLayout: () => layout,
  onAction: handleAction,
});

relayout();

const saved = storage.loadGame();
if (saved && !saved.won) {
  state = saved;
  render.sync(state, layout, { instant: true });
  updateHUD();
  $('btn-autocomplete').classList.toggle('hidden', !game.canAutoComplete(state));
} else {
  startNewGame(randomSeed(), settings.drawMode);
}

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// Dev/test hooks (harmless in production).
window.__sol = {
  game, render, storage,
  get state() { return state; },
  get layout() { return layout; },
  act: handleAction,
  newGame: (seed, mode) => startNewGame(seed ?? randomSeed(), mode ?? settings.drawMode),
  autoComplete,
  undo: doUndo,
};

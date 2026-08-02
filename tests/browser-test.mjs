// Drive the app in headless Chromium through raw WebDriver (no dependencies).
// Prereqs: `python3 -m http.server 8642` in the repo root, snap chromium installed.
// Screenshots land in tests/out/. See CLAUDE.md for the snap chromedriver quirks.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const PORT = 9515;
const BASE = `http://127.0.0.1:${PORT}`;
const APP = 'http://127.0.0.1:8642/';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
// Snap-confined chromium can only write inside its own snap dir (not /tmp, not dot-dirs).
const PROFILE = `${homedir()}/snap/chromium/common/sol-wd/profile`;

const driver = spawn('chromium.chromedriver', [`--port=${PORT}`], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

let sessionId = null;
async function wd(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (j.value && j.value.error) throw new Error(`${path}: ${j.value.error}: ${j.value.message?.split('\n')[0]}`);
  return j.value;
}
const exec = (script, args = []) =>
  wd('POST', `/session/${sessionId}/execute/sync`, { script, args });
const execAsync = (script, args = []) =>
  wd('POST', `/session/${sessionId}/execute/async`, { script, args });

async function shot(name) {
  const b64 = await wd('GET', `/session/${sessionId}/screenshot`);
  writeFileSync(`${OUT}${name}.png`, Buffer.from(b64, 'base64'));
  console.log('shot:', name);
}

// Synthetic pointer drag through the W3C actions API.
async function pointerDrag(points, holdMs = 30) {
  const actions = [
    { type: 'pointerMove', duration: 0, x: points[0][0], y: points[0][1] },
    { type: 'pointerDown', button: 0 },
    { type: 'pause', duration: holdMs },
  ];
  for (let i = 1; i < points.length; i++) {
    actions.push({ type: 'pointerMove', duration: 60, x: points[i][0], y: points[i][1] });
  }
  actions.push({ type: 'pointerUp', button: 0 });
  await wd('POST', `/session/${sessionId}/actions`, {
    actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions }],
  });
}
const tap = (x, y) => pointerDrag([[x, y]], 40);

let pass = 0, fail = 0;
const check = (cond, msg) => {
  if (cond) { pass++; console.log('ok:', msg); }
  else { fail++; console.error('FAIL:', msg); }
};

try {
  const session = await wd('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          // No `binary:` — snap chromedriver can't execvp /snap/bin/chromium; it
          // finds its own bundled chromium when the path is omitted.
          args: ['--headless=new', '--window-size=390,900', '--no-sandbox',
                 '--disable-gpu', '--force-device-scale-factor=2',
                 `--user-data-dir=${PROFILE}`],
          mobileEmulation: { deviceMetrics: { width: 390, height: 844, pixelRatio: 3, touch: true } },
        },
        'goog:loggingPrefs': { browser: 'ALL' },
      },
    },
  });
  sessionId = session.sessionId;

  await wd('POST', `/session/${sessionId}/url`, { url: APP });
  // Wait for deal animation to finish.
  await execAsync(`const done = arguments[0];
    const t = setInterval(() => {
      if (window.__sol && window.__sol.state && !document.querySelector('#board.no-anim')) { clearInterval(t); done(1); }
    }, 100); setTimeout(() => { clearInterval(t); done(0); }, 8000);`);
  await new Promise((r) => setTimeout(r, 2500)); // deal anim

  const logs = await wd('POST', `/session/${sessionId}/log`, { type: 'browser' });
  const errors = logs.filter((l) => l.level === 'SEVERE' && !/favicon/.test(l.message));
  check(errors.length === 0, 'no console errors on load' + (errors.length ? ': ' + JSON.stringify(errors) : ''));

  const info = await exec(`return {
    cards: document.querySelectorAll('.card').length,
    faceUp: document.querySelectorAll('.card.face-up').length,
    state: !!window.__sol.state,
    stock: window.__sol.state.stock.length,
    cardW: window.__sol.layout.cardW,
    boardW: document.getElementById('board').clientWidth,
  }`);
  check(info.cards === 52, `52 card divs (${info.cards})`);
  check(info.faceUp === 7, `7 face-up after deal (${info.faceUp})`);
  check(info.stock === 24, `24 in stock (${info.stock})`);
  console.log('layout:', JSON.stringify(info));
  await shot('01-fresh-deal');

  // Board coordinates -> viewport coordinates helper baked into page.
  await exec(`window.__pt = (x, y) => {
    const r = document.getElementById('board').getBoundingClientRect();
    return [Math.round(r.left + x), Math.round(r.top + y)];
  };`);

  // --- Tap the stock: draws a card ---
  const stockPt = await exec(`const L = __sol.layout; return __pt(L.stock.x + L.cardW/2, L.stock.y + L.cardH/2);`);
  await tap(stockPt[0], stockPt[1]);
  await new Promise((r) => setTimeout(r, 400));
  const waste1 = await exec(`return __sol.state.waste.length`);
  check(waste1 === 1, `tap stock draws 1 card (waste=${waste1})`);

  // --- Tap-to-smart-move: find a tableau top with a legal move and tap it ---
  const tapInfo = await exec(`
    const g = __sol.game, s = __sol.state, L = __sol.layout;
    for (let c = 0; c < 7; c++) {
      const col = s.tableau[c];
      if (!col.length) continue;
      const top = col[col.length - 1];
      const dest = g.findTapMove(s, 'T' + c, 1);
      if (dest) {
        const pos = __sol.render.getPositions().get(top);
        return { col: c, id: top, dest, pt: __pt(pos.x + L.cardW/2, pos.y + L.cardH/2), moves: s.moves.length };
      }
    }
    return null;`);
  if (tapInfo) {
    await tap(tapInfo.pt[0], tapInfo.pt[1]);
    await new Promise((r) => setTimeout(r, 450));
    const after = await exec(`return __sol.state.moves.length`);
    check(after === tapInfo.moves + 1, `tap smart-move executed (moves ${tapInfo.moves} -> ${after}, dest ${tapInfo.dest})`);
  } else {
    console.log('note: no legal tap move in this deal state, skipping');
  }
  await shot('02-after-taps');

  // --- Drag a card to a legal destination ---
  const dragInfo = await exec(`
    const g = __sol.game, s = __sol.state, L = __sol.layout;
    for (let c = 0; c < 7; c++) {
      const col = s.tableau[c];
      if (!col.length) continue;
      const top = col[col.length - 1];
      for (let d = 0; d < 7; d++) {
        if (d === c || !s.tableau[d].length) continue;
        if (g.canDrop(s, top, 'T' + d)) {
          const pos = __sol.render.getPositions().get(top);
          const destTop = s.tableau[d][s.tableau[d].length - 1];
          const dp = __sol.render.getPositions().get(destTop);
          return { from: __pt(pos.x + L.cardW/2, pos.y + L.cardH/2),
                   to: __pt(dp.x + L.cardW/2, dp.y + L.cardH/2),
                   src: 'T' + c, dest: 'T' + d, moves: s.moves.length };
        }
      }
    }
    return null;`);
  if (dragInfo) {
    const midX = (dragInfo.from[0] + dragInfo.to[0]) / 2;
    const midY = (dragInfo.from[1] + dragInfo.to[1]) / 2 - 30;
    await pointerDrag([dragInfo.from, [midX, midY], dragInfo.to]);
    await new Promise((r) => setTimeout(r, 450));
    const after = await exec(`return __sol.state.moves.length`);
    check(after === dragInfo.moves + 1, `drag-and-drop executed (${dragInfo.src} -> ${dragInfo.dest})`);
  } else {
    console.log('note: no tableau drag available, skipping');
  }

  // --- Illegal drag snaps back ---
  const illegal = await exec(`
    const g = __sol.game, s = __sol.state, L = __sol.layout;
    for (let c = 0; c < 7; c++) {
      const col = s.tableau[c];
      if (!col.length) continue;
      const top = col[col.length - 1];
      for (let d = 0; d < 7; d++) {
        if (d === c || !s.tableau[d].length) continue;
        if (!g.canDrop(s, top, 'T' + d)) {
          const pos = __sol.render.getPositions().get(top);
          const destTop = s.tableau[d][s.tableau[d].length - 1];
          const dp = __sol.render.getPositions().get(destTop);
          return { from: __pt(pos.x + L.cardW/2, pos.y + L.cardH/2),
                   to: __pt(dp.x + L.cardW/2, dp.y + L.cardH/2), id: top,
                   moves: s.moves.length };
        }
      }
    }
    return null;`);
  if (illegal) {
    await pointerDrag([illegal.from, illegal.to]);
    await new Promise((r) => setTimeout(r, 450));
    const st = await exec(`
      const p = __sol.render.getPositions().get(${illegal.id});
      const target = __sol.layout;
      return { moves: __sol.state.moves.length, x: p.x, y: p.y };`);
    check(st.moves === illegal.moves, 'illegal drop rejected (no move recorded)');
  }

  // --- Undo ---
  const movesBefore = await exec(`return __sol.state.moves.length`);
  if (movesBefore > 0) {
    await exec(`document.getElementById('btn-undo').click()`);
    await new Promise((r) => setTimeout(r, 350));
    const movesAfter = await exec(`return __sol.state.moves.length`);
    check(movesAfter === movesBefore - 1, `undo pops a move (${movesBefore} -> ${movesAfter})`);
  }

  // --- Persistence: reload restores ---
  const pre = await exec(`return { moves: __sol.state.moves.length, seed: __sol.state.seed }`);
  await wd('POST', `/session/${sessionId}/url`, { url: APP });
  await new Promise((r) => setTimeout(r, 1500));
  const post = await exec(`return { moves: __sol.state.moves.length, seed: __sol.state.seed }`);
  check(pre.seed === post.seed && pre.moves === post.moves,
    `reload restores game (seed ${pre.seed}, moves ${pre.moves} -> ${post.moves})`);
  await shot('03-restored');

  // --- Win flow: force a near-win state, autocomplete, watch cascade ---
  await exec(`
    const s = __sol.state;
    s.stock = []; s.waste = [];
    s.foundations = [[], [], [], []];
    s.tableau = [[], [], [], [], [], [], []];
    s.faceUp = new Array(52).fill(true);
    for (let f = 0; f < 4; f++) for (let r = 12; r >= 0; r--) s.tableau[f].push(f * 13 + r);
    __sol.render.sync(s, __sol.layout, { instant: true });`);
  await exec(`window.__sol.act({ type: 'draw' })`); // no-op, refresh autocomplete check
  const canAuto = await exec(`return __sol.game.canAutoComplete(__sol.state)`);
  check(canAuto, 'forced state is auto-completable');
  await exec(`__sol.autoComplete()`);
  await new Promise((r) => setTimeout(r, 52 * 100 + 2500));
  const winState = await exec(`return {
    won: __sol.state.won,
    cascadeVisible: !document.getElementById('cascade').classList.contains('hidden'),
    dlg: !document.getElementById('dlg-win').classList.contains('hidden'),
  }`);
  check(winState.won, 'auto-complete wins the game');
  check(winState.cascadeVisible, 'cascade canvas is showing');
  await shot('04-cascade');
  // Skip cascade by tapping.
  await tap(200, 400);
  await new Promise((r) => setTimeout(r, 600));
  const dlg = await exec(`return !document.getElementById('dlg-win').classList.contains('hidden')`);
  check(dlg, 'win dialog appears after cascade');
  await shot('05-win-dialog');

  const stats = await exec(`return JSON.parse(localStorage.getItem('sol.stats'))`);
  check(stats && stats[1] && stats[1].won >= 1, `stats recorded a win: ${JSON.stringify(stats?.[1])}`);

  // --- New game from win dialog ---
  await exec(`document.getElementById('win-new').click()`);
  await new Promise((r) => setTimeout(r, 2500));
  const fresh = await exec(`return { stock: __sol.state.stock.length, moves: __sol.state.moves.length, won: __sol.state.won }`);
  check(fresh.stock === 24 && fresh.moves === 0 && !fresh.won, 'new game deals cleanly after win');
  await shot('06-new-game');

  const logs2 = await wd('POST', `/session/${sessionId}/log`, { type: 'browser' });
  const errors2 = logs2.filter((l) => l.level === 'SEVERE' && !/favicon/.test(l.message));
  check(errors2.length === 0, 'no console errors after full session' + (errors2.length ? ': ' + JSON.stringify(errors2.slice(0, 3)) : ''));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (e) {
  console.error('HARNESS ERROR:', e.message);
  fail++;
} finally {
  if (sessionId) await wd('DELETE', `/session/${sessionId}`).catch(() => {});
  driver.kill();
  process.exit(fail ? 1 : 0);
}

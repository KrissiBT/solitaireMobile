// The classic win animation: cards launch from the foundations, bounce off the
// bottom of the screen, and smear trails behind them (the canvas is never
// cleared). Tap to skip.

import { faceSVG } from './cards.js';

const imgCache = new Map();

function cardImage(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  const svg = faceSVG(id).replace('<svg ', '<svg width="100" height="140" ');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imgCache.set(id, p);
  return p;
}

// state: won game; L: layout; boardOffset: board's position within the canvas.
export async function play(canvas, state, L, boardOffset, onDone) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Launch order: top of each foundation in turn (K, K, K, K, Q, Q, ...).
  const launchList = [];
  for (let i = 12; i >= 0; i--) {
    for (let f = 0; f < 4; f++) {
      const pile = state.foundations[f];
      if (pile[i] !== undefined) launchList.push({ id: pile[i], f });
    }
  }
  const images = new Map();
  await Promise.all(launchList.map(async (c) => images.set(c.id, await cardImage(c.id))));

  let running = true;
  let launched = 0;
  const active = [];
  let lastLaunch = -Infinity;
  const LAUNCH_EVERY = 150; // ms
  const g = 0.45;

  const finish = () => {
    if (!running) return;
    running = false;
    canvas.removeEventListener('pointerdown', finish);
    onDone();
  };
  canvas.addEventListener('pointerdown', finish);

  let prevT = performance.now();
  function frame(t) {
    if (!running) return;
    // Normalize physics to ~60fps steps regardless of display refresh rate.
    const steps = Math.max(1, Math.min(3, Math.round((t - prevT) / 16.7)));
    prevT = t;

    if (launched < launchList.length && t - lastLaunch >= LAUNCH_EVERY) {
      lastLaunch = t;
      const { id, f } = launchList[launched++];
      const fx = boardOffset.x + L.foundations[f].x;
      const fy = boardOffset.y + L.foundations[f].y;
      active.push({
        id,
        x: fx, y: fy,
        vx: (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 3.5),
        vy: -(2 + Math.random() * 4),
      });
    }

    for (let s = 0; s < steps; s++) {
      for (const c of active) {
        c.x += c.vx;
        c.vy += g;
        c.y += c.vy;
        if (c.y + L.cardH > H) {
          c.y = H - L.cardH;
          c.vy = -Math.abs(c.vy) * 0.78;
        }
      }
    }
    for (const c of active) {
      const img = images.get(c.id);
      if (img) ctx.drawImage(img, c.x, c.y, L.cardW, L.cardH);
    }
    for (let i = active.length - 1; i >= 0; i--) {
      const c = active[i];
      if (c.x < -L.cardW * 1.5 || c.x > W + L.cardW * 0.5) active.splice(i, 1);
    }

    if (launched >= launchList.length && active.length === 0) {
      finish();
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

export function clear(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

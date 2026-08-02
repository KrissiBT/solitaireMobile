// DOM-per-card renderer. 52 divs created once, positioned only via transform.

import { faceSVG } from './cards.js';
import { positionsFor } from './layout.js';

let board;
const cardEls = [];
const slotEls = {};
let hintEl;
let positions = new Map(); // id -> {x, y, z, faceUp} as currently rendered
const zTimers = new Map();

const RECYCLE_ICON =
  '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 12a8 8 0 0 1 13.6-5.7M20 12a8 8 0 0 1-13.6 5.7" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M17 2.5v4h-4M7 21.5v-4h4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function init(boardEl) {
  board = boardEl;

  for (const ref of ['S', 'W', 'F0', 'F1', 'F2', 'F3', 'T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6']) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.ref = ref;
    if (ref === 'S') el.innerHTML = RECYCLE_ICON;
    if (ref[0] === 'F') {
      el.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22"><text x="12" y="17" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">A</text></svg>';
    }
    board.appendChild(el);
    slotEls[ref] = el;
  }

  hintEl = document.createElement('div');
  hintEl.className = 'slot drop-hint hidden';
  hintEl.style.pointerEvents = 'none';
  board.appendChild(hintEl);

  for (let id = 0; id < 52; id++) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = id;
    const inner = document.createElement('div');
    inner.className = 'card-inner';
    const front = document.createElement('div');
    front.className = 'card-face card-front';
    front.innerHTML = faceSVG(id);
    const back = document.createElement('div');
    back.className = 'card-face card-back';
    inner.append(front, back);
    el.appendChild(inner);
    board.appendChild(el);
    cardEls.push(el);
  }
}

export const cardEl = (id) => cardEls[id];
export const getPositions = () => positions;

export function applyLayout(L) {
  document.documentElement.style.setProperty('--card-w', L.cardW + 'px');
  document.documentElement.style.setProperty('--card-h', L.cardH + 'px');
  const place = (el, p) => {
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
  };
  place(slotEls.S, L.stock);
  place(slotEls.W, L.waste);
  for (let f = 0; f < 4; f++) place(slotEls['F' + f], L.foundations[f]);
  for (let c = 0; c < 7; c++) place(slotEls['T' + c], { x: L.tableauX[c], y: L.tableauTop });
}

// Sync every card to the current state. Moved cards animate (CSS transition
// from wherever they currently are) unless `instant`; they get a raised
// z-index for the flight and settle back after the transition.
export function sync(state, L, { instant = false } = {}) {
  if (instant) board.classList.add('no-anim');
  const next = positionsFor(state, L);

  for (let id = 0; id < 52; id++) {
    const p = next.get(id);
    const prev = positions.get(id);
    const el = cardEls[id];
    const movedFar = prev && (Math.abs(prev.x - p.x) > 2 || Math.abs(prev.y - p.y) > 2);

    el.classList.toggle('face-up', p.faceUp);
    el.classList.remove('dragging');
    el.style.willChange = 'auto';
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;

    clearTimeout(zTimers.get(id));
    zTimers.delete(id);
    if (movedFar && !instant) {
      el.style.zIndex = 400 + p.z;
      zTimers.set(id, setTimeout(() => { el.style.zIndex = p.z; zTimers.delete(id); }, 230));
    } else {
      el.style.zIndex = p.z;
    }
    positions.set(id, p);
  }

  // Stock slot: recycle icon only useful when there is a waste to recycle.
  slotEls.S.firstElementChild?.classList.toggle(
    'hidden',
    !(state.stock.length === 0 && state.waste.length > 0)
  );

  if (instant) {
    void board.offsetHeight;
    board.classList.remove('no-anim');
  }
  return next;
}

// Manually position one card (used while dragging).
export function placeCard(id, x, y, z) {
  const el = cardEls[id];
  el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  if (z !== undefined) el.style.zIndex = z;
  const p = positions.get(id);
  if (p) { p.x = x; p.y = y; }
}

export function setDragging(ids, on) {
  ids.forEach((id, i) => {
    const el = cardEls[id];
    el.classList.toggle('dragging', on);
    el.style.willChange = on ? 'transform' : 'auto';
    if (on) el.style.zIndex = 1000 + i;
  });
}

export function showHint(rect) {
  if (!rect) {
    hintEl.classList.add('hidden');
    return;
  }
  hintEl.classList.remove('hidden');
  hintEl.style.width = rect.w + 'px';
  hintEl.style.height = rect.h + 'px';
  hintEl.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
}

export function shake(ids) {
  for (const id of ids) {
    const el = cardEls[id];
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }
}

// Deal: everything starts on the stock, tableau cards fly out one by one.
export function dealAnimation(state, L) {
  board.classList.add('no-anim');
  const target = positionsFor(state, L);
  for (let id = 0; id < 52; id++) {
    const el = cardEls[id];
    el.classList.remove('face-up');
    el.style.transform = `translate3d(${L.stock.x}px, ${L.stock.y}px, 0)`;
    el.style.zIndex = target.get(id).z;
  }
  void board.offsetHeight;
  board.classList.remove('no-anim');

  const anims = [];
  let order = 0;
  // Deal row by row, left to right, like a real dealer.
  const dealt = [];
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) dealt.push(state.tableau[col][row]);
  }
  for (const id of dealt) {
    const p = target.get(id);
    const el = cardEls[id];
    el.style.zIndex = 400 + order;
    const a = el.animate(
      [
        { transform: `translate3d(${L.stock.x}px, ${L.stock.y}px, 0)` },
        { transform: `translate3d(${p.x}px, ${p.y}px, 0)` },
      ],
      { duration: 200, delay: order * 28, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'backwards' }
    );
    anims.push(a.finished.then(() => {
      el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      el.style.zIndex = p.z;
      if (p.faceUp) el.classList.add('face-up');
    }));
    order++;
  }

  positions = target;
  return Promise.all(anims).catch(() => {});
}

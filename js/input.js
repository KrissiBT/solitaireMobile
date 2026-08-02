// Pointer input: tap vs drag state machine, geometric drop targeting.
// Gesture recognition lives here; game mutation is delegated to `onAction`.

import { canDrop, getPile, findTapMove } from './game.js';
import { dropTargets, rectOverlap } from './layout.js';
import * as render from './render.js';

const DRAG_THRESHOLD = 8; // px before a press becomes a drag
const MIN_OVERLAP = 0.15; // of card area, to accept a drop

let board, getState, getLayout, onAction;
let enabled = true;

let drag = null; // active gesture
let rafId = 0;

export function init(opts) {
  ({ board, getState, getLayout, onAction } = opts);
  board.addEventListener('pointerdown', onDown);
  board.addEventListener('pointermove', onMove);
  board.addEventListener('pointerup', onUp);
  board.addEventListener('pointercancel', onCancel);
  // iOS belt-and-braces: block scrolling/zoom gestures over the board.
  board.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}

export function setEnabled(v) {
  enabled = v;
  if (!v && drag) endDrag(false);
}

function boardPoint(e) {
  const r = board.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// Which pile is card `id` in right now?
function locate(state, id) {
  if (state.stock.includes(id)) return { ref: 'S', index: state.stock.indexOf(id) };
  if (state.waste.includes(id)) return { ref: 'W', index: state.waste.indexOf(id) };
  for (let f = 0; f < 4; f++) {
    const i = state.foundations[f].indexOf(id);
    if (i >= 0) return { ref: 'F' + f, index: i };
  }
  for (let c = 0; c < 7; c++) {
    const i = state.tableau[c].indexOf(id);
    if (i >= 0) return { ref: 'T' + c, index: i };
  }
  return null;
}

// Topmost card whose rect contains the point.
function hitCard(pt) {
  const L = getLayout();
  const positions = render.getPositions();
  let best = null;
  for (const [id, p] of positions) {
    if (pt.x >= p.x && pt.x <= p.x + L.cardW && pt.y >= p.y && pt.y <= p.y + L.cardH) {
      if (!best || p.z > best.z) best = { id, ...p };
    }
  }
  return best;
}

function inStockZone(pt) {
  const L = getLayout();
  return (
    pt.x >= L.stock.x - 6 && pt.x <= L.stock.x + L.cardW + 6 &&
    pt.y >= L.stock.y - 6 && pt.y <= L.stock.y + L.cardH + 6
  );
}

// The run of cards the user may pick up starting from `id`, or null.
function grabbableRun(state, id) {
  const loc = locate(state, id);
  if (!loc) return null;
  const pile = getPile(state, loc.ref);
  if (loc.ref === 'S') return null;
  if (loc.ref === 'W' || loc.ref[0] === 'F') {
    return loc.index === pile.length - 1 ? { src: loc.ref, ids: [id] } : null;
  }
  if (!state.faceUp[id]) return null;
  return { src: loc.ref, ids: pile.slice(loc.index) };
}

function onDown(e) {
  if (!enabled || drag) return;
  if (e.button !== undefined && e.button !== 0) return;
  const pt = boardPoint(e);
  const state = getState();

  drag = {
    pointerId: e.pointerId,
    startPt: pt,
    lastPt: pt,
    moved: false,
    run: null,
    stockTap: false,
    origins: null,
  };

  if (inStockZone(pt)) {
    drag.stockTap = true;
  } else {
    const hit = hitCard(pt);
    if (hit) {
      const loc = locate(state, hit.id);
      if (loc && loc.ref === 'S') {
        drag.stockTap = true;
      } else if (hit) {
        drag.run = grabbableRun(state, hit.id);
        drag.tappedId = hit.id;
      }
    }
    if (!drag.run && !drag.stockTap) {
      drag = null;
      return;
    }
  }
  try { board.setPointerCapture(e.pointerId); } catch {}
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const pt = boardPoint(e);
  drag.lastPt = pt;
  if (!drag.moved) {
    const dx = pt.x - drag.startPt.x;
    const dy = pt.y - drag.startPt.y;
    if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
    drag.moved = true;
    if (drag.run) beginDrag();
  }
  if (drag.dragging && !rafId) rafId = requestAnimationFrame(dragFrame);
}

function beginDrag() {
  const positions = render.getPositions();
  drag.dragging = true;
  drag.origins = drag.run.ids.map((id) => {
    const p = positions.get(id);
    return { id, x: p.x, y: p.y };
  });
  render.setDragging(drag.run.ids, true);
}

function dragFrame() {
  rafId = 0;
  if (!drag || !drag.dragging) return;
  const dx = drag.lastPt.x - drag.startPt.x;
  const dy = drag.lastPt.y - drag.startPt.y;
  for (let i = 0; i < drag.origins.length; i++) {
    const o = drag.origins[i];
    render.placeCard(o.id, o.x + dx, o.y + dy, 1000 + i);
  }
  const target = findDropTarget();
  render.showHint(target ? target.rect : null);
  drag.currentTarget = target;
}

function findDropTarget() {
  const state = getState();
  const L = getLayout();
  const positions = render.getPositions();
  const lead = drag.origins[0];
  const leadPos = positions.get(lead.id);
  const leadRect = { x: leadPos.x, y: leadPos.y, w: L.cardW, h: L.cardH };
  const cardArea = L.cardW * L.cardH;
  const n = drag.run.ids.length;

  let best = null;
  for (const t of dropTargets(state, L, positions)) {
    if (t.ref === drag.run.src) continue;
    if (!canDrop(state, lead.id, t.ref, n)) continue;
    const ov = rectOverlap(leadRect, t.rect);
    if (ov < cardArea * MIN_OVERLAP) continue;
    if (!best || ov > best.overlap) best = { ref: t.ref, rect: t.rect, overlap: ov };
  }
  return best;
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const state = getState();

  if (drag.dragging) {
    // Final position update, then resolve the drop.
    const target = findDropTarget();
    endDrag(false);
    if (target) {
      onAction({ type: 'move', src: drag.run.src, dest: target.ref, n: drag.run.ids.length });
    } else {
      onAction({ type: 'settle' }); // snap back
    }
    drag = null;
    return;
  }

  // Tap.
  if (drag.stockTap && !drag.moved) {
    onAction({ type: 'draw' });
  } else if (drag.run && !drag.moved) {
    const { src, ids } = drag.run;
    if (src[0] === 'F') {
      // Taps on foundations are inert; dragging back down is still allowed.
    } else {
      const dest = findTapMove(state, src, ids.length);
      if (dest) {
        onAction({ type: 'move', src, dest, n: ids.length });
      } else {
        onAction({ type: 'invalid', ids });
      }
    }
  }
  drag = null;
}

function onCancel(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  endDrag(true);
  drag = null;
}

function endDrag(settle) {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  render.showHint(null);
  if (drag && drag.dragging) {
    render.setDragging(drag.run.ids, false);
    if (settle) onAction({ type: 'settle' });
  }
}

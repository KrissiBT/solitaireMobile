// Single source of truth for coordinates. Everything is computed in CSS pixels
// relative to the #board element; renderer and hit-testing both consume this.

export function computeLayout(boardW, boardH, { lefty = false } = {}) {
  const margin = 8;
  const gap = Math.max(4, Math.round(boardW * 0.015));
  let cardW = Math.floor((boardW - 2 * margin - 6 * gap) / 7);
  let cardH = Math.round(cardW / 0.72);

  // Height clamp (landscape): top row + gap + one card + minimal fan room must fit.
  const topPad = 6;
  const rowGap = Math.round(cardW * 0.3);
  const maxCardH = Math.floor((boardH - topPad - rowGap - 10) / 2.6);
  if (cardH > maxCardH) {
    cardH = Math.max(40, maxCardH);
    cardW = Math.round(cardH * 0.72);
  }

  const colX = (i) => {
    const idx = lefty ? 6 - i : i;
    const rowW = 7 * cardW + 6 * gap;
    const x0 = (boardW - rowW) / 2;
    return Math.round(x0 + idx * (cardW + gap));
  };

  const topRowY = topPad;
  const tableauTop = topRowY + cardH + rowGap;

  return {
    boardW, boardH, cardW, cardH, gap, lefty,
    topRowY, tableauTop,
    stock: { x: colX(0), y: topRowY },
    waste: { x: colX(1), y: topRowY },
    wasteFan: Math.round(cardW * 0.3),
    foundations: [0, 1, 2, 3].map((i) => ({ x: colX(3 + i), y: topRowY })),
    tableauX: [0, 1, 2, 3, 4, 5, 6].map(colX),
    fanDown: 0.18 * cardH,
    fanUp: 0.27 * cardH,
    minFanDown: 0.07 * cardH,
    minFanUp: 0.16 * cardH,
    bottomPad: 8,
  };
}

// Per-column fan offsets, compressed to fit the height budget.
function columnOffsets(state, L, col) {
  const cards = state.tableau[col];
  const n = cards.length;
  if (n <= 1) return [];
  let fanUp = L.fanUp;
  let fanDown = L.fanDown;
  const budget = L.boardH - L.tableauTop - L.cardH - L.bottomPad;
  const spread = (fu, fd) => {
    let total = 0;
    for (let i = 0; i < n - 1; i++) total += state.faceUp[cards[i]] ? fu : fd;
    return total;
  };
  let total = spread(fanUp, fanDown);
  if (total > budget) {
    const scale = budget / total;
    fanUp = Math.max(L.minFanUp, fanUp * scale);
    fanDown = Math.max(L.minFanDown, fanDown * scale);
    // Floors may still overflow on absurd columns; squeeze face-up spacing last.
    total = spread(fanUp, fanDown);
    if (total > budget) {
      const fixed = spread(0, fanDown);
      const upCount = cards.slice(0, -1).filter((id) => state.faceUp[id]).length;
      if (upCount > 0) fanUp = Math.max(L.cardH * 0.11, (budget - fixed) / upCount);
    }
  }
  const offs = [];
  for (let i = 0; i < n - 1; i++) offs.push(state.faceUp[cards[i]] ? fanUp : fanDown);
  return offs;
}

// Map card id -> {x, y, z, faceUp} for every card in the current state.
export function positionsFor(state, L) {
  const pos = new Map();
  state.stock.forEach((id, i) => {
    pos.set(id, { x: L.stock.x, y: L.stock.y, z: 1 + i, faceUp: false });
  });

  const wn = state.waste.length;
  const visible = state.drawMode === 3 ? Math.min(3, wn) : 1;
  state.waste.forEach((id, i) => {
    const fanIdx = Math.max(0, i - (wn - visible));
    pos.set(id, { x: L.waste.x + fanIdx * L.wasteFan, y: L.waste.y, z: 30 + i, faceUp: true });
  });

  state.foundations.forEach((pile, f) => {
    pile.forEach((id, i) => {
      pos.set(id, { x: L.foundations[f].x, y: L.foundations[f].y, z: 60 + f * 15 + i, faceUp: true });
    });
  });

  for (let c = 0; c < 7; c++) {
    const offs = columnOffsets(state, L, c);
    let y = L.tableauTop;
    state.tableau[c].forEach((id, i) => {
      pos.set(id, { x: L.tableauX[c], y: Math.round(y), z: 130 + c * 25 + i, faceUp: !!state.faceUp[id] });
      y += offs[i] ?? 0;
    });
  }
  return pos;
}

// Geometric drop zones for drag targeting (legality is filtered by the caller).
export function dropTargets(state, L, positions) {
  const targets = [];
  for (let f = 0; f < 4; f++) {
    targets.push({
      ref: 'F' + f,
      rect: { x: L.foundations[f].x, y: L.foundations[f].y, w: L.cardW, h: L.cardH },
    });
  }
  for (let c = 0; c < 7; c++) {
    const col = state.tableau[c];
    let topY = L.tableauTop;
    if (col.length) topY = positions.get(col[col.length - 1]).y;
    targets.push({
      ref: 'T' + c,
      rect: { x: L.tableauX[c], y: topY, w: L.cardW, h: L.cardH * 1.6 },
    });
  }
  return targets;
}

export function rectOverlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// Pure Klondike rules engine. No DOM. Piles are referenced by string:
// 'S' stock, 'W' waste, 'F0'-'F3' foundations, 'T0'-'T6' tableau columns.

import { suitOf, rankOf, isRed } from './cards.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newGame(seed, drawMode) {
  const rng = mulberry32(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const state = {
    seed,
    drawMode,
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    faceUp: new Array(52).fill(false),
    moves: [],
    elapsedMs: 0,
    started: false,
    won: false,
  };

  let k = 0;
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const id = deck[k++];
      state.tableau[col].push(id);
      if (row === col) state.faceUp[id] = true;
    }
  }
  while (k < 52) state.stock.push(deck[k++]);
  return state;
}

export function getPile(state, ref) {
  if (ref === 'S') return state.stock;
  if (ref === 'W') return state.waste;
  if (ref[0] === 'F') return state.foundations[+ref[1]];
  return state.tableau[+ref[1]];
}

// Can `cardId` (with possibly more cards on top of it) land on pile `dest`?
export function canDrop(state, cardId, dest, n = 1) {
  const pile = getPile(state, dest);
  if (dest[0] === 'F') {
    if (n !== 1) return false;
    if (pile.length === 0) return rankOf(cardId) === 0;
    const top = pile[pile.length - 1];
    return suitOf(top) === suitOf(cardId) && rankOf(cardId) === rankOf(top) + 1;
  }
  if (dest[0] === 'T') {
    if (pile.length === 0) return rankOf(cardId) === 12;
    const top = pile[pile.length - 1];
    if (!state.faceUp[top]) return false;
    return rankOf(top) === rankOf(cardId) + 1 && isRed(top) !== isRed(cardId);
  }
  return false;
}

// Move the top `n` cards of `src` onto `dest`. Returns the move record, or null if illegal.
export function move(state, src, dest, n = 1) {
  if (src === dest) return null;
  const from = getPile(state, src);
  if (from.length < n || n < 1) return null;
  if (src === 'S' || dest === 'S' || dest === 'W') return null;
  if (n > 1 && (src[0] !== 'T' || dest[0] !== 'T')) return null;

  const movingBottom = from[from.length - n];
  if (src[0] === 'T') {
    for (let i = from.length - n; i < from.length; i++) {
      if (!state.faceUp[from[i]]) return null;
    }
  }
  if (!canDrop(state, movingBottom, dest, n)) return null;

  const to = getPile(state, dest);
  to.push(...from.splice(from.length - n, n));

  let flipped = false;
  if (src[0] === 'T' && from.length > 0 && !state.faceUp[from[from.length - 1]]) {
    state.faceUp[from[from.length - 1]] = true;
    flipped = true;
  }

  const rec = { t: 'move', src, dest, n, flipped };
  state.moves.push(rec);
  state.started = true;
  if (state.foundations.every((f) => f.length === 13)) state.won = true;
  return rec;
}

// Flip stock cards to the waste, or recycle the waste when the stock is empty.
export function draw(state) {
  if (state.stock.length > 0) {
    const n = Math.min(state.drawMode, state.stock.length);
    for (let i = 0; i < n; i++) {
      const id = state.stock.pop();
      state.waste.push(id);
      state.faceUp[id] = true;
    }
    const rec = { t: 'draw', n };
    state.moves.push(rec);
    state.started = true;
    return rec;
  }
  if (state.waste.length > 0) {
    const n = state.waste.length;
    while (state.waste.length) {
      const id = state.waste.pop();
      state.stock.push(id);
      state.faceUp[id] = false;
    }
    const rec = { t: 'recycle', n };
    state.moves.push(rec);
    state.started = true;
    return rec;
  }
  return null;
}

// Undo the last action. Returns the inverted record (for animation), or null.
export function undo(state) {
  const rec = state.moves.pop();
  if (!rec) return null;
  if (rec.t === 'move') {
    const from = getPile(state, rec.src);
    const to = getPile(state, rec.dest);
    if (rec.flipped) state.faceUp[from[from.length - 1]] = false;
    from.push(...to.splice(to.length - rec.n, rec.n));
    state.won = false;
  } else if (rec.t === 'draw') {
    for (let i = 0; i < rec.n; i++) {
      const id = state.waste.pop();
      state.stock.push(id);
      state.faceUp[id] = false;
    }
  } else if (rec.t === 'recycle') {
    while (state.stock.length) {
      const id = state.stock.pop();
      state.waste.push(id);
      state.faceUp[id] = true;
    }
  }
  return rec;
}

export function isWon(state) {
  return state.won;
}

// True when the rest of the game is a formality: nothing hidden anywhere.
export function canAutoComplete(state) {
  if (state.won || state.stock.length > 0 || state.waste.length > 0) return false;
  let remaining = false;
  for (const col of state.tableau) {
    for (const id of col) {
      if (!state.faceUp[id]) return false;
      remaining = true;
    }
  }
  return remaining;
}

// Next safe move for auto-complete: lowest-rank tableau top that fits a foundation.
export function nextAutoMove(state) {
  let best = null;
  for (let c = 0; c < 7; c++) {
    const col = state.tableau[c];
    if (!col.length) continue;
    const id = col[col.length - 1];
    for (let f = 0; f < 4; f++) {
      if (canDrop(state, id, 'F' + f)) {
        if (!best || rankOf(id) < best.rank) best = { src: 'T' + c, dest: 'F' + f, rank: rankOf(id) };
      }
    }
  }
  return best;
}

// Smart destination for a tapped run of `n` cards starting at the top-`n` of `src`.
// Foundations first (single top card only), then the most useful tableau column.
export function findTapMove(state, src, n) {
  const from = getPile(state, src);
  const card = from[from.length - n];

  if (n === 1) {
    for (let f = 0; f < 4; f++) {
      if (canDrop(state, card, 'F' + f)) return 'F' + f;
    }
  }

  // Moving a full column whose bottom is a king to another empty column is a no-op.
  const pointlessKing = src[0] === 'T' && from.length === n && rankOf(card) === 12;

  let bestEmpty = null;
  for (let c = 0; c < 7; c++) {
    const dest = 'T' + c;
    if (dest === src) continue;
    if (!canDrop(state, card, dest, n)) continue;
    if (state.tableau[c].length === 0) {
      if (!pointlessKing && bestEmpty === null) bestEmpty = dest;
    } else {
      return dest;
    }
  }
  return bestEmpty;
}

// Engine sanity tests for game.js (pure, DOM-free).
import * as g from '../js/game.js';
import { rankOf, suitOf } from '../js/cards.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
};

const snapshot = (s) => JSON.stringify({
  stock: s.stock, waste: s.waste, foundations: s.foundations,
  tableau: s.tableau, faceUp: s.faceUp,
});

// --- deterministic deal ---
const a = g.newGame(42, 1);
const b = g.newGame(42, 1);
assert(snapshot(a) === snapshot(b), 'same seed -> identical deal');
const c = g.newGame(43, 1);
assert(snapshot(a) !== snapshot(c), 'different seed -> different deal');

// --- deal shape ---
assert(a.stock.length === 24, 'stock has 24 cards');
for (let i = 0; i < 7; i++) {
  assert(a.tableau[i].length === i + 1, `tableau ${i} has ${i + 1} cards`);
  const top = a.tableau[i][a.tableau[i].length - 1];
  assert(a.faceUp[top], `tableau ${i} top face up`);
  for (let j = 0; j < a.tableau[i].length - 1; j++) {
    assert(!a.faceUp[a.tableau[i][j]], `tableau ${i} buried cards face down`);
  }
}
const all = [...a.stock, ...a.tableau.flat()].sort((x, y) => x - y);
assert(all.length === 52 && all.every((v, i) => v === i), 'all 52 cards present exactly once');

// --- draw / recycle / undo round-trip ---
{
  const s = g.newGame(7, 3);
  const before = snapshot(s);
  g.draw(s);
  assert(s.waste.length === 3, 'draw-3 flips 3 cards');
  assert(s.waste.every((id) => s.faceUp[id]), 'waste cards face up');
  g.undo(s);
  assert(snapshot(s) === before, 'undo draw restores exactly');

  // Exhaust stock, recycle, undo everything.
  while (s.stock.length) g.draw(s);
  const wasteOrder = [...s.waste];
  g.draw(s); // recycle
  assert(s.stock.length === 24 && s.waste.length === 0, 'recycle moves all back');
  g.draw(s);
  assert(s.waste[0] === wasteOrder[0], 'post-recycle draw order preserved');
  while (s.moves.length) g.undo(s);
  assert(snapshot(s) === before, 'undo-all returns to fresh deal');
}

// --- move legality ---
{
  const s = g.newGame(1, 1);
  // Empty foundation only accepts an ace.
  for (let id = 0; id < 52; id++) {
    const ok = g.canDrop(s, id, 'F0');
    assert(ok === (rankOf(id) === 0), `only aces on empty foundation (card ${id})`);
  }
  // Empty tableau only accepts a king.
  s.tableau[0] = [];
  for (let id = 0; id < 52; id++) {
    if (s.tableau.flat().includes(id) || s.stock.includes(id)) continue;
    assert(g.canDrop(s, id, 'T0') === (rankOf(id) === 12), `only kings on empty col (card ${id})`);
  }
}

// --- full playthrough via scripted foundation fill ---
{
  const s = g.newGame(1, 1);
  // Cheat: rebuild a nearly-won position legally-shaped, then autocomplete.
  s.stock = []; s.waste = [];
  s.foundations = [[], [], [], []];
  s.tableau = [[], [], [], [], [], [], []];
  s.faceUp = new Array(52).fill(true);
  // Suit i king-to-ace stacked in tableau cols is illegal Klondike stacking, so
  // instead: put each suit A..K split as tops repeatedly: place all cards of
  // suit f in column f ordered K..A (top is A). Autocomplete only pops tops.
  for (let f = 0; f < 4; f++) {
    for (let r = 12; r >= 0; r--) s.tableau[f].push(f * 13 + r);
  }
  assert(g.canAutoComplete(s), 'autocomplete available when all face up, stock+waste empty');
  let steps = 0;
  let mv;
  while ((mv = g.nextAutoMove(s)) && steps < 200) {
    const rec = g.move(s, mv.src, mv.dest, 1);
    assert(rec !== null, 'auto move is legal');
    steps++;
  }
  assert(steps === 52, `autocomplete finishes in 52 moves (got ${steps})`);
  assert(s.won, 'game marked won');
  for (let f = 0; f < 4; f++) {
    const pile = s.foundations.find((p) => p.length && suitOf(p[0]) === f);
    assert(pile && pile.length === 13, `suit ${f} foundation complete`);
    assert(pile.every((id, i) => rankOf(id) === i), `suit ${f} in A..K order`);
  }
}

// --- undo of a tableau move restores flip state ---
{
  const s = g.newGame(3, 1);
  // Find any legal tableau->tableau or waste move by brute force after some draws.
  let done = false;
  for (let tries = 0; tries < 100 && !done; tries++) {
    for (let c = 0; c < 7 && !done; c++) {
      const col = s.tableau[c];
      if (!col.length) continue;
      const top = col[col.length - 1];
      for (let d = 0; d < 7 && !done; d++) {
        if (d === c) continue;
        if (g.canDrop(s, top, 'T' + d)) {
          const before = snapshot(s);
          const rec = g.move(s, 'T' + c, 'T' + d, 1);
          g.undo(s);
          assert(snapshot(s) === before, 'undo tableau move restores exactly (incl. flip)');
          done = true;
        }
      }
    }
    if (!done) g.draw(s);
  }
  assert(done, 'found a tableau move to test undo with');
}

// --- findTapMove prefers foundation ---
{
  const s = g.newGame(1, 1);
  s.stock = []; s.waste = [];
  s.tableau = [[], [], [], [], [], [], []];
  s.foundations = [[], [], [], []];
  s.faceUp = new Array(52).fill(true);
  s.tableau[0] = [0];            // ace of spades on col 0
  s.tableau[1] = [14];           // 2 of hearts
  const dest = g.findTapMove(s, 'T0', 1);
  assert(dest && dest[0] === 'F', `tap ace -> foundation (got ${dest})`);
  // King alone on a column should not hop to another empty column.
  s.tableau[2] = [12];           // king of spades alone
  assert(g.findTapMove(s, 'T2', 1) === null, 'lone king does not hop between empties');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Inline-SVG card face generation. Card ids 0..51:
// suit = id / 13 | 0  (0=spades, 1=hearts, 2=diamonds, 3=clubs), rank = id % 13 (0=A .. 12=K)

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

export const suitOf = (id) => (id / 13) | 0;
export const rankOf = (id) => id % 13;
export const isRed = (id) => suitOf(id) === 1 || suitOf(id) === 2;

const RED = '#d22b2b';
const BLACK = '#1e2430';

// Suit shapes normalized to a 32x32 box, fill inherited.
const SUIT_MARKUP = [
  // spades
  '<path d="M16 1.5 C22.5 8.5 30 13.5 30 20.5 C30 24.6 26.8 27.6 23 27.6 C20.9 27.6 19 26.7 17.8 25.3 C18.1 27.9 19.3 29.9 21 31.2 L11 31.2 C12.7 29.9 13.9 27.9 14.2 25.3 C13 26.7 11.1 27.6 9 27.6 C5.2 27.6 2 24.6 2 20.5 C2 13.5 9.5 8.5 16 1.5 Z"/>',
  // hearts
  '<path d="M16 30.4 C9.5 23.3 0.5 18.6 0.5 9.2 C0.5 4.6 4.3 0.8 8.9 0.8 C12.3 0.8 15 3.5 16 6.4 C17 3.5 19.7 0.8 23.1 0.8 C27.7 0.8 31.5 4.6 31.5 9.2 C31.5 18.6 22.5 23.3 16 30.4 Z"/>',
  // diamonds
  '<path d="M16 0.8 L27.6 16 L16 31.2 L4.4 16 Z"/>',
  // clubs
  '<circle cx="16" cy="9.2" r="7.4"/><circle cx="8" cy="20.4" r="7.4"/><circle cx="24" cy="20.4" r="7.4"/><path d="M16 12 L21.5 21.5 L10.5 21.5 Z"/><path d="M14.2 23.5 C14.5 27 13.3 29.7 11.5 31.2 L20.5 31.2 C18.7 29.7 17.5 27 17.8 23.5 Z"/>',
];

function suitAt(suit, cx, cy, size, color) {
  const s = size / 32;
  return `<g fill="${color}" transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})">${SUIT_MARKUP[suit]}</g>`;
}

const FONT = `-apple-system, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`;

// Full standalone SVG document for card `id`, viewBox 100x140 (scales to any size).
export function faceSVG(id) {
  const suit = suitOf(id);
  const rank = rankOf(id);
  const color = isRed(id) ? RED : BLACK;
  const rankTxt = RANKS[rank];

  // Corner index (rank + small suit), duplicated rotated for the bottom-right corner.
  const rankSize = rankTxt === '10' ? 21 : 24;
  const corner =
    `<text x="14" y="24" font-family="${FONT}" font-size="${rankSize}" font-weight="700" fill="${color}" text-anchor="middle">${rankTxt}</text>` +
    suitAt(suit, 14, 37, 15, color);

  // Center artwork.
  let center;
  if (rank === 0) {
    center = suitAt(suit, 56, 78, 52, color);
  } else if (rank >= 10) {
    const letter = rankTxt;
    center =
      `<rect x="30" y="38" width="52" height="78" rx="7" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.75"/>` +
      `<rect x="34.5" y="42.5" width="43" height="69" rx="4" fill="none" stroke="${color}" stroke-width="1" opacity="0.35"/>` +
      suitAt(suit, 56, 56, 15, color) +
      `<text x="56" y="92" font-family="${FONT}" font-size="38" font-weight="700" fill="${color}" text-anchor="middle">${letter}</text>` +
      `<g transform="rotate(180 56 103)">${suitAt(suit, 56, 103, 15, color)}</g>`;
  } else {
    center = suitAt(suit, 56, 78, 42, color);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" role="img" aria-label="${rankTxt} of ${SUIT_NAMES[suit]}">` +
    `<rect x="0.75" y="0.75" width="98.5" height="138.5" rx="10" fill="#ffffff" stroke="#d9d7cf" stroke-width="1.5"/>` +
    corner +
    center +
    `<g transform="rotate(180 50 70)">${corner}</g>` +
    `</svg>`
  );
}

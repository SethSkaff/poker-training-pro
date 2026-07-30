/**
 * Strict public-card parsing for the 3D renderer.
 *
 * This accepts the compact codes used by old fixtures and the glyph labels
 * emitted by the DOM formatter, but deliberately rejects every other string.
 * The caller therefore cannot turn arbitrary engine/private data into a card
 * texture by accident.
 */
export interface PublicCardFace {
  readonly rank: "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
  readonly suit: "clubs" | "diamonds" | "hearts" | "spades";
  readonly glyph: "♣" | "♦" | "♥" | "♠";
  readonly red: boolean;
}

const suits = {
  c: { suit: "clubs", glyph: "♣", red: false },
  d: { suit: "diamonds", glyph: "♦", red: true },
  h: { suit: "hearts", glyph: "♥", red: true },
  s: { suit: "spades", glyph: "♠", red: false },
  "♣": { suit: "clubs", glyph: "♣", red: false },
  "♦": { suit: "diamonds", glyph: "♦", red: true },
  "♥": { suit: "hearts", glyph: "♥", red: true },
  "♠": { suit: "spades", glyph: "♠", red: false },
} as const;

/** Parses only a canonical public rank/suit label. */
export function parsePublicCardFace(code: string): PublicCardFace | null {
  const match = /^(2|3|4|5|6|7|8|9|T|J|Q|K|A)([cdhs♣♦♥♠])$/i.exec(code);
  if (!match) return null;
  const rank = match[1]?.toUpperCase() as PublicCardFace["rank"] | undefined;
  const rawSuit = match[2]?.toLowerCase();
  const suit = rawSuit ? suits[rawSuit as keyof typeof suits] : undefined;
  if (!rank || !suit) return null;
  return { rank, ...suit };
}

/**
 * Bounded local procedural atlas dimensions; 52 faces are about 4.7 MiB.
 *
 * Raised from 96x136. The board lies flat on the felt 1.4 m from a seated eye
 * and is read at a 25-degree grazing angle, which is a far harder job than the
 * hero's own two cards: at the old size a board card resolved to about thirty
 * pixels of usable face and the rank was a guess. The extra memory is a
 * rounding error against the 128 MiB texture budget.
 */
export const PROCEDURAL_CARD_FACE_SIZE = Object.freeze({ width: 132, height: 186 });
export const PROCEDURAL_TABLE_MARKER_SIZE = Object.freeze({ width: 64, height: 64 });

/** No mip chain: card faces stay screen-facing and use one exact base level. */
export const PROCEDURAL_CARD_FACE_USE_MIPMAPS = false;

export function proceduralCardFaceBytes(): number {
  return PROCEDURAL_CARD_FACE_SIZE.width * PROCEDURAL_CARD_FACE_SIZE.height * 4;
}

export function proceduralTableMarkerBytes(): number {
  return PROCEDURAL_TABLE_MARKER_SIZE.width * PROCEDURAL_TABLE_MARKER_SIZE.height * 4;
}

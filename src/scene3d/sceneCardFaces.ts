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

/** Bounded local procedural atlas dimensions; 52 faces are about 2.5 MiB. */
export const PROCEDURAL_CARD_FACE_SIZE = Object.freeze({ width: 96, height: 136 });

/** No mip chain: card faces stay screen-facing and use one exact base level. */
export const PROCEDURAL_CARD_FACE_USE_MIPMAPS = false;

export function proceduralCardFaceBytes(): number {
  return PROCEDURAL_CARD_FACE_SIZE.width * PROCEDURAL_CARD_FACE_SIZE.height * 4;
}

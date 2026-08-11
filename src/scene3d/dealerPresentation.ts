/**
 * Public-only choreography for the dealer's physical card equipment.
 *
 * This deliberately knows no card order, hole-card value, or engine state.
 * The hand id and public presentation event are enough to alternate the two
 * visible packs and to put a card on the correct public destination.
 */
import { TABLE_ANCHORS, TABLE_HEIGHT } from "./tableStations";

export type DeckColour = "red" | "blue";

export interface DealerPresentationTransition {
  readonly kind: string;
  readonly handId?: string;
  readonly cardIndex?: number;
  readonly progress: number;
}

export function deckColourForHand(handId: string | undefined): DeckColour {
  /*
    Tournament hand ids end in `hand-N`.  Use that public, monotonic number
    when it is available so the two physical packs take turns predictably:
    the opening hand is red, the next is blue, and no event within either hand
    can ever change the chosen pack.  Some previews use descriptive ids rather
    than tournament ids; those retain a stable hashed fallback.
  */
  const numberedHand = handId?.match(/(?:^|:)hand-(\d+)$/i);
  if (numberedHand) return Number(numberedHand[1]) % 2 === 1 ? "red" : "blue";
  let hash = 2166136261;
  for (const character of handId ?? "public-table") {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0) % 2 === 0 ? "red" : "blue";
}

export function inactiveDeckColour(handId: string | undefined): DeckColour {
  return deckColourForHand(handId) === "red" ? "blue" : "red";
}

/** The public discard spot is always just left of the dealer's shoe. */
export const MUCK_POSITION = TABLE_ANCHORS.muck;

/** A board card comes from the shoe, pitches, then turns face-up on the felt. */
export function boardStreetRequiresBurn(cardIndex: number): boolean {
  return cardIndex === 0 || cardIndex === 3 || cardIndex === 4;
}

export function boardDealPose(cardIndex: number, progress: number): {
  readonly position: readonly [number, number, number];
  readonly rotationX: number;
  readonly visible: boolean;
} {
  const t = Math.max(0, Math.min(1, progress));
  const target: readonly [number, number, number] = [
    TABLE_ANCHORS.board[0] + (cardIndex - 2) * 0.105 * 1.5,
    TABLE_HEIGHT + 0.009,
    TABLE_ANCHORS.board[2],
  ];
  /*
   * A board street is deliberately split into two visible jobs.  The dealer
   * burns first, then takes the next card and pitches it to the board.  The
   * public presentation queue only has one event for the resulting board card,
   * so this function owns the latter portion of that same beat.
   */
  // One burn per street: before the flop, turn, and river. The second and
  // third flop cards continue directly from the shoe instead of inventing two
  // extra burns.
  const dealStart = boardStreetRequiresBurn(cardIndex) ? 0.36 : 0.08;
  const deal = Math.max(0, Math.min(1, (t - dealStart) / (1 - dealStart)));
  const arc = Math.sin(Math.PI * deal) * 0.11;
  return {
    position: [
      TABLE_ANCHORS.dealerThrow[0] + (target[0] - TABLE_ANCHORS.dealerThrow[0]) * deal,
      TABLE_ANCHORS.dealerThrow[1] + (target[1] - TABLE_ANCHORS.dealerThrow[1]) * deal + arc,
      TABLE_ANCHORS.dealerThrow[2] + (target[2] - TABLE_ANCHORS.dealerThrow[2]) * deal,
    ],
    // A card is face-down for its pitch and makes a positive face-up turn only
    // once it reaches the board; reduced motion passes t=1 and gets this end.
    rotationX: deal >= 1 ? 0 : deal < 0.68 ? Math.PI : Math.PI * (1 - (deal - 0.68) / 0.32),
    visible: t >= dealStart && t < 1,
  };
}

/** The face-down burn card, shoe to dealer-side muck once per board street. */
export function burnCardPose(progress: number): {
  readonly position: readonly [number, number, number];
  readonly visible: boolean;
} {
  const t = Math.max(0, Math.min(1, progress));
  const burnEnd = 0.32;
  const travel = Math.max(0, Math.min(1, t / burnEnd));
  const lift = Math.sin(Math.PI * travel) * 0.045;
  return {
    position: [
      TABLE_ANCHORS.dealerShoe[0] + (TABLE_ANCHORS.muck[0] - TABLE_ANCHORS.dealerShoe[0]) * travel,
      TABLE_ANCHORS.dealerShoe[1] + lift,
      TABLE_ANCHORS.dealerShoe[2] + (TABLE_ANCHORS.muck[2] - TABLE_ANCHORS.dealerShoe[2]) * travel,
    ],
    visible: t >= 0.05 && t < 0.36,
  };
}

/** Two cards per folded public seat, bounded to a readable dealer-side pile. */
export function muckCardCount(foldedSeatCount: number): number {
  return Math.max(0, Math.min(12, Math.floor(foldedSeatCount) * 2));
}

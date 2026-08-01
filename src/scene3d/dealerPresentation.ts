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
  const arc = Math.sin(Math.PI * t) * 0.11;
  return {
    position: [
      TABLE_ANCHORS.dealerShoe[0] + (target[0] - TABLE_ANCHORS.dealerShoe[0]) * t,
      TABLE_ANCHORS.dealerShoe[1] + (target[1] - TABLE_ANCHORS.dealerShoe[1]) * t + arc,
      TABLE_ANCHORS.dealerShoe[2] + (target[2] - TABLE_ANCHORS.dealerShoe[2]) * t,
    ],
    // A card is face-down for its pitch and makes a positive face-up turn only
    // once it reaches the board; reduced motion passes t=1 and gets this end.
    rotationX: t >= 1 ? 0 : t < 0.68 ? Math.PI : Math.PI * (1 - (t - 0.68) / 0.32),
    visible: t < 1,
  };
}

/** Two cards per folded public seat, bounded to a readable dealer-side pile. */
export function muckCardCount(foldedSeatCount: number): number {
  return Math.max(0, Math.min(12, Math.floor(foldedSeatCount) * 2));
}

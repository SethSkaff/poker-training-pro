import type { Card, Rank, Suit } from "../types/poker";

export const SUITS: readonly Suit[] = [
  "clubs",
  "diamonds",
  "hearts",
  "spades",
] as const;

export const RANKS: readonly Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
] as const;

export type RandomSource = () => number;
export type DeckSeed = string | number;

export interface DrawResult {
  cards: Card[];
  cursor: number;
}

export interface RoundRobinDealResult extends DrawResult {
  hands: Record<string, Card[]>;
}

/**
 * Stable non-cryptographic string hashing used only to seed the local,
 * deterministic simulation. A server-backed game should supply committed
 * cryptographic seeds rather than treating this generator as security.
 */
export function hashSeed(seed: DeckSeed): number {
  const input = String(seed);
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** Mulberry32: compact, reproducible, and adequate for deterministic tests. */
export function createSeededRandom(seed: DeckSeed): RandomSource {
  let state = hashSeed(seed);

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function deriveSeed(base: DeckSeed, ...parts: Array<string | number>): string {
  return [String(base), ...parts.map(String)].join(":");
}

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function cardKey(card: Card): string {
  return `${card.rank}:${card.suit}`;
}

export function assertUniqueCards(cards: readonly Card[]): void {
  const keys = new Set(cards.map(cardKey));
  if (keys.size !== cards.length) {
    throw new Error("Duplicate card detected");
  }
}

export function shuffleDeck(
  cards: readonly Card[],
  seedOrRandom: DeckSeed | RandomSource,
): Card[] {
  assertUniqueCards(cards);
  const shuffled = cards.map((card) => ({ ...card }));
  const random =
    typeof seedOrRandom === "function"
      ? seedOrRandom
      : createSeededRandom(seedOrRandom);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

export function createShuffledDeck(seed: DeckSeed): Card[] {
  return shuffleDeck(createDeck(), seed);
}

export function drawCards(
  deck: readonly Card[],
  cursor: number,
  count: number,
): DrawResult {
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new Error("Deck cursor must be a non-negative integer");
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("Draw count must be a non-negative integer");
  }
  if (cursor + count > deck.length) {
    throw new Error("Cannot draw beyond the end of the deck");
  }

  return {
    cards: deck.slice(cursor, cursor + count).map((card) => ({ ...card })),
    cursor: cursor + count,
  };
}

/**
 * Deals one card at a time in the supplied clockwise seat order. For Hold'em,
 * pass the first eligible seat left of the button first and cardsPerHand = 2.
 */
export function dealRoundRobin(
  deck: readonly Card[],
  cursor: number,
  playerOrder: readonly string[],
  cardsPerHand: number,
): RoundRobinDealResult {
  if (new Set(playerOrder).size !== playerOrder.length) {
    throw new Error("Deal order may not contain duplicate players");
  }
  if (!Number.isInteger(cardsPerHand) || cardsPerHand < 0) {
    throw new Error("Cards per hand must be a non-negative integer");
  }

  const draw = drawCards(
    deck,
    cursor,
    playerOrder.length * cardsPerHand,
  );
  const hands = Object.fromEntries(
    playerOrder.map((playerId) => [playerId, [] as Card[]]),
  );

  let cardIndex = 0;
  for (let round = 0; round < cardsPerHand; round += 1) {
    for (const playerId of playerOrder) {
      hands[playerId].push(draw.cards[cardIndex]);
      cardIndex += 1;
    }
  }

  return { ...draw, hands };
}

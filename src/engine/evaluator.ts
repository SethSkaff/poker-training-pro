import type { Card, Rank } from "../types/poker";
import { assertUniqueCards } from "./deck";

export const HAND_CATEGORY = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export type HandCategory =
  (typeof HAND_CATEGORY)[keyof typeof HAND_CATEGORY];

export interface HandValue {
  category: HandCategory;
  categoryName:
    | "high-card"
    | "one-pair"
    | "two-pair"
    | "three-of-a-kind"
    | "straight"
    | "flush"
    | "full-house"
    | "four-of-a-kind"
    | "straight-flush";
  displayName: string;
  tiebreak: number[];
  cards: Card[];
}

export interface EvaluatedPlayerHand {
  playerId: string;
  value: HandValue;
}

const RANK_VALUE: Readonly<Record<Rank, number>> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const CATEGORY_NAMES: Record<HandCategory, HandValue["categoryName"]> = {
  [HAND_CATEGORY.HIGH_CARD]: "high-card",
  [HAND_CATEGORY.ONE_PAIR]: "one-pair",
  [HAND_CATEGORY.TWO_PAIR]: "two-pair",
  [HAND_CATEGORY.THREE_OF_A_KIND]: "three-of-a-kind",
  [HAND_CATEGORY.STRAIGHT]: "straight",
  [HAND_CATEGORY.FLUSH]: "flush",
  [HAND_CATEGORY.FULL_HOUSE]: "full-house",
  [HAND_CATEGORY.FOUR_OF_A_KIND]: "four-of-a-kind",
  [HAND_CATEGORY.STRAIGHT_FLUSH]: "straight-flush",
};

const DISPLAY_NAMES: Record<HandCategory, string> = {
  [HAND_CATEGORY.HIGH_CARD]: "High Card",
  [HAND_CATEGORY.ONE_PAIR]: "One Pair",
  [HAND_CATEGORY.TWO_PAIR]: "Two Pair",
  [HAND_CATEGORY.THREE_OF_A_KIND]: "Three of a Kind",
  [HAND_CATEGORY.STRAIGHT]: "Straight",
  [HAND_CATEGORY.FLUSH]: "Flush",
  [HAND_CATEGORY.FULL_HOUSE]: "Full House",
  [HAND_CATEGORY.FOUR_OF_A_KIND]: "Four of a Kind",
  [HAND_CATEGORY.STRAIGHT_FLUSH]: "Straight Flush",
};

function rankValue(card: Card): number {
  return RANK_VALUE[card.rank];
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function straightHigh(values: readonly number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);

  for (let index = 0; index <= unique.length - 5; index += 1) {
    const start = unique[index];
    if (
      unique[index + 1] === start - 1 &&
      unique[index + 2] === start - 2 &&
      unique[index + 3] === start - 3 &&
      unique[index + 4] === start - 4
    ) {
      return start;
    }
  }

  return null;
}

function makeValue(
  category: HandCategory,
  tiebreak: number[],
  cards: readonly Card[],
): HandValue {
  const royal =
    category === HAND_CATEGORY.STRAIGHT_FLUSH && tiebreak[0] === 14;

  return {
    category,
    categoryName: CATEGORY_NAMES[category],
    displayName: royal ? "Royal Flush" : DISPLAY_NAMES[category],
    tiebreak,
    cards: cards.map((card) => ({ ...card })),
  };
}

export function evaluateFive(cards: readonly Card[]): HandValue {
  if (cards.length !== 5) {
    throw new Error("evaluateFive requires exactly five cards");
  }
  assertUniqueCards(cards);

  const values = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const highStraight = straightHigh(values);

  if (flush && highStraight !== null) {
    return makeValue(HAND_CATEGORY.STRAIGHT_FLUSH, [highStraight], cards);
  }

  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort(
    ([leftRank, leftCount], [rightRank, rightCount]) =>
      rightCount - leftCount || rightRank - leftRank,
  );

  if (groups[0][1] === 4) {
    return makeValue(
      HAND_CATEGORY.FOUR_OF_A_KIND,
      [groups[0][0], groups[1][0]],
      cards,
    );
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return makeValue(
      HAND_CATEGORY.FULL_HOUSE,
      [groups[0][0], groups[1][0]],
      cards,
    );
  }

  if (flush) {
    return makeValue(HAND_CATEGORY.FLUSH, values, cards);
  }

  if (highStraight !== null) {
    return makeValue(HAND_CATEGORY.STRAIGHT, [highStraight], cards);
  }

  if (groups[0][1] === 3) {
    const kickers = groups
      .slice(1)
      .map(([rank]) => rank)
      .sort((a, b) => b - a);
    return makeValue(
      HAND_CATEGORY.THREE_OF_A_KIND,
      [groups[0][0], ...kickers],
      cards,
    );
  }

  const pairs = groups
    .filter(([, count]) => count === 2)
    .map(([rank]) => rank)
    .sort((a, b) => b - a);

  if (pairs.length === 2) {
    const kicker = groups.find(([, count]) => count === 1)?.[0] ?? 0;
    return makeValue(
      HAND_CATEGORY.TWO_PAIR,
      [pairs[0], pairs[1], kicker],
      cards,
    );
  }

  if (pairs.length === 1) {
    const kickers = groups
      .filter(([, count]) => count === 1)
      .map(([rank]) => rank)
      .sort((a, b) => b - a);
    return makeValue(
      HAND_CATEGORY.ONE_PAIR,
      [pairs[0], ...kickers],
      cards,
    );
  }

  return makeValue(HAND_CATEGORY.HIGH_CARD, values, cards);
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  const output: T[][] = [];

  function visit(start: number, selected: T[]): void {
    if (selected.length === size) {
      output.push([...selected]);
      return;
    }

    for (
      let index = start;
      index <= items.length - (size - selected.length);
      index += 1
    ) {
      selected.push(items[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  }

  visit(0, []);
  return output;
}

export function compareHandValues(left: HandValue, right: HandValue): number {
  if (left.category !== right.category) {
    return Math.sign(left.category - right.category);
  }
  return compareNumberArrays(left.tiebreak, right.tiebreak);
}

export function evaluateBestHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error("A poker hand evaluator requires five to seven cards");
  }
  assertUniqueCards(cards);

  let best: HandValue | null = null;
  for (const candidate of combinations(cards, 5)) {
    const value = evaluateFive(candidate);
    if (best === null || compareHandValues(value, best) > 0) {
      best = value;
    }
  }

  if (best === null) throw new Error("Unable to evaluate hand");
  return best;
}

export function compareHands(
  leftCards: readonly Card[],
  rightCards: readonly Card[],
): number {
  return compareHandValues(
    evaluateBestHand(leftCards),
    evaluateBestHand(rightCards),
  );
}

export function determineWinners(
  playerCards: Readonly<Record<string, readonly Card[]>>,
): EvaluatedPlayerHand[] {
  const evaluated = Object.entries(playerCards).map(([playerId, cards]) => ({
    playerId,
    value: evaluateBestHand(cards),
  }));
  if (evaluated.length === 0) return [];

  const best = evaluated.reduce((winner, candidate) =>
    compareHandValues(candidate.value, winner.value) > 0 ? candidate : winner,
  );

  return evaluated.filter(
    (candidate) => compareHandValues(candidate.value, best.value) === 0,
  );
}


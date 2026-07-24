import type { Card, Rank, Suit } from "../types/poker";
import {
  formatChipCount,
  formatFixedDecimal,
  formatDuration,
  formatNumber,
  formatPercentage,
  formatRatio,
  type NumericLocaleResource,
} from "./localeNumbers";
export {
  formatDateTime,
  type DateTimeLocaleResource,
} from "./localeDateTime";

const suitGlyphs: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const spokenRanks: Record<Rank, string> = {
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  T: "Ten",
  J: "Jack",
  Q: "Queen",
  K: "King",
  A: "Ace",
};

export function formatChips(
  value: number,
  locale?: NumericLocaleResource,
) {
  return formatChipCount(value, locale);
}

export function formatClock(
  milliseconds: number,
  locale?: NumericLocaleResource,
) {
  return formatDuration(milliseconds, locale);
}

export {
  formatFixedDecimal,
  formatNumber,
  formatPercentage,
  formatRatio,
  type NumericLocaleResource,
};

export function cardLabel(card: Card) {
  return `${card.rank}${suitGlyphs[card.suit]}`;
}

export function cardAriaLabel(card: Card) {
  const suit = card.suit.slice(0, -1);
  return `${spokenRanks[card.rank]} of ${suit}s`;
}

import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../types/poker";
import {
  HAND_CATEGORY,
  compareHands,
  determineWinners,
  evaluateBestHand,
  evaluateFive,
} from "./evaluator";

const suits: Record<string, Suit> = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
};

function cards(...values: string[]): Card[] {
  return values.map((value) => ({
    rank: value[0] as Rank,
    suit: suits[value[1]],
  }));
}

describe("hand evaluator", () => {
  it.each([
    [HAND_CATEGORY.STRAIGHT_FLUSH, cards("Ah", "Kh", "Qh", "Jh", "Th")],
    [HAND_CATEGORY.FOUR_OF_A_KIND, cards("As", "Ah", "Ad", "Ac", "Kh")],
    [HAND_CATEGORY.FULL_HOUSE, cards("As", "Ah", "Ad", "Kc", "Kh")],
    [HAND_CATEGORY.FLUSH, cards("Ah", "Jh", "8h", "4h", "2h")],
    [HAND_CATEGORY.STRAIGHT, cards("9h", "8c", "7s", "6d", "5h")],
    [HAND_CATEGORY.THREE_OF_A_KIND, cards("9h", "9c", "9s", "6d", "5h")],
    [HAND_CATEGORY.TWO_PAIR, cards("9h", "9c", "6s", "6d", "5h")],
    [HAND_CATEGORY.ONE_PAIR, cards("9h", "9c", "7s", "6d", "5h")],
    [HAND_CATEGORY.HIGH_CARD, cards("Ah", "Jc", "8s", "6d", "3h")],
  ])("identifies category %s", (category, hand) => {
    expect(evaluateFive(hand).category).toBe(category);
  });

  it("treats the ace as low only for the wheel", () => {
    const wheel = evaluateFive(cards("Ah", "2c", "3s", "4d", "5h"));
    const sixHigh = evaluateFive(cards("2h", "3c", "4s", "5d", "6h"));

    expect(wheel.category).toBe(HAND_CATEGORY.STRAIGHT);
    expect(wheel.tiebreak).toEqual([5]);
    expect(compareHands(wheel.cards, sixHigh.cards)).toBe(-1);
  });

  it("chooses the strongest five cards from seven", () => {
    const best = evaluateBestHand(
      cards("As", "Ah", "Ad", "Ks", "Kh", "Kd", "2c"),
    );
    expect(best.category).toBe(HAND_CATEGORY.FULL_HOUSE);
    expect(best.tiebreak).toEqual([14, 13]);
  });

  it("uses all kickers and never uses suits to break a tie", () => {
    expect(
      compareHands(
        cards("As", "Ah", "Kd", "Qc", "9s"),
        cards("Ad", "Ac", "Kc", "Jc", "Ts"),
      ),
    ).toBe(1);
    expect(
      compareHands(
        cards("As", "Kd", "Qc", "Jh", "9s"),
        cards("Ah", "Ks", "Qd", "Jc", "9h"),
      ),
    ).toBe(0);
  });

  it("returns every tied winner when the board plays", () => {
    const board = cards("Ah", "Kh", "Qh", "Jh", "Th");
    const winners = determineWinners({
      alice: [...board, ...cards("2c", "3d")],
      bob: [...board, ...cards("9s", "9d")],
    });
    expect(winners.map((winner) => winner.playerId).sort()).toEqual([
      "alice",
      "bob",
    ]);
  });
});


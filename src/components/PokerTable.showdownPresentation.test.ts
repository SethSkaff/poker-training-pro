import { describe, expect, it } from "vitest";
import { evaluateFive } from "../engine/evaluator";
import { cardLabel } from "../lib/format";
import type { Card, Rank, SeatPlayer, Suit } from "../types/poker";
import {
  describeLiveSidePot,
  publicRevealsForPresentation,
  winningCardLabelsForAwards,
} from "./PokerTable";

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

describe("showdown best-five presentation", () => {
  it.each([
    ["pair", cards("As", "Ah", "Kd", "Qc", "9s")],
    ["two pair", cards("As", "Ah", "Kd", "Kc", "9s")],
    ["trips", cards("As", "Ah", "Ad", "Kc", "9s")],
    ["straight", cards("9h", "8c", "7s", "6d", "5h")],
    ["flush", cards("Ah", "Jh", "8h", "4h", "2h")],
    ["full house", cards("As", "Ah", "Ad", "Kc", "Kh")],
    ["quads", cards("As", "Ah", "Ad", "Ac", "Kh")],
    ["straight flush", cards("Ah", "Kh", "Qh", "Jh", "Th")],
  ] as const)("uses the exact %s best five from the engine award", (_name, handCards) => {
    const hand = evaluateFive(handCards);

    expect(
      winningCardLabelsForAwards([{ hand }]),
    ).toEqual(new Set(hand.cards.map(cardLabel)));
  });

  it("preserves separate side-pot winner hands and board-playing split hands", () => {
    const boardPlaying = evaluateFive(cards("Ah", "Kh", "Qh", "Jh", "Th"));
    const sidePotWinner = evaluateFive(cards("9s", "9h", "9d", "9c", "2h"));
    const labels = winningCardLabelsForAwards([
      { hand: boardPlaying },
      { hand: sidePotWinner },
      {},
    ]);

    expect(labels).toEqual(
      new Set([...boardPlaying.cards, ...sidePotWinner.cards].map(cardLabel)),
    );
  });
});

describe("live side-pot explanation", () => {
  const players: SeatPlayer[] = [
    { id: "short", name: "Avery", seat: 0, stack: 0, status: "all-in", bet: 0, totalCommitted: 600 },
    { id: "deep-1", name: "Blake", seat: 1, stack: 900, status: "active", bet: 0, totalCommitted: 1200 },
    { id: "deep-2", name: "Casey", seat: 2, stack: 900, status: "active", bet: 0, totalCommitted: 1200 },
  ];

  it("explains the public all-in cap and the side-pot contenders", () => {
    expect(
      describeLiveSidePot(
        {
          id: "side-1",
          kind: "side",
          amount: 1200,
          eligiblePlayerIds: ["deep-1", "deep-2"],
        },
        players,
      ),
    ).toBe(
      "Avery is all-in for 600. Chips committed above that cap form this side pot; only Blake, Casey can win it.",
    );
  });

  it("never needs a private card to explain a side pot", () => {
    const explanation = describeLiveSidePot(
      { id: "side-1", kind: "side", amount: 1200, eligiblePlayerIds: ["deep-1", "deep-2"] },
      players,
    );
    expect(explanation).not.toMatch(/rank|suit|hand|pair|flush/i);
  });
});

describe("all-in reveal presentation", () => {
  const reveal = {
    id: "all-in-reveal",
    kind: "all-in-reveal" as const,
    handId: "hand-7",
    playerIds: ["hero", "opponent"],
    reveals: [
      { playerId: "hero", cards: cards("As", "Kd") },
      { playerId: "opponent", cards: cards("Qh", "Qs") },
    ],
  };
  const boardCard = {
    id: "board-1",
    kind: "board-card-dealt" as const,
    handId: "hand-7",
    street: "flop" as const,
    cardIndex: 0,
    card: cards("2c")[0],
  };

  it("keeps a legal all-in reveal visible while later board events play", () => {
    expect(publicRevealsForPresentation(boardCard, reveal)).toEqual(reveal.reveals);
  });

  it("does not reveal cards from an ordinary board event without a legal reveal", () => {
    expect(publicRevealsForPresentation(boardCard, undefined)).toEqual([]);
  });
});

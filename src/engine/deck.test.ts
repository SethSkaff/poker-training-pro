import { describe, expect, it } from "vitest";
import {
  assertUniqueCards,
  cardKey,
  createDeck,
  createShuffledDeck,
  dealRoundRobin,
  drawCards,
} from "./deck";

describe("deck", () => {
  it("creates exactly one of every card in a 52-card deck", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardKey))).toHaveLength(52);
    expect(() => assertUniqueCards(deck)).not.toThrow();
  });

  it("shuffles reproducibly from a seed", () => {
    const first = createShuffledDeck("tournament:42:hand:7");
    const replay = createShuffledDeck("tournament:42:hand:7");
    const different = createShuffledDeck("tournament:42:hand:8");

    expect(replay).toEqual(first);
    expect(different).not.toEqual(first);
    expect(new Set(first.map(cardKey))).toHaveLength(52);
  });

  it("deals one card per player per pass", () => {
    const deal = dealRoundRobin(createDeck(), 0, ["a", "b", "c"], 2);

    expect(deal.cursor).toBe(6);
    expect(deal.hands.a.map(cardKey)).toEqual(["2:clubs", "5:clubs"]);
    expect(deal.hands.b.map(cardKey)).toEqual(["3:clubs", "6:clubs"]);
    expect(deal.hands.c.map(cardKey)).toEqual(["4:clubs", "7:clubs"]);
  });

  it("rejects duplicate decks and drawing beyond the stub", () => {
    const deck = createDeck();
    expect(() => assertUniqueCards([deck[0], deck[0]])).toThrow(
      /Duplicate card/,
    );
    expect(() => drawCards(deck, 51, 2)).toThrow(/beyond/);
  });
});


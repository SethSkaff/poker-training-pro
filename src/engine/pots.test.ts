import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../types/poker";
import { buildPots, resolvePots } from "./pots";

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

describe("pot construction and resolution", () => {
  it("constructs nested main and side pots from contribution caps", () => {
    const result = buildPots([
      { playerId: "a", amount: 100 },
      { playerId: "b", amount: 250 },
      { playerId: "c", amount: 400 },
      { playerId: "d", amount: 400 },
    ]);

    expect(result.pots.map((pot) => pot.amount)).toEqual([400, 450, 300]);
    expect(result.pots.map((pot) => pot.eligiblePlayerIds)).toEqual([
      ["a", "b", "c", "d"],
      ["b", "c", "d"],
      ["c", "d"],
    ]);
    expect(result.refunds).toEqual([]);
  });

  it("counts folded chips in the pot but removes the folder from eligibility", () => {
    const result = buildPots([
      { playerId: "folder", amount: 200, folded: true },
      { playerId: "winner", amount: 200 },
    ]);
    expect(result.pots[0]).toMatchObject({
      amount: 400,
      contributorIds: ["folder", "winner"],
      eligiblePlayerIds: ["winner"],
    });
  });

  it("returns an unmatched contribution instead of creating a one-player pot", () => {
    const result = buildPots([
      { playerId: "a", amount: 100 },
      { playerId: "b", amount: 300 },
    ]);
    expect(result.pots).toHaveLength(1);
    expect(result.pots[0].amount).toBe(200);
    expect(result.refunds).toEqual([{ playerId: "b", amount: 200 }]);
    expect(
      result.pots.reduce((sum, pot) => sum + pot.amount, 0) +
        result.refunds.reduce((sum, refund) => sum + refund.amount, 0),
    ).toBe(result.totalContributed);
  });

  it("awards each side pot independently", () => {
    const pots = buildPots([
      { playerId: "a", amount: 100 },
      { playerId: "b", amount: 200 },
      { playerId: "c", amount: 200 },
    ]).pots;
    const result = resolvePots(pots, {
      board: cards("2h", "3d", "7c", "9s", "Kh"),
      holeCards: {
        a: cards("Ks", "Kc"),
        b: cards("As", "Ad"),
        c: cards("Qs", "Qd"),
      },
      seats: { a: 1, b: 2, c: 3 },
      buttonSeat: 3,
      tableSize: 9,
    });

    expect(result.awards).toEqual([
      expect.objectContaining({ potId: "main", playerId: "a", amount: 300 }),
      expect.objectContaining({ potId: "side-1", playerId: "b", amount: 200 }),
    ]);
  });

  it("gives an odd chip to the first tied winner left of the button", () => {
    const result = resolvePots(
      [
        {
          id: "main",
          kind: "main",
          amount: 101,
          cap: 0,
          contributorIds: ["a", "b", "c"],
          eligiblePlayerIds: ["a", "b", "c"],
        },
      ],
      {
        board: cards("Ah", "Kh", "Qh", "Jh", "Th"),
        holeCards: {
          a: cards("2c", "3d"),
          b: cards("4c", "5d"),
          c: cards("6c", "7d"),
        },
        seats: { a: 1, b: 2, c: 3 },
        buttonSeat: 1,
        tableSize: 9,
      },
    );

    expect(
      Object.fromEntries(
        result.awards.map((award) => [award.playerId, award.amount]),
      ),
    ).toEqual({ a: 33, b: 34, c: 34 });
  });
});


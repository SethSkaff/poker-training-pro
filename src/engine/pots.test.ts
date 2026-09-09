import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../types/poker";
import { buildLivePots, buildPots, resolvePots } from "./pots";

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
      { playerId: "a", amount: 100, allIn: true },
      { playerId: "b", amount: 250, allIn: true },
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

  it("keeps unequal non-all-in commitments in one ordinary pot", () => {
    const result = buildPots([
      { playerId: "a", amount: 100 },
      { playerId: "b", amount: 250 },
      { playerId: "c", amount: 400 },
    ]);
    expect(result.pots).toHaveLength(1);
    expect(result.pots[0]).toMatchObject({ id: "main", kind: "main", amount: 600 });
    expect(result.refunds).toEqual([{ playerId: "c", amount: 150 }]);
  });

  it("does not make a side pot from a folded contribution cap", () => {
    const result = buildPots([
      { playerId: "folder", amount: 100, folded: true },
      { playerId: "b", amount: 200 },
      { playerId: "c", amount: 200 },
    ]);
    expect(result.pots).toHaveLength(1);
    expect(result.pots[0]).toMatchObject({ amount: 500, kind: "main" });
    expect(result.pots[0]?.eligiblePlayerIds).toEqual(["b", "c"]);
  });

  it("keeps the blind-only opening total at 75 while the BB excess is pending return", () => {
    const result = buildLivePots([
      { playerId: "sb", amount: 25 },
      { playerId: "bb", amount: 50 },
    ]);
    expect(result.pots).toMatchObject([{ id: "main", kind: "main", amount: 75 }]);
    expect(result.refunds).toEqual([{ playerId: "bb", amount: 25 }]);
  });

  it("awards each side pot independently", () => {
    const pots = buildPots([
      { playerId: "a", amount: 100, allIn: true },
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

  /*
    The settlement-side detector for the Stage 15 crash.

    A 15,376 heads-up pot is what two 7,688 commitments produce, and 7,688 is
    what a caller gets by sizing a raise as a fraction of the legal range on a
    25-chip table. `applyBettingAction` now refuses that target, so this pot is
    unreachable from a real hand -- but the check stays, because it is the only
    place that can catch a rack violation arriving from some other direction
    (an imported hand history, a future structure with a mid-event colour-up).
  */
  const denominationSettlement = {
    board: cards("2h", "3d", "7c", "9s", "Kh"),
    holeCards: {
      hero: cards("As", "Ad"),
      villain: cards("Qs", "Qd"),
    },
    seats: { hero: 1, villain: 2 },
    buttonSeat: 2,
    tableSize: 6,
    smallestChip: 25,
  } as const;

  it("refuses to settle a pot no 25-chip stack could pay out", () => {
    const pots = buildPots([
      { playerId: "hero", amount: 7_688 },
      { playerId: "villain", amount: 7_688 },
    ]).pots;
    expect(pots[0].amount).toBe(15_376);
    expect(() => resolvePots(pots, denominationSettlement)).toThrow(
      /cannot be divided by the chip denomination/,
    );
  });

  it("settles the same spot once both commitments are on the rack", () => {
    const pots = buildPots([
      { playerId: "hero", amount: 7_700 },
      { playerId: "villain", amount: 7_700 },
    ]).pots;
    expect(pots[0].amount).toBe(15_400);
    expect(resolvePots(pots, denominationSettlement).awards).toEqual([
      expect.objectContaining({ playerId: "hero", amount: 15_400 }),
    ]);
  });

  it("allocates the odd chip in whole denominations on a three-way tie", () => {
    // 15,400 / 3 is 5,133.33; the rack can only make 5,125 each, leaving one
    // 25-chip remainder for the first tied winner left of the button.
    const result = resolvePots(
      [
        {
          id: "main",
          kind: "main",
          amount: 15_400,
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
        smallestChip: 25,
      },
    );

    const awards = Object.fromEntries(
      result.awards.map((award) => [award.playerId, award.amount]),
    );
    expect(awards).toEqual({ a: 5_125, b: 5_150, c: 5_125 });
    expect(Object.values(awards).reduce((sum, value) => sum + value, 0)).toBe(
      15_400,
    );
    for (const amount of Object.values(awards)) {
      expect(amount % 25).toBe(0);
    }
  });
});

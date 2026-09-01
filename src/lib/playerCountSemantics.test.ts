import { describe, expect, it } from "vitest";
import {
  assertPlayerCountSemantics,
  derivePlayerCountSemantics,
  opponentsAbleToRespond,
} from "./playerCountSemantics";

describe("player-count semantics", () => {
  it("keeps tournament survivors separate from a heads-up current hand", () => {
    const counts = derivePlayerCountSemantics(
      [
        { id: "hero", status: "active" },
        { id: "villain", status: "active" },
        { id: "folded-seat-1", status: "folded" },
        { id: "folded-seat-2", status: "folded" },
        { id: "folded-seat-3", status: "folded" },
        { id: "folded-seat-4", status: "folded" },
      ],
      "hero",
      6,
    );

    expect(counts).toEqual({
      tournamentPlayersRemaining: 6,
      playersDealtIn: 6,
      activePlayersInHand: 2,
      activeOpponents: 1,
    });
    expect(() => assertPlayerCountSemantics(counts)).not.toThrow();
  });

  it("changes only tournament pressure when the global survivor count changes", () => {
    const hand = [
      { id: "hero", status: "active" },
      { id: "villain", status: "active" },
    ];
    const sixLeft = derivePlayerCountSemantics(hand, "hero", 6);
    const twoLeft = derivePlayerCountSemantics(hand, "hero", 2);

    expect(sixLeft.tournamentPlayersRemaining).toBe(6);
    expect(twoLeft.tournamentPlayersRemaining).toBe(2);
    expect(sixLeft.playersDealtIn).toBe(twoLeft.playersDealtIn);
    expect(sixLeft.activePlayersInHand).toBe(twoLeft.activePlayersInHand);
    expect(sixLeft.activeOpponents).toBe(twoLeft.activeOpponents);
  });

  it("limits immediate response pressure to active opponents facing a new target", () => {
    const responders = opponentsAbleToRespond(
      [
        { id: "hero", status: "active", stack: 900, streetCommitted: 0 },
        { id: "villain", status: "active", stack: 900, streetCommitted: 100 },
        { id: "folded", status: "folded", stack: 900, streetCommitted: 100 },
        { id: "all-in", status: "all-in", stack: 0, streetCommitted: 900 },
        { id: "already-covered", status: "active", stack: 900, streetCommitted: 500 },
      ],
      "hero",
      300,
    );

    expect(responders.map((player) => player.id)).toEqual(["villain"]);
  });
});

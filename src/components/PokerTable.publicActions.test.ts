import { describe, expect, it } from "vitest";
import {
  presentationEventLabel,
  publicActionLabel,
  seatPresentationUpdate,
} from "./PokerTable";

const handId = "hand-public-actions";

describe("public tournament action presentation", () => {
  it.each([
    ["fold", "Folds"],
    ["check", "Checks"],
    ["call", "Calls"],
    ["bet", "Bets"],
    ["raise", "Raises"],
    ["all-in", "All in"],
  ] as const)("gives %s a distinct public action label", (action, label) => {
    expect(publicActionLabel(action)).toBe(label);
    expect(
      seatPresentationUpdate(
        {
          id: `action-${action}`,
          kind: "action",
          handId,
          playerId: "opponent",
          command: { type: action },
        },
        "opponent",
      ),
    ).toEqual({ action, label });
  });

  it("projects forced posts, awards, and eliminations onto only their public seat", () => {
    const blinds = {
      id: "blinds",
      kind: "blinds-posted" as const,
      handId,
      posts: [
        { playerId: "small", type: "small-blind" as const, amount: 50 },
        { playerId: "big", type: "big-blind" as const, amount: 100 },
        { playerId: "ante", type: "big-blind-ante" as const, amount: 25 },
      ],
    };
    expect(seatPresentationUpdate(blinds, "small")).toEqual({
      action: "bet",
      label: "Posts small blind 50",
    });
    expect(seatPresentationUpdate(blinds, "big")).toEqual({
      action: "bet",
      label: "Posts big blind 100",
    });
    expect(seatPresentationUpdate(blinds, "ante")).toEqual({
      action: "bet",
      label: "Posts big blind ante 25",
    });
    expect(seatPresentationUpdate(blinds, "uninvolved")).toEqual({});

    expect(
      seatPresentationUpdate(
        {
          id: "award",
          kind: "pot-awarded",
          handId,
          playerId: "winner",
          amount: 475,
        },
        "winner",
      ),
    ).toEqual({ label: "Wins 475", wonPot: true });
    expect(
      seatPresentationUpdate(
        { id: "out", kind: "eliminated", handId, playerId: "loser" },
        "loser",
      ),
    ).toEqual({ label: "Eliminated", eliminated: true });
  });

  it("announces public actions without deriving or disclosing opponent cards", () => {
    const event = {
      id: "award",
      kind: "pot-awarded" as const,
      handId,
      playerId: "opponent",
      amount: 600,
    };
    const announcement = presentationEventLabel(event);
    expect(announcement).toBe("Pot awarded: 600");
    expect(announcement).not.toMatch(/card|hole|ace|king|spade|heart/i);
  });
});

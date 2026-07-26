import { describe, expect, it } from "vitest";
import { seatGestureForPublicState } from "./PokerTable";

const active = {
  status: "active" as const,
  bet: 0,
  showingFaceDownCards: true,
  hasPublicReveal: false,
};

describe("public character gesture selection", () => {
  it("gives active opponents a visible hold/peek gesture", () => {
    expect(seatGestureForPublicState(active)).toBe("hold");
  });

  it("prioritizes public actions over the resting hold pose", () => {
    expect(seatGestureForPublicState({ ...active, recentAction: "check" })).toBe("check");
    expect(seatGestureForPublicState({ ...active, recentAction: "fold" })).toBe("fold");
    expect(seatGestureForPublicState({ ...active, recentAction: "all-in" })).toBe("all-in");
  });

  it("does not depend on hidden cards or policy information", () => {
    const publicState = { ...active, bet: 400 };
    expect(seatGestureForPublicState(publicState)).toBe("bet");
    expect(seatGestureForPublicState({ ...publicState })).toBe("bet");
  });
});

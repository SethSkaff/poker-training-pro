import { describe, expect, it } from "vitest";
import { boardDealPose, deckColourForHand, inactiveDeckColour, muckCardCount } from "./dealerPresentation";
import { TABLE_ANCHORS } from "./tableStations";

describe("dealer public deck presentation", () => {
  it("alternates a visible red/blue pack deterministically by public hand identity", () => {
    const values = Array.from({ length: 20 }, (_, index) => deckColourForHand(`hand-${index}`));
    expect(new Set(values)).toEqual(new Set(["red", "blue"]));
    expect(inactiveDeckColour("hand-4")).not.toBe(deckColourForHand("hand-4"));
    expect(deckColourForHand("hand-4")).toBe(deckColourForHand("hand-4"));
  });

  it("holds one pack colour for every event in a hand and changes only at the next hand", () => {
    const activeHand = "tournament:hand-41";
    const eventsInHand = ["hole-cards-dealt", "flop", "turn", "river", "showdown"];
    expect(eventsInHand.map(() => deckColourForHand(activeHand))).toEqual([
      "red", "red", "red", "red", "red",
    ]);
    expect(deckColourForHand("tournament:hand-42")).toBe("blue");
    expect(inactiveDeckColour(activeHand)).toBe("blue");
  });

  it("pitches each board card from the dealer shoe and ends it face-up on its board slot", () => {
    const start = boardDealPose(0, 0);
    const end = boardDealPose(2, 1);
    expect(start.position).toEqual(TABLE_ANCHORS.dealerShoe);
    expect(start.rotationX).toBe(Math.PI);
    expect(end.position[0]).toBe(TABLE_ANCHORS.board[0]);
    expect(end.position[2]).toBe(TABLE_ANCHORS.board[2]);
    expect(end.rotationX).toBe(0);
  });

  it("keeps folded cards in a bounded dealer-side muck instead of deleting them", () => {
    expect(muckCardCount(0)).toBe(0);
    expect(muckCardCount(3)).toBe(6);
    expect(muckCardCount(99)).toBe(12);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEALER_PHASE_SEQUENCE,
  dealerCardFrame,
  dealerPhaseIndex,
} from "./dealerChoreography";

describe("dealer-owned card choreography", () => {
  it("uses the required ordered phases for hole cards and community cards", () => {
    expect(DEALER_PHASE_SEQUENCE["hole-card"]).toEqual([
      "rest", "reach", "grasp", "lift", "transport", "place", "release", "return", "settle",
    ]);
    expect(DEALER_PHASE_SEQUENCE["board-card"]).toEqual([
      "rest", "reach", "grasp", "lift", "transport", "place", "reveal", "release", "return", "settle",
    ]);
    expect(dealerPhaseIndex("board-card", "reveal")).toBeGreaterThan(
      dealerPhaseIndex("board-card", "place"),
    );
  });

  it("keeps airborne cards nearly parallel and face-up only during an intentional board reveal", () => {
    for (const kind of ["hole-card", "burn-card", "board-card"] as const) {
      for (let step = 0; step <= 100; step += 1) {
        const frame = dealerCardFrame(kind, step / 100);
        if (frame.phase === "transport" || frame.phase === "lift") {
          expect(Math.abs(frame.pitchRadians)).toBeLessThanOrEqual(0.12);
          expect(Math.abs(frame.rollRadians)).toBeLessThanOrEqual(0.10);
        }
        if (frame.faceUp) expect(kind).toBe("board-card");
        expect(frame.quaternion.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("does not expose a destination card before release", () => {
    for (const kind of ["hole-card", "burn-card", "board-card"] as const) {
      for (let step = 0; step < 100; step += 1) {
        const frame = dealerCardFrame(kind, step / 100);
        if (frame.phase === "rest" || frame.phase === "reach" || frame.phase === "grasp") {
          expect(frame.visible).toBe(false);
        }
      }
    }
  });
});

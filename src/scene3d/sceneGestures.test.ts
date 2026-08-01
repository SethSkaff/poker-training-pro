import { describe, expect, it } from "vitest";
import { sceneGestureFor } from "./sceneGestures";

describe("scene gesture grammar", () => {
  it("keeps each public action physically distinct without card or policy input", () => {
    const deal = sceneGestureFor("deal", 0.5, false, false);
    const check = sceneGestureFor("check", 0.5, false, false);
    const call = sceneGestureFor("call", 0.5, false, false);
    const bet = sceneGestureFor("bet", 0.5, false, false);
    const raise = sceneGestureFor("raise", 0.5, false, false);
    const allIn = sceneGestureFor("all-in", 0.5, false, false);
    const fold = sceneGestureFor("fold", 0.5, false, false);

    expect(deal.cardMotion).toBe("deal");
    expect(fold.cardMotion).toBe("muck");
    expect(check.chipMotion).toBe("none");
    expect(call.chipMotion).toBe("call");
    expect(bet.chipMotion).toBe("bet");
    expect(raise.chipMotion).toBe("raise");
    expect(allIn.chipMotion).toBe("all-in");
    expect(raise.armReach).toBeGreaterThan(bet.armReach);
    expect(allIn.armReach).toBeGreaterThan(raise.armReach);
  });

  it("settles every transient gesture at the same terminal presentation state", () => {
    for (const action of ["deal", "check", "call", "bet", "raise", "all-in", "collect", "win"] as const) {
      const gesture = sceneGestureFor(action, 1, false, false);
      expect(gesture.armReach).toBeCloseTo(0, 8);
      expect(gesture.bodyLean).toBeCloseTo(0, 8);
    }
  });

  it("drives articulated shoulders, elbows, and a distinct table tap", () => {
    const rest = sceneGestureFor(undefined, 0, false, false);
    const tap = sceneGestureFor("check", 0.25, false, false);
    const wager = sceneGestureFor("raise", 0.5, false, false);
    const fold = sceneGestureFor("fold", 0.5, false, false);

    expect(tap.handTap).toBeGreaterThan(0);
    expect(tap.shoulderPitch).not.toBe(rest.shoulderPitch);
    expect(wager.elbowBend).toBeGreaterThan(tap.elbowBend);
    expect(wager.shoulderPitch).toBeGreaterThan(tap.shoulderPitch);
    expect(fold.cardMotion).toBe("muck");
    expect(fold.elbowBend).toBeGreaterThan(0);
  });

  it("preserves the stable acting and folded terminal treatments", () => {
    expect(sceneGestureFor(undefined, 0, true, false).bodyLean).toBe(0.06);
    expect(sceneGestureFor(undefined, 0, false, true)).toMatchObject({
      bodyLean: -0.04,
      cardMotion: "muck",
    });
    // Folded cards muck independently in `applySeat`, but committed public
    // chips must still travel during the later collection event.
    expect(sceneGestureFor("collect", 0, false, true)).toMatchObject({
      cardMotion: "rest",
      chipMotion: "collect",
    });
  });
});

import { describe, expect, it } from "vitest";
import { createSceneActionTimingState, reconcileSceneActionTiming, type TimedSceneSeat } from "./sceneActionTiming";
import type { SceneTransition } from "./sceneTransition";

const hero: TimedSceneSeat = { id: "hero", seat: 0, folded: false, action: "bet" };
const transition = (id: string, action: SceneTransition["action"] = "bet"): SceneTransition => ({
  id,
  kind: "action",
  playerIds: ["hero"],
  action,
  progress: 0,
  foldedPlayerIds: [],
});

describe("scene action timing", () => {
  it("consumes each event id once while restarting repeated public actions", () => {
    const timing = createSceneActionTimingState();
    reconcileSceneActionTiming(timing, [], [hero], transition("call:1"), 100, 620);
    reconcileSceneActionTiming(timing, [hero], [hero], transition("call:1"), 200, 620);
    expect(timing.startedAt.get(0)).toBe(100);

    reconcileSceneActionTiming(timing, [hero], [hero], transition("call:2"), 300, 620);
    expect(timing.startedAt.get(0)).toBe(300);
  });

  it("starts only the public recipients of a multi-seat transition", () => {
    const timing = createSceneActionTimingState();
    const idleHero: TimedSceneSeat = { id: "hero", seat: 0, folded: false };
    const villain: TimedSceneSeat = { id: "villain", seat: 1, folded: false, action: "deal" };
    reconcileSceneActionTiming(timing, [], [idleHero, villain], {
      id: "deal:1", kind: "hole-cards-dealt", playerIds: ["villain"], action: "deal", progress: 0, foldedPlayerIds: [],
    }, 100, 620);
    expect(timing.startedAt.get(0)).toBeUndefined();
    expect(timing.startedAt.get(1)).toBe(100);
  });

  it("commits a skipped fold at its terminal state without replaying it later", () => {
    const timing = createSceneActionTimingState();
    const folding: TimedSceneSeat = { id: "hero", seat: 0, folded: false, action: "fold" };
    const folded: TimedSceneSeat = { id: "hero", seat: 0, folded: true };
    reconcileSceneActionTiming(timing, [], [folding], transition("fold:1", "fold"), 100, 620);
    reconcileSceneActionTiming(timing, [folding], [folded], undefined, 200, 620);
    expect(timing.startedAt.get(0)).toBe(-420);

    reconcileSceneActionTiming(timing, [folded], [folded], undefined, 300, 620);
    expect(timing.startedAt.get(0)).toBe(-420);
  });
});

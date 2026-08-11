import { describe, expect, it } from "vitest";
import { animationBeatFor } from "./sceneAnimationBeats";
import type { SceneTransition } from "./sceneTransition";

const transition = (action: SceneTransition["action"], progress: number): SceneTransition => ({
  id: `event:${action}`,
  kind: action === "collect" ? "bets-collected" : "action",
  playerIds: ["p1"],
  action,
  progress,
  foldedPlayerIds: action === "fold" ? ["p1"] : [],
});

describe("presentation-event animation beats", () => {
  it("keys ownership to the public event and never animates another seat", () => {
    expect(animationBeatFor(transition("raise", 0.5), "p1")).toMatchObject({
      eventId: "event:raise", owner: "p1", source: "rack", destination: "wager", phase: "transfer",
    });
    expect(animationBeatFor(transition("raise", 0.5), "p2")).toBeUndefined();
  });

  it("holds chips in the rack through reach/grasp, then transfers and settles", () => {
    expect(animationBeatFor(transition("bet", 0.1), "p1")?.objectProgress).toBe(0);
    expect(animationBeatFor(transition("bet", 0.27), "p1")?.objectProgress).toBe(0);
    expect(animationBeatFor(transition("bet", 0.6), "p1")?.objectProgress).toBeGreaterThan(0.1);
    expect(animationBeatFor(transition("bet", 0.95), "p1")?.objectProgress).toBe(1);
  });

  it("gives check two discrete contacts and fold one continuous card transfer", () => {
    expect(animationBeatFor(transition("check", 0.22), "p1")?.phase).toBe("tap-one");
    expect(animationBeatFor(transition("check", 0.5), "p1")?.phase).toBe("tap-two");
    const foldA = animationBeatFor(transition("fold", 0.3), "p1");
    const foldB = animationBeatFor(transition("fold", 0.7), "p1");
    expect(foldA?.phase).toBe("transfer");
    expect(foldB?.objectProgress).toBeGreaterThan(foldA?.objectProgress ?? 1);
  });

  it("makes the dealer burn before dealing each public card", () => {
    const board = (progress: number): SceneTransition => ({
      id: "board:flop:1", kind: "board-card-dealt", handId: "h1", cardIndex: 0,
      playerIds: [], foldedPlayerIds: [], progress,
    });
    expect(animationBeatFor(board(0.2))?.phase).toBe("burn");
    expect(animationBeatFor(board(0.6))?.phase).toBe("deal");
    expect(animationBeatFor(board(0.95))?.phase).toBe("recover");
  });
});

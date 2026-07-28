import { describe, expect, it } from "vitest";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import { createSceneTransition } from "./sceneTransition";

const call = (id: string): TournamentPresentationEvent => ({
  id, kind: "action", handId: "h1", playerId: "p1", command: { type: "call" },
});

describe("scene transition", () => {
  it("preserves repeated public actions as separate event identities", () => {
    expect(createSceneTransition(call("h1:call:1"), 0.25, false)).toMatchObject({ id: "h1:call:1", playerIds: ["p1"], action: "bet", progress: 0.25 });
    expect(createSceneTransition(call("h1:call:2"), 0.25, false)).toMatchObject({ id: "h1:call:2", action: "bet", progress: 0.25 });
  });

  it("uses the same terminal state for reduced motion, skip, and out-of-range clock samples", () => {
    const event = call("h1:call:1");
    expect(createSceneTransition(event, 0.2, true).progress).toBe(1);
    expect(createSceneTransition(event, 1, false).progress).toBe(1);
    expect(createSceneTransition(event, 4, false).progress).toBe(1);
    expect(createSceneTransition(event, -1, false).progress).toBe(0);
  });

  it("maps only public event vocabulary", () => {
    const deal: TournamentPresentationEvent = { id: "h1:deal", kind: "hole-cards-dealt", handId: "h1", playerIds: ["p1"] };
    const result: TournamentPresentationEvent = { id: "h1:result", kind: "hand-result", handId: "h1", awards: [] };
    expect(createSceneTransition(deal, 0, false).action).toBe("deal");
    expect(createSceneTransition(result, 0, false).action).toBeUndefined();
  });

  it("maps every public action command without exposing a private action detail", () => {
    const cases = [
      ["check", "check"],
      ["call", "bet"],
      ["bet", "bet"],
      ["raise", "bet"],
      ["all-in", "all-in"],
      ["fold", "fold"],
    ] as const;
    for (const [commandType, action] of cases) {
      const event: TournamentPresentationEvent = {
        id: `h1:${commandType}`,
        kind: "action",
        handId: "h1",
        playerId: "hero",
        command: { type: commandType },
      };
      expect(createSceneTransition(event, 0, false)).toMatchObject({
        id: `h1:${commandType}`,
        action,
        playerIds: ["hero"],
      });
    }
  });

  it("keeps every non-seat presentation event inert in the scene", () => {
    const passiveEvents: readonly TournamentPresentationEvent[] = [
      { id: "button", kind: "button-moved", handId: "h1", buttonSeat: 0 },
      { id: "board", kind: "board-card-dealt", handId: "h1", street: "flop", cardIndex: 0, card: { rank: "A", suit: "spades" } },
      { id: "collect", kind: "bets-collected", handId: "h1", amount: 10 },
      { id: "showdown", kind: "showdown", handId: "h1", playerIds: [], reveals: [], awards: [] },
      { id: "reveal", kind: "all-in-reveal", handId: "h1", playerIds: [], reveals: [] },
      { id: "result", kind: "hand-result", handId: "h1", awards: [] },
      { id: "side-pot", kind: "side-pot-formed", handId: "h1", potId: "p1", amount: 10, eligiblePlayerIds: [] },
      { id: "award", kind: "pot-awarded", handId: "h1", playerId: "hero", amount: 10 },
      { id: "eliminated", kind: "eliminated", handId: "h1", playerId: "hero" },
    ];
    for (const event of passiveEvents) {
      expect(createSceneTransition(event, 0.4, false)).toMatchObject({
        id: event.id,
        action: undefined,
        playerIds: [],
        foldedPlayerIds: [],
        progress: 0.4,
      });
    }
  });

  it("names every public deal and blind recipient", () => {
    const deal: TournamentPresentationEvent = { id: "h1:deal", kind: "hole-cards-dealt", handId: "h1", playerIds: ["hero", "villain"] };
    const blinds: TournamentPresentationEvent = { id: "h1:blinds", kind: "blinds-posted", handId: "h1", posts: [{ playerId: "hero", type: "small-blind", amount: 5 }, { playerId: "villain", type: "big-blind", amount: 10 }] };
    expect(createSceneTransition(deal, 0, false)).toMatchObject({ action: "deal", playerIds: ["hero", "villain"] });
    expect(createSceneTransition(blinds, 0, false)).toMatchObject({ action: "bet", playerIds: ["hero", "villain"] });
  });

  it("provides only the folding player's terminal public state", () => {
    const fold: TournamentPresentationEvent = { id: "h1:fold", kind: "action", handId: "h1", playerId: "hero", command: { type: "fold" } };
    expect(createSceneTransition(fold, 0.5, false).foldedPlayerIds).toEqual(["hero"]);
  });
});

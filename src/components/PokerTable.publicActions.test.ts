import { describe, expect, it } from "vitest";
import {
  isTrainingActionLegal,
  presentationEventLabel,
  publicActionLabel,
  publicPresentationSound,
  seatPresentationUpdate,
} from "./PokerTable";
import { trainingScenarios } from "../data/trainingScenarios";

const handId = "hand-public-actions";

describe("public tournament action presentation", () => {
  it("keeps Training Lab moves available independently of EV coverage", () => {
    const scenario = trainingScenarios.find(
      (item) => item.id === "turn-spr-commitment",
    );

    expect(scenario).toBeDefined();
    expect(scenario?.training.actionEvs.fold).toBeUndefined();
    expect(isTrainingActionLegal(scenario!, "fold")).toBe(true);
    expect(isTrainingActionLegal(scenario!, "check")).toBe(true);
    expect(isTrainingActionLegal(scenario!, "raise")).toBe(true);
    expect(isTrainingActionLegal(scenario!, "all-in")).toBe(true);
  });

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
    ).toEqual({ sceneAction: "win", label: "Wins 475", wonPot: true });
    expect(
      seatPresentationUpdate(
        { id: "out", kind: "eliminated", handId, playerId: "loser" },
        "loser",
      ),
    ).toEqual({ label: "Eliminated", eliminated: true });
  });

  /*
    The deal was published for years and mapped by nobody, so the renderer's
    dealing animation was code nothing could reach and every hand began with the
    cards already on the felt. Nothing failed while it was missing, which is why
    it needs a test rather than a fix.
  */
  it("tells the scene a hand was dealt, to the players who were dealt in", () => {
    const dealt = {
      id: "deal",
      kind: "hole-cards-dealt" as const,
      handId,
      playerIds: ["hero", "villain"],
    };
    expect(seatPresentationUpdate(dealt, "hero")).toEqual({
      sceneAction: "deal",
      label: "Dealt in",
    });
    expect(seatPresentationUpdate(dealt, "railbird")).toEqual({});
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

  it("labels a fold-ended hand result without implying a showdown", () => {
    expect(
      presentationEventLabel({
        id: "fold-result",
        kind: "hand-result",
        handId,
        awards: [{ potId: "main", playerId: "winner", amount: 600 }],
      }),
    ).toBe("Hand result");
  });

  it("selects audio only from public presentation events", () => {
    expect(publicPresentationSound({
      id: "deal",
      kind: "hole-cards-dealt",
      handId,
      playerIds: ["hero", "opponent"],
    })).toBe("deal");
    expect(publicPresentationSound({
      id: "all-in-reveal",
      kind: "all-in-reveal",
      handId,
      playerIds: ["hero", "opponent"],
      reveals: [],
    })).toBe("deal");
    expect(publicPresentationSound({
      id: "blinds",
      kind: "blinds-posted",
      handId,
      posts: [{ playerId: "hero", type: "small-blind", amount: 50 }],
    })).toBe("chip");
    expect(publicPresentationSound({
      id: "collect",
      kind: "bets-collected",
      handId,
      amount: 300,
      collections: [{ playerId: "hero", amount: 300 }],
    })).toBe("chip");
    expect(publicPresentationSound({
      id: "flop",
      kind: "board-card-dealt",
      handId,
      street: "flop",
      cardIndex: 0,
      card: { rank: "A", suit: "spades" },
    })).toBe("deal");
    expect(publicPresentationSound({
      id: "all-in",
      kind: "action",
      handId,
      playerId: "opponent",
      command: { type: "all-in" },
    })).toBe("all-in");
    expect(publicPresentationSound({
      id: "fold",
      kind: "action",
      handId,
      playerId: "opponent",
      command: { type: "fold" },
    })).toBe("fold");
    expect(publicPresentationSound({
      id: "raise",
      kind: "action",
      handId,
      playerId: "opponent",
      command: { type: "raise", to: 400 },
    })).toBe("chip");
    expect(publicPresentationSound({
      id: "award",
      kind: "pot-awarded",
      handId,
      playerId: "winner",
      amount: 600,
    })).toBe("win");
    expect(publicPresentationSound({
      id: "out",
      kind: "eliminated",
      handId,
      playerId: "opponent",
    })).toBe("eliminated");
    expect(publicPresentationSound({
      id: "showdown",
      kind: "showdown",
      handId,
      playerIds: ["hero", "opponent"],
      reveals: [
        { playerId: "hero", cards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "spades" }] },
      ],
      awards: [],
    })).toBeUndefined();
  });

  it("does not let different showdown hole cards select an audio cue", () => {
    const publicShowdown = (cards: readonly [{ rank: "A" | "2"; suit: "spades" | "hearts" }, { rank: "A" | "2"; suit: "spades" | "hearts" }]) => ({
      id: "showdown",
      kind: "showdown" as const,
      handId,
      playerIds: ["hero", "opponent"],
      reveals: [{ playerId: "opponent", cards }],
      awards: [],
    });

    expect(publicPresentationSound(publicShowdown([
      { rank: "A", suit: "spades" },
      { rank: "A", suit: "hearts" },
    ]))).toBeUndefined();
    expect(publicPresentationSound(publicShowdown([
      { rank: "2", suit: "spades" },
      { rank: "2", suit: "hearts" },
    ]))).toBeUndefined();
  });
});

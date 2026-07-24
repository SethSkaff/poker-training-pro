import { describe, expect, it } from "vitest";
import {
  applyBettingAction,
  createBettingRound,
  getLegalActions,
  nextToAct,
  type BettingPlayerState,
  type BettingRoundState,
} from "./betting";

function player(
  id: string,
  stack = 5_000,
  streetCommitted = 0,
  status: BettingPlayerState["status"] = "active",
): BettingPlayerState {
  return {
    id,
    stack,
    streetCommitted,
    totalCommitted: streetCommitted,
    status,
  };
}

function act(
  state: BettingRoundState,
  playerId: string,
  type: Parameters<typeof applyBettingAction>[2]["type"],
  to?: number,
): BettingRoundState {
  return applyBettingAction(state, playerId, { type, to }).state;
}

describe("betting round", () => {
  it("gives the big blind an option after a limped pre-flop round", () => {
    let state = createBettingRound(
      [
        player("utg"),
        player("button"),
        player("sb", 4_950, 50),
        player("bb", 4_900, 100),
      ],
      ["utg", "button", "sb", "bb"],
      { minimumBet: 100, nominalOpeningBet: 100 },
    );

    state = act(state, "utg", "call");
    state = act(state, "button", "call");
    state = act(state, "sb", "call");
    expect(nextToAct(state)).toBe("bb");
    expect(getLegalActions(state, "bb").check).toBe(true);
    state = act(state, "bb", "check");
    expect(state.complete).toBe(true);
  });

  it("preserves the scheduled opening wager when the big blind is short", () => {
    const state = createBettingRound(
      [
        player("utg", 1_000),
        player("sb", 900, 100),
        player("bb", 0, 50, "all-in"),
      ],
      ["utg", "sb", "bb"],
      { minimumBet: 200, nominalOpeningBet: 200 },
    );
    const legal = getLegalActions(state, "utg");

    expect(state.currentBet).toBe(200);
    expect(legal.callAmount).toBe(200);
    expect(legal.raise?.minTo).toBe(400);
  });

  it("tracks minimum raises by the previous full raise increment", () => {
    let state = createBettingRound(
      [player("a"), player("b"), player("c")],
      ["a", "b", "c"],
      { minimumBet: 100 },
    );
    state = act(state, "a", "bet", 100);
    expect(getLegalActions(state, "b").raise?.minTo).toBe(200);
    state = act(state, "b", "raise", 250);
    expect(state.lastFullRaise).toBe(150);
    expect(getLegalActions(state, "c").raise?.minTo).toBe(400);
  });

  it("does not reopen a prior actor after one short all-in raise", () => {
    let state = createBettingRound(
      [
        player("a"),
        player("b"),
        player("c"),
        player("d", 1_300),
      ],
      ["a", "b", "c", "d"],
      { minimumBet: 500 },
    );
    state = act(state, "a", "bet", 500);
    state = act(state, "b", "raise", 1_000);
    state = act(state, "c", "call");
    state = act(state, "d", "all-in");
    state = act(state, "a", "fold");

    const legal = getLegalActions(state, "b");
    expect(legal.toCall).toBe(300);
    expect(legal.raisingReopened).toBe(false);
    expect(legal.raise).toBeUndefined();
    expect(legal.allIn).toBe(false);
  });

  it("reopens betting after cumulative short all-ins reach a full raise", () => {
    let state = createBettingRound(
      [
        player("a"),
        player("b"),
        player("c"),
        player("d", 1_300),
        player("e", 1_700),
      ],
      ["a", "b", "c", "d", "e"],
      { minimumBet: 500 },
    );
    state = act(state, "a", "bet", 500);
    state = act(state, "b", "raise", 1_000);
    state = act(state, "c", "call");
    state = act(state, "d", "all-in");
    state = act(state, "e", "all-in");
    state = act(state, "a", "fold");

    const legal = getLegalActions(state, "b");
    expect(legal.toCall).toBe(700);
    expect(legal.raisingReopened).toBe(true);
    expect(legal.raise?.minTo).toBe(2_200);
  });

  it("ends the hand immediately when every opponent folds", () => {
    let state = createBettingRound(
      [player("a"), player("b"), player("c")],
      ["a", "b", "c"],
      { minimumBet: 100 },
    );
    state = act(state, "a", "bet", 100);
    state = act(state, "b", "fold");
    state = act(state, "c", "fold");
    expect(state.complete).toBe(true);
    expect(state.handComplete).toBe(true);
  });
});


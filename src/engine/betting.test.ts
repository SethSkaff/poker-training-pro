import { describe, expect, it } from "vitest";
import {
  applyBettingAction,
  createBettingRound,
  getLegalActions,
  isStackOffCommand,
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
  it("recognizes stack-offs regardless of command spelling", () => {
    const legal = {
      playerId: "hero",
      toCall: 150,
      check: false,
      fold: true,
      call: true,
      callAmount: 150,
      raise: { minTo: 300, maxTo: 1_000 },
      allIn: true,
      allInTo: 1_000,
      raisingReopened: true,
      chipStep: 1,
    };
    expect(isStackOffCommand({ type: "all-in" }, legal)).toBe(true);
    expect(isStackOffCommand({ type: "raise", to: 1_000 }, legal)).toBe(true);
    expect(isStackOffCommand({ type: "raise", to: 500 }, legal)).toBe(false);
    expect(isStackOffCommand({ type: "call" }, legal, 850)).toBe(true);
  });

  it("allows a legal open shove when action first reaches the player", () => {
    const state = createBettingRound(
      [player("hero", 950), player("bb", 950, 50)],
      ["hero", "bb"],
      { minimumBet: 50, nominalOpeningBet: 50 },
    );
    const legal = getLegalActions(state, "hero");
    expect(legal.allIn).toBe(true);
    expect(legal.allInTo).toBe(950);
    const result = applyBettingAction(state, "hero", { type: "all-in" });
    expect(result.event).toMatchObject({ type: "all-in", allIn: true });
    expect(result.state.players.find((player) => player.id === "hero")).toMatchObject({
      stack: 0,
      totalCommitted: 950,
      status: "all-in",
    });
  });

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

/*
  Reproduces the Stage 15 exploitability crash geometry exactly.

  At the local-qualifier's 25-chip rack a scripted opponent sized a raise as a
  fraction of the advertised range and named 7,688. `getLegalActions` had
  offered the range as a continuous integer interval, so the engine took it;
  the opponent then made an exact call for the same amount, and settlement, 55
  hands later, held a 15,376 main pot that no stack of 25-chip units can pay
  out. The pot code detected that, but by then the illegal amount had been in
  game state for the whole hand. The rack rule belongs here, where the amount
  is chosen.
*/
describe("chip-denomination legality", () => {
  function raiseSpot(
    smallestChip: number | undefined,
    heroStack = 6_250,
  ): BettingRoundState {
    return createBettingRound(
      [
        player("villain", 46_275, 5_000),
        player("hero", heroStack, 2_500),
      ],
      ["hero", "villain"],
      {
        minimumBet: 2_500,
        currentBet: 5_000,
        lastFullRaise: 2_500,
        smallestChip,
      },
    );
  }

  it("advertises the rack increment alongside the raise range", () => {
    const legal = getLegalActions(raiseSpot(25), "hero");
    expect(legal.chipStep).toBe(25);
    expect(legal.raise).toEqual({ minTo: 7_500, maxTo: 8_750 });
  });

  it("refuses the raise target that produced the 15,376 pot", () => {
    expect(() => act(raiseSpot(25), "hero", "raise", 7_688)).toThrow(
      /not payable in 25-chip units/,
    );
  });

  it("accepts the neighbouring targets that the rack can actually make", () => {
    for (const target of [7_500, 7_700, 8_725, 8_750]) {
      const state = act(raiseSpot(25), "hero", "raise", target);
      expect(
        state.players.find((entry) => entry.id === "hero")?.totalCommitted,
      ).toBe(target);
    }
  });

  it("exempts the state-derived edges, which are not the caller's number", () => {
    // A stack that is itself off the rack can still be pushed in exactly: the
    // all-in is the amount the state dictates, not an amount anyone chose.
    const state = raiseSpot(25, 6_260);
    expect(getLegalActions(state, "hero").raise).toEqual({
      minTo: 7_500,
      maxTo: 8_760,
    });
    expect(
      act(state, "hero", "raise", 8_760).players.find(
        (entry) => entry.id === "hero",
      )?.status,
    ).toBe("all-in");
    expect(
      act(state, "hero", "all-in").players.find((entry) => entry.id === "hero")
        ?.totalCommitted,
    ).toBe(8_760);
    expect(() => act(state, "hero", "raise", 8_755)).toThrow(
      /not payable in 25-chip units/,
    );
  });

  it("imposes no rack rule on a structure that does not model one", () => {
    const state = act(raiseSpot(undefined), "hero", "raise", 7_688);
    expect(getLegalActions(state, "villain").chipStep).toBe(1);
    expect(
      state.players.find((entry) => entry.id === "hero")?.totalCommitted,
    ).toBe(7_688);
  });

  it("keeps an opening bet on the rack too", () => {
    const state = createBettingRound(
      [player("hero", 10_000), player("villain", 10_000)],
      ["hero", "villain"],
      { minimumBet: 500, smallestChip: 25 },
    );
    expect(getLegalActions(state, "hero").bet).toEqual({ min: 500, max: 10_000 });
    expect(() => act(state, "hero", "bet", 1_469)).toThrow(
      /not payable in 25-chip units/,
    );
    expect(
      act(state, "hero", "bet", 1_475).players.find(
        (entry) => entry.id === "hero",
      )?.totalCommitted,
    ).toBe(1_475);
  });

  it("rejects a chip denomination that is not a positive integer", () => {
    expect(() =>
      createBettingRound([player("a"), player("b")], ["a", "b"], {
        minimumBet: 100,
        smallestChip: 0,
      }),
    ).toThrow(/Smallest chip must be positive/);
    expect(() =>
      createBettingRound([player("a"), player("b")], ["a", "b"], {
        minimumBet: 100,
        smallestChip: 12.5,
      }),
    ).toThrow(/Smallest chip/);
  });
});

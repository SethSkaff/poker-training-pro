import { describe, expect, it } from "vitest";
import { applyBettingAction, createBettingRound, getLegalActions } from "../engine/betting";
import { canonicalizeBettingAction, computeWagerGeometry } from "./pokerActionSemantics";

function player(id: string, stack = 5_000, streetCommitted = 0, status: "active" | "all-in" | "folded" = "active") {
  return { id, stack, streetCommitted, totalCommitted: streetCommitted, status };
}

describe("A02 canonical poker action semantics", () => {
  it("treats a call and an explicit all-in call as the same semantic transition", () => {
    const callState = createBettingRound([player("hero", 100, 0), player("villain", 0, 100, "all-in")], ["hero", "villain"], { minimumBet: 100, currentBet: 100 });
    const call = canonicalizeBettingAction(callState, { type: "call" });
    const allIn = canonicalizeBettingAction(callState, { type: "all-in" });
    expect(call.kind).toBe("call");
    expect(allIn.kind).toBe("call");
    expect(call.stackOffClass).toBe("all_in_call");
    expect(allIn.stackOffClass).toBe("all_in_call");
    expect(allIn.key).toBe(call.key);
  });

  it("keeps a max-target raise as an aggressive jam and computes pre-action geometry", () => {
    const state = createBettingRound([player("hero", 900, 100), player("villain", 900, 100)], ["hero", "villain"], { minimumBet: 100, currentBet: 100 });
    const action = canonicalizeBettingAction(state, { type: "raise", to: 1_000 });
    const geometry = computeWagerGeometry({ preState: state, canonicalAction: action, bigBlindChips: 100 });
    expect(action.kind).toBe("raise");
    expect(action.stackOffClass).toBe("aggressive_jam");
    expect(geometry.potAtDecisionChips).toBe(200);
    expect(geometry.investmentOverCurrentPot.value).toBe(4.5);
    expect(geometry.actualSettlementRefundChips.value).toBeNull();
  });

  it("uses the engine reopening semantics for cumulative short increases", () => {
    let state = createBettingRound([
      player("a"), player("b"), player("c"), player("d", 1_300), player("e", 1_700),
    ], ["a", "b", "c", "d", "e"], { minimumBet: 500 });
    state = applyBettingAction(state, "a", { type: "bet", to: 500 }).state;
    state = applyBettingAction(state, "b", { type: "raise", to: 1_000 }).state;
    state = applyBettingAction(state, "c", { type: "call" }).state;
    state = applyBettingAction(state, "d", { type: "all-in" }).state;
    const action = canonicalizeBettingAction(state, { type: "all-in" });
    expect(action.isShortAllInIncrease).toBe(true);
    expect(action.newlyReopenedPlayerIds).toContain("b");
    const afterFold = applyBettingAction(action.result.state, "a", { type: "fold" }).state;
    expect(getLegalActions(afterFold, "b").raisingReopened).toBe(true);
  });
});

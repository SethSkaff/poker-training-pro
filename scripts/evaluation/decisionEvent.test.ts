import { describe, expect, it } from "vitest";
import { createBettingRound } from "../../src/engine/betting";
import { captureDecisionBefore, completeDecisionEvent } from "./decisionEvent";
import { canonicalizeBettingAction, computeWagerGeometry } from "../../src/lib/pokerActionSemantics";
import { stratifyDecision } from "./stratification";

function frame() {
  const state = createBettingRound([
    { id: "hero", stack: 900, streetCommitted: 100, totalCommitted: 100, status: "active" },
    { id: "villain", stack: 900, streetCommitted: 100, totalCommitted: 100, status: "active" },
  ], ["hero", "villain"], { minimumBet: 100, currentBet: 100 });
  const actorView = {
    handId: "hand",
    viewerId: "hero",
    street: "flop" as const,
    board: [],
    pot: 200,
    currentBet: 100,
    actingPlayerId: "hero",
    buttonSeat: 0,
    players: [
      { id: "hero", name: "Hero", seat: 0, stack: 900, status: "active" as const, streetCommitted: 100, totalCommitted: 100, holeCards: [] },
      { id: "villain", name: "Villain", seat: 1, stack: 900, status: "active" as const, streetCommitted: 100, totalCommitted: 100 },
    ],
    actions: [],
  };
  const legal = { playerId: "hero", toCall: 0, check: true, fold: true, call: false, callAmount: 0, bet: { min: 100, max: 1_000 }, allIn: true, allInTo: 1_000, raisingReopened: true, chipStep: 1 };
  const action = canonicalizeBettingAction(state, { type: "check" });
  const geometry = computeWagerGeometry({ preState: state, canonicalAction: action, bigBlindChips: 100 });
  return captureDecisionBefore({
    decisionId: "decision-1",
    reproduction: {} as never,
    policy: {} as never,
    preState: state,
    actorView,
    legal,
    strata: stratifyDecision({ informationSet: actorView, geometry, tournamentPlayersRemaining: 2 }),
  });
}

describe("A02 sealed decision events", () => {
  it("captures pre-action state and completes a reconciled event", () => {
    const pending = frame();
    const event = completeDecisionEvent({ frame: pending, command: { type: "check" } });
    expect(event.execution).toBe("observed");
    expect(event.postcondition.status).toBe("pass");
    expect(event.preState.currentBet).toBe(100);
    expect(event.chosen.kind).toBe("check");
  });
});

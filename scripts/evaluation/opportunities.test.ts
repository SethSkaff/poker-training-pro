import { describe, expect, it } from "vitest";
import { emitHandOpportunities, reduceOpportunities } from "./opportunities";
import type { CanonicalAction } from "../../src/lib/pokerActionSemantics";

function action(kind: CanonicalAction["kind"], allIn = false): CanonicalAction {
  return { key: `${kind}-${allIn}`, kind, rawCommand: { type: kind === "bet" ? "bet" : kind }, targetChips: 100, investedChips: 100, raisesCurrentBet: kind === "bet" || kind === "raise", raiseByChips: kind === "bet" || kind === "raise" ? 100 : 0, isActorAllIn: allIn, stackOffClass: kind === "call" && allIn ? "all_in_call" : kind === "bet" || kind === "raise" ? "aggressive_jam" : "none", isFullRaise: kind === "bet" || kind === "raise", isShortAllInIncrease: false, newlyReopenedPlayerIds: [], playerId: "hero", preActionLegal: {} as never, result: {} as never };
}

describe("A03 opportunity denominators", () => {
  it("counts VPIP/PFR once per player-hand despite repeated calls and a raise", () => {
    const rows = emitHandOpportunities({ blockId: "b", sessionId: "s", handId: "h", actors: [{ actorId: "hero", dealtIn: true, preflopActions: [action("call"), action("call"), action("raise")] }] });
    const report = reduceOpportunities([...rows, ...rows]);
    expect(report.duplicateCount).toBe(rows.length);
    expect(report.vpip).toBe(1);
    expect(report.pfr).toBe(1);
  });

  it("keeps a no-opportunity denominator null and an all-in call out of raises", () => {
    const rows = emitHandOpportunities({ blockId: "b", sessionId: "s", handId: "h", actors: [{ actorId: "hero", dealtIn: true, preflopActions: [action("call", true)] }] });
    const report = reduceOpportunities(rows);
    expect(report.pfr).toBe(0);
    expect(report.byKind.three_bet.rate).toBeNull();
    expect(report.byKind.four_bet.rate).toBeNull();
  });
});

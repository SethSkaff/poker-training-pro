import { describe, expect, it } from "vitest";
import { createBettingRound } from "../../src/engine/betting";
import { generateWagerReferenceMenu } from "./wagerCandidates";
import { buildWagerReferenceReport, renderWagerReferenceReport } from "./wagerReport";

describe("A09 wager report", () => {
  it("keeps the offline/reference and live-adoption boundaries visible", () => {
    const preState = createBettingRound([
      { id: "hero", stack: 1003, streetCommitted: 0, totalCommitted: 0, status: "active" },
      { id: "villain", stack: 1003, streetCommitted: 0, totalCommitted: 0, status: "active" },
    ], ["hero", "villain"], { minimumBet: 100 });
    const legal = { playerId: "hero", toCall: 0, check: true, fold: true, call: false, callAmount: 0, bet: { min: 100, max: 1003 }, allIn: true, allInTo: 1003, raisingReopened: true, chipStep: 1 } as const;
    const report = buildWagerReferenceReport(generateWagerReferenceMenu({ preState, legal, abstractTargets: [333], smallestChip: 25 }));
    expect(report.offlineOnly).toBe(true);
    expect(report.liveAdoption).toBe("not_implemented");
    expect(renderWagerReferenceReport(report)).toContain("not implemented");
  });
});

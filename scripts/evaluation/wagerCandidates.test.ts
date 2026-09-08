import { describe, expect, it } from "vitest";
import { createBettingRound } from "../../src/engine/betting";
import { generateWagerReferenceMenu } from "./wagerCandidates";
import { buildWagerReferenceReport } from "./wagerReport";

function unopened() {
  const preState = createBettingRound([
    { id: "hero", stack: 1_003, streetCommitted: 0, totalCommitted: 0, status: "active" },
    { id: "villain", stack: 1_003, streetCommitted: 0, totalCommitted: 0, status: "active" },
  ], ["hero", "villain"], { minimumBet: 100 });
  return { preState, legal: { playerId: "hero", toCall: 0, check: true, fold: true, call: false, callAmount: 0, bet: { min: 100, max: 1_003 }, allIn: true, allInTo: 1_003, raisingReopened: true } as const };
}

describe("offline wager reference menu", () => {
  it("adds rack floor/ceil proposals while preserving exact all-in and boundaries", () => {
    const { preState, legal } = unopened();
    const menu = generateWagerReferenceMenu({
      preState,
      legal,
      abstractTargets: [333],
      smallestChip: 25,
      productionCommands: [{ type: "bet", to: 325 }],
      playedCommand: { type: "all-in" },
    });
    expect(menu.expandedTargets).toContain(325);
    expect(menu.expandedTargets).toContain(350);
    expect(menu.expandedTargets).toContain(1_003);
    const allIn = menu.candidates.find((candidate) => candidate.command.type === "all-in");
    expect(allIn?.canonical?.targetChips).toBe(1_003);
    expect(allIn?.exactStateDerived).toBe(true);
    expect(allIn?.origins).toContain("played");
    expect(menu.candidates.some((candidate) => candidate.origins.includes("rack_floor"))).toBe(true);
    expect(menu.candidates.some((candidate) => candidate.origins.includes("rack_ceil"))).toBe(true);
  });

  it("keeps state-derived calls and minimums exact, and reports invalid proposals", () => {
    const preState = createBettingRound([
      { id: "hero", stack: 1_003, streetCommitted: 0, totalCommitted: 0, status: "active" },
      { id: "villain", stack: 1_003, streetCommitted: 100, totalCommitted: 100, status: "active" },
    ], ["hero", "villain"], { minimumBet: 100, currentBet: 100 });
    const legal = {
      playerId: "hero", toCall: 100, check: false, fold: true, call: true, callAmount: 100,
      raise: { minTo: 200, maxTo: 1_003 }, allIn: true, allInTo: 1_003, raisingReopened: true,
    } as const;
    const menu = generateWagerReferenceMenu({
      preState,
      legal,
      abstractTargets: [333],
      smallestChip: 25,
      preferenceProposal: { version: "human-multiples-v1", status: "unvalidated", chipTargets: [77], sourceEvidence: null, evidenceRefs: [] },
    });
    const call = menu.candidates.find((candidate) => candidate.command.type === "call");
    expect(call?.canonical?.targetChips).toBe(100);
    expect(call?.exactStateDerived).toBe(true);
    const minimum = menu.candidates.find((candidate) => candidate.command.type === "raise" && candidate.command.to === 200);
    expect(minimum?.canonical?.targetChips).toBe(200);
    expect(menu.rejectedCandidates.some((candidate) => candidate.candidateId === "human:77")).toBe(true);
    expect(menu.scope.preferenceAuthority).toBe("descriptive_only");
  });

  it("separates legality/rack evidence and never offers a live adoption path", () => {
    const { preState, legal } = unopened();
    const menu = generateWagerReferenceMenu({ preState, legal, abstractTargets: [333], smallestChip: 25 });
    const report = buildWagerReferenceReport(menu, menu.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      status: candidate.exactStateDerived ? "supported" as const : "pending" as const,
      valueChips: null,
      reason: null,
    })));
    expect(report.offlineOnly).toBe(true);
    expect(report.liveAdoption).toBe("not_implemented");
    expect(report.denominationPatterns.ordinaryOffRack).toBe(0);
    expect(report.coverage.pending).toBeGreaterThan(0);
  });
});

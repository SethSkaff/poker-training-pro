import { describe, expect, it } from "vitest";
import { decideNormalAction } from "../../src/modes/normal";
import { buildStyleContracts, exportBlindedStyleBundle, importStyleLabels, type StyleContractObservation } from "./personalities";
import { comparePersonalities, jensenShannonDivergence } from "./personalityReport";

function observation(profileKey: "anchor" | "pressure", index: number): StyleContractObservation {
  const decision = decideNormalAction({
    informationSet: {
      handId: `style-${index}`,
      viewerId: "ai",
      street: "flop",
      board: [{ rank: "A", suit: "clubs" }, { rank: "9", suit: "clubs" }, { rank: "4", suit: "diamonds" }],
      pot: 5400,
      currentBet: 1200,
      actingPlayerId: "ai",
      buttonSeat: 4,
      players: [
        { id: "ai", name: "AI", seat: 0, stack: 18600, status: "active", streetCommitted: 0, totalCommitted: 600, holeCards: [{ rank: "K", suit: "clubs" }, { rank: "Q", suit: "clubs" }] },
        { id: "v", name: "V", seat: 4, stack: 24100, status: "active", streetCommitted: 1200, totalCommitted: 1800 },
      ],
      actions: [{ playerId: "v", type: "raise", amount: 1200 }, { playerId: "ai", type: "pending" }],
    },
    legalActions: { playerId: "ai", toCall: 1200, check: false, fold: true, call: true, callAmount: 1200, raise: { minTo: 3600, maxTo: 18600 }, allIn: true, allInTo: 18600, raisingReopened: true, chipStep: 1 },
    evaluations: [
      { command: { type: "call" }, estimatedEv: 160, purpose: "defense" },
      { command: { type: "raise", to: 3600 }, estimatedEv: 148, purpose: "semi-bluff" },
      { command: { type: "fold" }, estimatedEv: 0, purpose: "neutral" },
    ],
    profile: profileKey,
    bigBlind: 200,
    seed: `style-seed-${index}`,
  });
  return { nodeId: `node-${index}`, familyId: `family-${index}`, sessionId: `session-${index}`, profileKey, decision, context: "defending", potChips: 5400, actorStackChips: 18600, referenceSource: "policy", publicFeatures: { potRatio: 0.5, pressure: 0.2 } };
}

describe("A12 personality report", () => {
  it("keeps profile identity mapping and descriptive targets explicit", () => {
    const bundle = buildStyleContracts({ observations: [observation("anchor", 1)] });
    expect(bundle.target).toEqual({ commonNodesPerProfile: 300, equityReplicas: 8, sessionBlocks: 30 });
    expect(bundle.contracts.find((entry) => entry.profileKey === "wideLens")?.profileId).toBe("wide-lens");
    expect(bundle.missingEvidence).toEqual([]);
  });

  it("compares Normal probabilities separately from unavailable Rational probabilities", () => {
    const rows = [observation("anchor", 1), observation("pressure", 2)];
    const report = comparePersonalities({ observations: rows });
    expect(report.comparisons[0].normalProbabilityByCategory).toBeTruthy();
    expect(report.comparisons[0].rationalProbabilityByCategory).toBeNull();
    expect(report.comparisons[0].missingEvidence).toContain("rational_conditional_distribution");
    expect(report.convergence).toBe("descriptive");
    expect(jensenShannonDivergence({ fold: 1 }, { call: 1 })).toBeGreaterThan(0);
  });

  it("exports blinded features and rejects profile/unknown label leakage", () => {
    const bundle = exportBlindedStyleBundle({ observations: [observation("anchor", 1)] });
    expect(JSON.stringify(bundle)).not.toContain("anchor");
    expect(JSON.stringify(bundle)).not.toContain("profileId");
    expect(() => importStyleLabels(bundle, [{ caseId: "missing", label: "abstain", confidence: "abstain", raterRef: "rater" }])).toThrow(/unknown case/);
  });
});

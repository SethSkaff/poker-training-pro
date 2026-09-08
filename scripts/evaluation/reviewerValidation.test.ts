import { describe, expect, it } from "vitest";
import { createMockReviewerAdapter } from "./criticAdapter";
import { createPilotManifest, initialReviewerQualification, runReviewerPilot, type PilotCase } from "./reviewerPilot";
import { validateReviewerPilot } from "./reviewerValidation";
import { createReviewerInput } from "./criticInput";

function makeCase(index: number): PilotCase {
  return {
    baseCaseId: `validation-case-${index}`,
    familyId: `validation-family-${index}`,
    stratum: index % 2 ? "ordinary" : "defensible_unusual",
    provenance: "pending_review",
    input: createReviewerInput({
      opaqueCaseId: `validation-opaque-${index}`,
      actorId: `actor-${index}`,
      actorCards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "diamonds" }],
      publicPlayers: [{ id: `actor-${index}`, seat: 0 }],
      street: "river",
      board: [{ rank: "2", suit: "clubs" }, { rank: "7", suit: "hearts" }, { rank: "9", suit: "spades" }, { rank: "J", suit: "diamonds" }, { rank: "3", suit: "clubs" }],
      publicActions: [],
      legalActions: [],
      geometry: { potBeforeChips: 100, actualCallChips: 0, targetChips: 0, investedChips: 0, raiseByChips: 0, investmentOverPot: 0, raiseOverPotAfterCall: null, actorStackChips: 100, pairwiseRemainingDepth: 1 },
    }),
  };
}

describe("A11 reviewer validation", () => {
  it("does not manufacture gold labels from mock outputs or majority", async () => {
    const cases = [makeCase(1), makeCase(2)];
    const manifest = createPilotManifest({ cases });
    const adapter = createMockReviewerAdapter();
    const run = await runReviewerPilot(manifest, adapter, { includeTransforms: false });
    const result = validateReviewerPilot({ run, cases, qualification: initialReviewerQualification(adapter) });
    expect(result.status).toBe("promotion_pending");
    expect(result.missingEvidence).toContain("qualified_human_or_exact_gold_labels");
    expect(result.promotionRecordRef).toBeNull();
  });

  it("keeps human/exact labels, abstentions and false positives as separate evidence", async () => {
    const cases = [makeCase(1), makeCase(2)];
    const manifest = createPilotManifest({ cases });
    const adapter = createMockReviewerAdapter();
    const run = await runReviewerPilot(manifest, adapter, { includeTransforms: false });
    const result = validateReviewerPilot({
      run,
      cases,
      goldLabels: [
        { baseCaseId: cases[0].baseCaseId, strategicPlausibility: "plausible", source: "exact_verified", raterRefs: ["exact"] },
        { baseCaseId: cases[1].baseCaseId, strategicPlausibility: "insufficient", source: "expert_adjudicated", raterRefs: ["rater-a", "rater-b"], uncertain: true },
      ],
      acceptancePolicy: { version: "fixture", falseAlarmBudget: "x", highImpactMissPriorities: [], minimumEvidenceCoverage: "x", allowedDomains: ["fixture"], sourceEvidence: "fixture", approvedByHuman: false },
      qualification: initialReviewerQualification(adapter),
    });
    expect(result.abstention.denominator).toBe(1);
    expect(result.raterAgreement.status).toBe("pending");
    expect(result.status).toBe("baseline_establishment_only");
  });
});

import { describe, expect, it } from "vitest";
import { createReviewerInput } from "./criticInput";
import { createMockReviewerAdapter } from "./criticAdapter";
import {
  attemptReviewerPromotion,
  createEightCaseFixture,
  createPilotManifest,
  initialReviewerQualification,
  qualificationFingerprintChanged,
  runReviewerPilot,
  startReviewerPilot,
  transformPilotCase,
  type PilotCase,
} from "./reviewerPilot";
import { recordFixtureOnlyPromotion, validateReviewerPilot } from "./reviewerValidation";

function makeCase(index: number, stratum: PilotCase["stratum"], familyId = `family-${index}`): PilotCase {
  return {
    baseCaseId: `case-${index}`,
    familyId,
    stratum,
    provenance: "pending_review",
    input: createReviewerInput({
      opaqueCaseId: `opaque-${index}`,
      actorId: `actor-${index}`,
      actorCards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "diamonds" }],
      publicPlayers: [{ id: `actor-${index}`, seat: 0 }, { id: `villain-${index}`, seat: 1 }],
      street: "flop",
      board: [{ rank: "2", suit: "clubs" }, { rank: "7", suit: "hearts" }, { rank: "9", suit: "spades" }],
      publicActions: [],
      legalActions: [],
      geometry: { potBeforeChips: 100, actualCallChips: 0, targetChips: 0, investedChips: 0, raiseByChips: 0, investmentOverPot: 0, raiseOverPotAfterCall: null, actorStackChips: 500, pairwiseRemainingDepth: 5 },
    }),
  };
}

const policy = {
  version: "fixture-policy-v1",
  falseAlarmBudget: "fixture",
  highImpactMissPriorities: ["fixture"],
  minimumEvidenceCoverage: "fixture",
  allowedDomains: ["fixture-domain"],
  sourceEvidence: "fixture-only",
  approvedByHuman: false,
};

describe("A11 pilot manifest and qualification state machine", () => {
  it("keeps the four 50-slot strata and forces the protected family to development", () => {
    const cases = [
      makeCase(1, "verified_defect", "wesley-protected"),
      makeCase(2, "defensible_unusual"),
      makeCase(3, "ordinary"),
      makeCase(4, "ambiguous_ood"),
    ];
    const manifest = createPilotManifest({ cases, acceptancePolicy: policy });
    expect(manifest.slotCounts).toEqual({ verified_defect: 50, defensible_unusual: 50, ordinary: 50, ambiguous_ood: 50 });
    expect(manifest.splitByFamily["wesley-protected"]).toBe("development");
    expect(manifest.status).toBe("pending_review");
    expect(manifest.provenanceCounts.pending_review).toBe(4);
  });

  it("runs the eight-case offline fixture with transformations but stays promotion-pending", async () => {
    const cases = [
      makeCase(1, "verified_defect"), makeCase(2, "verified_defect"),
      makeCase(3, "defensible_unusual"), makeCase(4, "defensible_unusual"),
      makeCase(5, "ordinary"), makeCase(6, "ordinary"),
      makeCase(7, "ambiguous_ood"), makeCase(8, "ambiguous_ood"),
    ];
    const manifest = createPilotManifest({ cases, acceptancePolicy: policy });
    const adapter = createMockReviewerAdapter();
    const qualification = startReviewerPilot(initialReviewerQualification(adapter), manifest);
    const run = await runReviewerPilot(manifest, adapter, { baseCaseLimit: 8 });
    expect(createEightCaseFixture(cases)).toHaveLength(8);
    expect(run.executedBaseCases).toBe(8);
    expect(run.variants).toHaveLength(64);
    expect(run.status).toBe("promotion_pending");
    expect(qualification.strategyAuthority).toBe(false);
    expect(run.outputs.every((entry) => entry.output?.assessments.strategicPlausibility === "insufficient")).toBe(true);
  });

  it("groups transformations by base family and substantive controls are not silently equivalent", () => {
    const base = makeCase(9, "ordinary");
    expect(transformPilotCase(base, "global_suit_permutation").expectedDifference).toBe("same");
    expect(transformPilotCase(base, "substantive_contrast").expectedDifference).toBe("pending");
    expect(transformPilotCase(base, "scale_10x").familyId).toBe(base.familyId);
  });

  it("leaves missing human evidence pending and never fabricates promotion", () => {
    const adapter = createMockReviewerAdapter({ version: "v1" });
    const record = initialReviewerQualification(adapter);
    const result = attemptReviewerPromotion({ record, acceptancePolicy: policy, humanValidationRecordRef: null, heldOutEvidenceComplete: false, declaredDimensions: ["decision"] });
    expect(result.state).toBe("UNVALIDATED");
    expect(result.promotionStatus).toBe("promotion_pending");
    expect(result.humanRecordRef).toBeNull();
    expect(qualificationFingerprintChanged(record, { ...adapter, version: "v2" })).toBe(true);
  });

  it("allows only an explicitly scoped fixture-only promotion record", () => {
    const adapter = createMockReviewerAdapter();
    const record = initialReviewerQualification(adapter);
    const promotion = recordFixtureOnlyPromotion({ qualification: record, dimensions: ["decision"], domains: ["fixture-domain"], evidenceRefs: ["fixture-ref"] });
    expect(promotion.status).toBe("fixture_only");
    expect(promotion.allowedDimensions).toEqual(["decision"]);
    expect(promotion.strategyAuthority).toBe(false);
  });
});

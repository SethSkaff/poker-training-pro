import { describe, expect, it } from "vitest";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTournamentRunnerReplay,
  heroTournamentLegalActions,
} from "../../src/modes/tournamentRunner";
import { createExactReferenceProvider } from "./referenceValues";
import { runReviewPrototype, reviewEnvelopeToActionAuditRows } from "./reviewPrototypeRunner";
import { createPendingReviewTolerancePolicy } from "../../src/modes/handReviewPrototype";

function oneActionReplay() {
  let runner = advanceTournamentRunnerToHero(createCareerTournamentRunner({
    eventId: "local-qualifier",
    hero: { id: "hero", name: "Review Runner", rating: 1_000 },
    mode: "normal",
    seed: "review-prototype-runner",
  }), { nowMs: 10_000, policy: { simulations: 60 } });
  const legal = heroTournamentLegalActions(runner);
  if (!legal) throw new Error("Expected a hero decision");
  const action = legal.fold ? "fold" : legal.check ? "check" : legal.call ? "call" : "all-in";
  runner = applyHeroTournamentAction(runner, { action, decisionElapsedMs: 1_000 }, { nowMs: 12_000, policy: { simulations: 60 } });
  return createTournamentRunnerReplay(runner, 60);
}

describe("review prototype runner", () => {
  it("traverses an authoritative replay and emits a T6-compatible audit row", async () => {
    const result = await runReviewPrototype(oneActionReplay(), createExactReferenceProvider(), {
      tolerancePolicy: createPendingReviewTolerancePolicy(),
      budget: { maxDecisions: 1, maxSearchRounds: 0, searchDrawCount: 1, evaluationDrawCount: 1 },
    });
    expect(result.envelope.totalEncountered).toBe(1);
    expect(result.envelope.decisions).toHaveLength(1);
    expect(result.auditRows).toHaveLength(1);
    expect(result.auditRows[0].traceLink).toContain("offline-review:");
    expect(result.auditRows[0].grade).toBeNull();
    expect(result.envelope.unresolvedCount).toBe(1);
  }, 15_000);

  it("retains unscored and unsupported decisions in the reducer", () => {
    const replay = oneActionReplay();
    const row = reviewEnvelopeToActionAuditRows({
      schemaVersion: 2,
      semanticsVersion: "test",
      decisions: [{
        schemaVersion: 2,
        semanticsVersion: "test",
        decisionId: "d",
        handId: "h",
        index: 0,
        objective: "chip_ev",
        playedAction: null,
        bestSampledAction: null,
        comparisonMenu: { actionKeys: [], targetsChips: [], menuHash: "", searchSeed: "", evaluationSeed: "" },
        actionValues: [],
        regretEstimateBb: null,
        regretInObjectiveUnits: null,
        regretInterval: null,
        tolerance: { value: null, unit: "bb", version: null, artifactHash: null, status: "pending", sourceEvidence: null },
        decisionStatus: "unresolved",
        grading: { eligible: false, quality: null, severityBand: null, reasonCodes: ["missing_evidence"] },
        sizingRegion: { supportedTargetsChips: [], unresolvedTargetsChips: [], excludedTargetsChips: [], intervals: [], menuCoverage: "finite_menu", searchTruncated: false },
        simulationUncertainty: { method: "unsupported", confidenceLevel: 0.95, iidDrawCount: 0, pairCount: 0, payoffBounds: null, searchBudget: 0, evaluationBudget: 0, branchSupportCounts: {} },
        modelConfidence: { status: "unsupported", referenceIds: [], sensitivityModelIds: [], limitations: ["missing_evidence"] },
        display: { recommendationTextKey: "review.unscored", reasonKeys: ["missing_evidence"], amountListChips: [], region: null, valuePrecision: "do_not_rank" },
        summaryEligibility: { eligible: false, exclusionReason: "unresolved" },
        observedActionSupport: [],
        candidateActionSupport: [],
        conditioningEvidence: [],
        recommendationScope: { modelIds: [], robustAcrossModels: false, numericalConfidence: "insufficient", strategicConfidence: "unsupported", limitations: ["missing_evidence"] },
      }],
      totalEncountered: replay.actions.length,
      supportedGradeCount: 0,
      unresolvedCount: 1,
      oodCount: 0,
      tolerancePendingCount: 0,
      nearOptimalShare: null,
      meanRegretSupported: null,
      truncated: false,
      cancelled: false,
    });
    expect(row[0].gradeEligible).toBe(false);
    expect(row[0].decisionStatus).toBe("unresolved");
    expect(row[0].traceLink).toBe("offline-review:h:0");
  });
});

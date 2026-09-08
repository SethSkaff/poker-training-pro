import { describe, expect, it } from "vitest";
import { createBettingRound } from "../engine/betting";
import { assessActionSupport, actionSupportInputIdentity, projectActionSupportForObserver, type ActionSupportInput } from "./actionSupport";
import { canonicalizeBettingAction, computeWagerGeometry } from "./pokerActionSemantics";

function input(): ActionSupportInput {
  const preState = createBettingRound([
    { id: "hero", stack: 900, streetCommitted: 100, totalCommitted: 100, status: "active" },
    { id: "villain", stack: 900, streetCommitted: 100, totalCommitted: 100, status: "active" },
  ], ["hero", "villain"], { minimumBet: 100, currentBet: 100 });
  const action = canonicalizeBettingAction(preState, { type: "raise", to: 1_000 });
  const geometry = computeWagerGeometry({ preState, canonicalAction: action, bigBlindChips: 100 });
  const base = {
    schemaVersion: 1 as const,
    assessmentVersion: "action-support-v1" as const,
    semanticKey: action.key,
    observerScope: "hero" as const,
    evidenceScopeId: "fixture-public",
    modelId: "finite-fixture",
    modelVersion: "1",
    objective: "chip_ev" as const,
    inputIdentity: "",
    action,
    geometry,
    street: "flop" as const,
    counts: { tournamentPlayersRemaining: 2, playersDealtIn: 2, activePlayersInHand: 2, activeOpponents: 1 },
    position: { actorSeat: 0, buttonSeat: 1, actorRelativeSeat: 1, positionVsResponders: "out" as const },
    publicPrefix: { digest: "prefix", actions: [] },
    reopening: { isFullRaise: action.isFullRaise, isShortAllInIncrease: action.isShortAllInIncrease, newlyReopenedPlayerIds: action.newlyReopenedPlayerIds },
    boundaryOrigin: "all_in" as const,
    policyEvidence: { probability: { value: null, reason: "not-provided" }, rank: { value: null, reason: "not-provided" }, source: "unavailable" as const },
    responseEvidence: { simulations: 100, sampleCounts: { allFold: 50, call: 50, reRaise: 0 }, conditionalSamples: { call: 50, reRaise: 0 }, emptyBranchFallback: { call: false, reRaise: false }, confidenceBasis: "exact_reference" as const, status: "adequate" as const },
    referenceEvidence: { status: "positive" as const, conditioning: { modelId: "finite-fixture", conditioningPrefixHash: "prefix", sizingSignature: "target:1000", status: "conditioned" as const, dimensions: [{ dimension: "target", observedValue: 1000, usedRepresentation: "target", status: "conditioned" as const, basis: "fixture" }], domainEvidence: { status: "supported" as const, supportedDescription: "fixture targets", extrapolation: null, basis: "fixture" }, limitations: [] }, response: null, unusualSignal: true, ordinaryBasis: null, limitation: null },
    mechanicalEvidence: { status: "valid" as const, evidencePaths: ["fixture.transition"], errors: [] },
  };
  base.inputIdentity = actionSupportInputIdentity(base);
  return base;
}

describe("A02 shared action-support assessment", () => {
  it("keeps legality, model support, unusualness and authority orthogonal", () => {
    const first = assessActionSupport(input());
    const second = assessActionSupport(input());
    expect(second).toEqual(first);
    expect(first.mechanicalValidity).toBe("valid");
    expect(first.modelSupport).toBe("supported");
    expect(first.actionEvidence).toBe("supported_unusual");
    expect(first.authority).toBe("evidence_only");
  });

  it("does not turn absent evidence into ordinary support and rejects mismatched projection scope", () => {
    const source = input();
    source.referenceEvidence = null;
    source.inputIdentity = actionSupportInputIdentity(source);
    const assessment = assessActionSupport(source);
    expect(assessment.modelSupport).toBe("unavailable");
    expect(assessment.actionEvidence).toBe("unknown");
    expect(() => projectActionSupportForObserver(source, assessment, "public")).toThrow(/scope mismatch/);
  });
});

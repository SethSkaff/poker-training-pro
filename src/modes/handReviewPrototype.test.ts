import { describe, expect, it } from "vitest";
import {
  createPendingReviewTolerancePolicy,
  deriveReviewNodeEvidence,
  type ReviewTolerancePolicy,
} from "./handReviewPrototype";
import type {
  ReviewCanonicalAction,
  ReviewNode,
  ReviewSupportDescription,
  ReviewValue,
  ReviewValueBatch,
  ReviewValueProvider,
} from "./reviewEvidence";
import { createExactReferenceProvider } from "../../scripts/evaluation/referenceValues";
import { loadReferenceCase } from "../../scripts/evaluation/referenceCases";

function supportFor(actionKey: string, status: ReviewSupportDescription["status"] = "supported"): ReviewSupportDescription {
  return {
    status,
    modelId: "synthetic-primary",
    modelVersion: "synthetic-surface-v1",
    referenceId: "synthetic-surface",
    conditioning: null,
    domainEvidence: { status: status === "ood" ? "unsupported" : "supported", supportedDescription: "Synthetic test surface", extrapolation: null, basis: "test" },
    limitations: [],
    continuationAssumption: "Analytic fixture surface",
    responseSupport: null,
  };
}

function action(key: string, targetChips: number, kind: ReviewCanonicalAction["kind"] = "bet"): ReviewCanonicalAction {
  return {
    key,
    kind,
    targetChips,
    investedChips: kind === "fold" || kind === "check" ? 0 : targetChips,
    raisesCurrentBet: kind === "bet" || kind === "raise",
    raiseByChips: kind === "bet" || kind === "raise" ? targetChips : 0,
    isActorAllIn: false,
    stackOffClass: "none",
    isFullRaise: kind === "bet" || kind === "raise",
    isShortAllInIncrease: false,
  };
}

function node(actions: readonly ReviewCanonicalAction[], overrides: Partial<ReviewNode> = {}): ReviewNode {
  return {
    schemaVersion: 1,
    nodeId: "synthetic-review-node",
    handId: "synthetic-hand",
    index: 0,
    actorId: "hero",
    objective: "chip_ev",
    street: "river",
    board: [
      { rank: "2", suit: "clubs" },
      { rank: "7", suit: "hearts" },
      { rank: "9", suit: "spades" },
      { rank: "J", suit: "diamonds" },
      { rank: "3", suit: "clubs" },
    ],
    heroCards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "diamonds" }],
    potBeforeChips: 1,
    actorStackBeforeChips: 100_000,
    actorStreetCommittedChips: 0,
    actorTotalCommittedChips: 0,
    currentBetChips: 1,
    bigBlindChips: 1,
    smallestChipChips: 1,
    buttonSeat: 0,
    tableSize: 2,
    opponents: [{ id: "villain", remainingStackChips: 100_000, streetCommittedChips: 0, totalCommittedChips: 0, seat: 1, status: "active" }],
    legalActions: actions,
    proposedActions: actions,
    publicPrefix: [],
    publicPrefixHash: "synthetic-prefix",
    ...overrides,
  };
}

function syntheticProvider(surface: (action: ReviewCanonicalAction) => number, options: { noisy?: boolean; ood?: (action: ReviewCanonicalAction) => boolean } = {}): ReviewValueProvider {
  const makeBatch = (input: Parameters<ReviewValueProvider["evaluateMenu"]>[0]): ReviewValueBatch => {
    const values: ReviewValue[] = input.modelIds.flatMap((modelId) => input.canonicalActions.map((candidate) => {
      const support = options.ood?.(candidate) ? supportFor(candidate.key, "ood") : supportFor(candidate.key);
      const rows = options.noisy
        ? Array.from({ length: input.drawCount }, (_, index) => ({ drawId: `draw:${index}`, payoff: surface(candidate) + (index % 2 === 0 ? -1 : 1) }))
        : [];
      const mean = options.noisy ? rows.reduce((sum, row) => sum + row.payoff, 0) / Math.max(1, rows.length) : surface(candidate);
      return {
        actionKey: candidate.key,
        modelId,
        mean,
        valueUnit: "chips" as const,
        bound: options.noisy ? { lower: -100, upper: 100 } : { lower: mean, upper: mean },
        theoreticalPayoffBounds: options.noisy ? { lower: -100, upper: 100 } : { lower: mean, upper: mean },
        exact: !options.noisy,
        sampleCount: rows.length,
        payoffRows: rows,
        support,
        continuationAssumption: "Synthetic analytic surface",
        provenance: { referenceId: "synthetic-surface", provider: "test", version: "1", verificationStatus: "verified_fixture" as const },
        conditioningEvidence: null,
      };
    }));
    return {
      schemaVersion: 1,
      nodeId: input.node.nodeId,
      objective: input.node.objective,
      phase: input.phase,
      values,
      drawIds: options.noisy ? Array.from({ length: input.drawCount }, (_, index) => `draw:${index}`) : [],
      pairwiseBounds: options.noisy ? { lower: -200, upper: 200 } : { lower: -100, upper: 100 },
      provider: "test",
      providerVersion: "1",
      referenceIds: ["synthetic-surface"],
    };
  };
  return {
    describeSupport: (reviewNode) => supportFor(reviewNode.nodeId),
    evaluateMenu: makeBatch,
  };
}

const syntheticTolerance: ReviewTolerancePolicy = {
  version: "synthetic-tolerance-v1",
  objective: "chip_ev",
  unit: "bb",
  value: 0.1,
  contextScope: "fixture-only",
  sourceEvidence: "analytically specified test surface",
  artifactHash: "synthetic",
  approvalStatus: "synthetic",
};

describe("Game Review v2 prototype", () => {
  it("grades the required flat plateau by supported regret, not size distance", async () => {
    const actions = [action("11063", 11063), action("11000", 11000), action("11500", 11500), action("12000", 12000)];
    const evidence = await deriveReviewNodeEvidence(node(actions), {
      valueProvider: syntheticProvider((candidate) => candidate.targetChips === 11063 ? 14.82 : candidate.targetChips === 11000 ? 14.81 : candidate.targetChips === 11500 ? 14.80 : candidate.targetChips === 12000 ? 14.77 : 14.79),
      tolerancePolicy: syntheticTolerance,
      playedAction: actions[3],
      budget: { maxSearchRounds: 0, maxMenuActions: 64, searchDrawCount: 1, evaluationDrawCount: 1 },
    });
    expect(evidence.decisionStatus).toBe("supported_near_optimal");
    expect(evidence.grading.quality).toBe("excellent");
    expect(evidence.regretEstimateBb).toBeCloseTo(0.05, 8);
    expect(evidence.sizingRegion.supportedTargetsChips).toContain(12000);
    expect(evidence.sizingRegion.intervals).toHaveLength(0);
  });

  it("reports a supported loss on an adverse surface", async () => {
    const actions = [action("11063", 11063), action("11000", 11000), action("11500", 11500), action("12000", 12000)];
    const evidence = await deriveReviewNodeEvidence(node(actions), {
      valueProvider: syntheticProvider((candidate) => candidate.targetChips === 12000 ? 11.4 : 14.8),
      tolerancePolicy: syntheticTolerance,
      playedAction: actions[3],
      budget: { maxSearchRounds: 0, maxMenuActions: 64, searchDrawCount: 1, evaluationDrawCount: 1 },
    });
    expect(evidence.decisionStatus).toBe("supported_loss");
    expect(evidence.grading.quality).toBe("supported_loss");
  });

  it("keeps noisy paired regret unresolved when its simultaneous bounds cross epsilon", async () => {
    const actions = [action("a", 100), action("b", 200)];
    const evidence = await deriveReviewNodeEvidence(node(actions), {
      valueProvider: syntheticProvider((candidate) => candidate.key === "a" ? 10 : 10.01, { noisy: true }),
      tolerancePolicy: syntheticTolerance,
      playedAction: actions[0],
      budget: { maxSearchRounds: 0, evaluationDrawCount: 32, searchDrawCount: 1 },
    });
    expect(evidence.decisionStatus).toBe("unresolved");
    expect(evidence.grading.quality).toBeNull();
    expect(evidence.simulationUncertainty.method).toBe("paired_hoeffding");
  });

  it("does not merge supported endpoints across an unsampled discontinuity", async () => {
    const actions = [action("a", 100), action("b", 200), action("c", 300)];
    const evidence = await deriveReviewNodeEvidence(node(actions), {
      valueProvider: syntheticProvider((candidate) => candidate.key === "b" ? 0 : 1, { ood: (candidate) => candidate.key.includes(":") }),
      tolerancePolicy: syntheticTolerance,
      playedAction: actions[0],
      budget: { maxSearchRounds: 0, maxMenuActions: 3, searchDrawCount: 1, evaluationDrawCount: 1 },
    });
    expect(evidence.sizingRegion.intervals).toHaveLength(0);
    expect(evidence.sizingRegion.menuCoverage).toBe("finite_menu");
  });

  it("preserves a 25-chip physical context without disqualifying the abstract target", async () => {
    const actions = [action("11063", 11063), action("11000", 11000), action("11500", 11500), action("12000", 12000)];
    const evidence = await deriveReviewNodeEvidence(node(actions, { smallestChipChips: 25 }), {
      valueProvider: syntheticProvider(() => 14.8),
      tolerancePolicy: syntheticTolerance,
      playedAction: actions[0],
      budget: { maxSearchRounds: 0, maxMenuActions: 64, searchDrawCount: 1, evaluationDrawCount: 1 },
    });
    expect(evidence.comparisonMenu.targetsChips).toContain(11063);
    expect(evidence.display.amountListChips).toContain(11063);
  });

  it("uses an actual finite poker reference case and keeps hidden truth out of public support", async () => {
    const referenceCase = loadReferenceCase("known-river-loss");
    const provider = createExactReferenceProvider();
    const first = await deriveReviewNodeEvidence(referenceCase.node, {
      valueProvider: provider,
      tolerancePolicy: syntheticTolerance,
      playedAction: referenceCase.actions[1],
      budget: { modelIds: ["reference-primary"], maxSearchRounds: 0, searchDrawCount: 1, evaluationDrawCount: 1 },
    });
    const substituted = await deriveReviewNodeEvidence({ ...referenceCase.node, worlds: referenceCase.node.worlds?.map((world) => ({ ...world, opponentCards: { villain: [{ rank: "2", suit: "spades" }, { rank: "2", suit: "hearts" }] } })) }, {
      valueProvider: provider,
      tolerancePolicy: syntheticTolerance,
      playedAction: referenceCase.actions[1],
      budget: { modelIds: ["reference-primary"], maxSearchRounds: 0, searchDrawCount: 1, evaluationDrawCount: 1 },
    });
    expect(first.decisionStatus).toBe("supported_loss");
    expect(first.candidateActionSupport).toEqual(substituted.candidateActionSupport);
    expect(first.observedActionSupport).toEqual(substituted.observedActionSupport);
  });

  it("makes missing tolerance visibly pending and preserves action categories", async () => {
    const actions = [action("call", 100, "call"), action("jam-call", 100, "call"), action("jam", 200, "raise")];
    const nodeWithAlias = node(actions, { legalActions: actions, proposedActions: actions });
    const evidence = await deriveReviewNodeEvidence(nodeWithAlias, {
      valueProvider: syntheticProvider(() => 1),
      tolerancePolicy: createPendingReviewTolerancePolicy(),
      playedAction: actions[1],
      budget: { maxSearchRounds: 0, searchDrawCount: 1, evaluationDrawCount: 1 },
    });
    expect(evidence.decisionStatus).toBe("tolerance_pending");
    expect(evidence.grading.eligible).toBe(false);
    expect(evidence.candidateActionSupport.some((entry) => entry.semanticFacts.kind === "call")).toBe(true);
  });
});

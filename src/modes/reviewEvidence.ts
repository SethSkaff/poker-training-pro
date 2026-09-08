/**
 * Browser-safe contracts for the independent Game Review evidence prototype.
 *
 * This file deliberately contains only data shapes and the injected provider
 * port.  It does not know about Rational, replay persistence, or reviewer
 * authority.  The offline reference implementations live under
 * scripts/evaluation and consume these contracts.
 */

import type { Card, Street } from "../types/poker";
import type { CanonicalAction } from "../lib/pokerActionSemantics";
import type {
  ActionSupportAssessment,
  ConditioningEvidence,
  PublicActionSupportView,
  ResponseSupport,
} from "../lib/actionSupport";

export type ReviewObjective =
  | "chip_ev"
  | "payout_ev"
  | "qualification_probability";

export type ReviewValuePhase = "search" | "evaluation";
export type ReviewValueUnit = "chips" | "bb" | "payout_probability" | "qualification_probability";

/** The provider only needs the semantic fields; replay actions may carry more. */
export type ReviewCanonicalAction = Pick<
  CanonicalAction,
  | "key"
  | "kind"
  | "targetChips"
  | "investedChips"
  | "raisesCurrentBet"
  | "raiseByChips"
  | "isActorAllIn"
  | "stackOffClass"
  | "isFullRaise"
  | "isShortAllInIncrease"
>;

export interface ReviewOpponentView {
  id: string;
  remainingStackChips: number;
  streetCommittedChips: number;
  totalCommittedChips: number;
  seat: number;
  status?: "active" | "all-in" | "folded" | "out";
}

export interface ReviewNode {
  schemaVersion: 1;
  nodeId: string;
  handId?: string;
  index?: number;
  actorId: string;
  objective: ReviewObjective;
  street: Street;
  board: readonly Card[];
  heroCards: readonly Card[];
  potBeforeChips: number;
  actorStackBeforeChips: number;
  actorStreetCommittedChips: number;
  actorTotalCommittedChips: number;
  currentBetChips: number;
  bigBlindChips: number;
  smallestChipChips: number;
  buttonSeat: number;
  tableSize: number;
  opponents: readonly ReviewOpponentView[];
  legalActions: readonly ReviewCanonicalAction[];
  /** Offline menu proposals/boundaries; proposals never imply value support. */
  proposedActions?: readonly ReviewCanonicalAction[];
  domainBoundaryActions?: readonly ReviewCanonicalAction[];
  /** Public prefix used to prove that a response model is conditioned. */
  publicPrefix?: readonly { playerId: string; kind: string; targetChips: number }[];
  publicPrefixHash?: string;
  observedSizingSignature?: string | null;
  /** Exact/finite worlds and continuation trees are offline-only inputs. */
  worlds?: readonly ReviewFiniteWorld[];
  continuationTree?: ReviewContinuationTree;
  conditioningModels?: readonly ReviewConditioningModel[];
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ReviewResponseObservation {
  kind: "fold" | "call" | "raise" | "all-in";
  targetChips?: number;
}

export interface ReviewFiniteWorld {
  worldId: string;
  /** Joint probability weight. It is normalized across complete worlds. */
  weight: number;
  opponentCards: Readonly<Record<string, readonly Card[]>>;
  /** Complete board suffixes. Multiple suffixes are equally weighted unless supplied. */
  runouts?: readonly (readonly Card[])[];
  runoutWeights?: readonly number[];
  responses?: Readonly<
    Record<string, Readonly<Record<string, ReviewResponseObservation>>>
  >;
  /** A terminal continuation may provide an independently audited payoff. */
  payoffByAction?: Readonly<Record<string, number>>;
  /** Optional chance rows used by continuation-tree cases. */
  chanceId?: string;
}

export interface ReviewContinuationLeaf {
  leafId: string;
  probability: number;
  payoffChips: number;
  board?: readonly Card[];
  publicActions?: readonly { playerId: string; kind: string; targetChips: number }[];
}

export interface ReviewContinuationAction {
  actionKey: string;
  /** A supplied terminal distribution, or an explicit unsupported marker. */
  leaves?: readonly ReviewContinuationLeaf[];
  supported: boolean;
  assumption: string;
}

export interface ReviewContinuationTree {
  treeId: string;
  version: string;
  actions: readonly ReviewContinuationAction[];
  modelId?: string;
  /** The tree is valid only if its probabilities normalize jointly. */
  probabilityBasis?: "joint" | "conditional";
}

export interface ReviewConditioningModel {
  modelId: string;
  modelVersion: string;
  conditioningPrefixHash: string;
  observedSizingSignature: string | null;
  conditioningStatus: "explicit_reference" | "estimated" | "unavailable";
  dimensions: ConditioningEvidence["dimensions"];
  domainEvidence: ConditioningEvidence["domainEvidence"];
  limitations: string[];
  responseSupport?: ResponseSupport | null;
}

export interface ReviewSupportDescription {
  status: "supported" | "sparse" | "assumption_sensitive" | "ood" | "unavailable";
  modelId: string;
  modelVersion: string;
  referenceId: string | null;
  conditioning: ConditioningEvidence | null;
  domainEvidence: ConditioningEvidence["domainEvidence"];
  limitations: string[];
  continuationAssumption: string;
  responseSupport: ResponseSupport | null;
}

export interface ReviewPayoffRow {
  drawId: string;
  payoff: number;
}

export interface ReviewValue {
  actionKey: string;
  modelId: string;
  mean: number | null;
  valueUnit: ReviewValueUnit;
  bound: { lower: number; upper: number } | null;
  theoreticalPayoffBounds: { lower: number; upper: number } | null;
  exact: boolean;
  sampleCount: number;
  payoffRows: readonly ReviewPayoffRow[];
  support: ReviewSupportDescription;
  continuationAssumption: string;
  provenance: {
    referenceId: string | null;
    provider: string;
    version: string;
    verificationStatus: "verified_fixture" | "pending_external" | "unverified";
  };
  conditioningEvidence: ConditioningEvidence | null;
}

export interface ReviewValueBatch {
  schemaVersion: 1;
  nodeId: string;
  objective: ReviewObjective;
  phase: ReviewValuePhase;
  values: readonly ReviewValue[];
  drawIds: readonly string[];
  pairwiseBounds: { lower: number; upper: number } | null;
  provider: string;
  providerVersion: string;
  referenceIds: string[];
}

export interface ReviewValueProvider {
  describeSupport(
    node: ReviewNode,
    objective: ReviewObjective,
  ): ReviewSupportDescription | Promise<ReviewSupportDescription>;
  evaluateMenu(input: {
    node: ReviewNode;
    canonicalActions: readonly ReviewCanonicalAction[];
    modelIds: readonly string[];
    phase: ReviewValuePhase;
    seed: string;
    drawCount: number;
    signal?: { readonly aborted: boolean };
  }): ReviewValueBatch | Promise<ReviewValueBatch>;
}

/** The UI/public projection is intentionally separate from internal traces. */
export interface ReviewDecisionEvidenceV2 {
  schemaVersion: 2;
  semanticsVersion: string;
  decisionId: string;
  handId: string;
  index: number;
  objective: ReviewObjective;
  playedAction: ReviewCanonicalAction | null;
  bestSampledAction: ReviewCanonicalAction | null;
  comparisonMenu: {
    actionKeys: string[];
    targetsChips: number[];
    menuHash: string;
    searchSeed: string;
    evaluationSeed: string;
  };
  actionValues: ReviewValue[];
  regretEstimateBb: number | null;
  regretInObjectiveUnits: number | null;
  regretInterval: { lower: number; upper: number } | null;
  tolerance: {
    value: number | null;
    unit: ReviewValueUnit;
    version: string | null;
    artifactHash: string | null;
    status: "approved" | "synthetic" | "pending" | "unavailable";
    sourceEvidence: string | null;
  };
  decisionStatus:
    | "supported_near_optimal"
    | "supported_loss"
    | "unresolved"
    | "ood"
    | "unsupported_objective"
    | "invalid_input"
    | "tolerance_pending";
  grading: {
    eligible: boolean;
    quality: "excellent" | "supported_loss" | null;
    severityBand: "low" | "medium" | "high" | "critical" | null;
    reasonCodes: string[];
  };
  sizingRegion: {
    supportedTargetsChips: number[];
    unresolvedTargetsChips: number[];
    excludedTargetsChips: number[];
    intervals: Array<{
      minChips: number;
      maxChips: number;
      stepChips: number;
      basis: "exhaustive_lattice" | "certified_bound";
    }>;
    menuCoverage: "finite_menu" | "certified_domain";
    searchTruncated: boolean;
  };
  simulationUncertainty: {
    method: "exact" | "paired_hoeffding" | "unsupported";
    confidenceLevel: number;
    iidDrawCount: number;
    pairCount: number;
    payoffBounds: { lower: number; upper: number } | null;
    searchBudget: number;
    evaluationBudget: number;
    branchSupportCounts: Record<string, number>;
  };
  modelConfidence: {
    status: "reference_supported" | "assumption_sensitive" | "unvalidated" | "unsupported";
    referenceIds: string[];
    sensitivityModelIds: string[];
    limitations: string[];
  };
  display: {
    recommendationTextKey: string;
    reasonKeys: string[];
    amountListChips: number[];
    region: string | null;
    valuePrecision: "exact" | "approximate" | "do_not_rank";
  };
  summaryEligibility: { eligible: boolean; exclusionReason: string | null };
  observedActionSupport: PublicActionSupportView[];
  candidateActionSupport: PublicActionSupportView[];
  conditioningEvidence: ConditioningEvidence[];
  recommendationScope: {
    modelIds: string[];
    robustAcrossModels: boolean;
    numericalConfidence: "exact" | "bounded" | "insufficient";
    strategicConfidence: "reference_supported" | "assumption_sensitive" | "unvalidated" | "unsupported";
    limitations: string[];
  };
}

export interface ReviewEvidenceEnvelopeV2 {
  schemaVersion: 2;
  semanticsVersion: string;
  decisions: ReviewDecisionEvidenceV2[];
  totalEncountered: number;
  supportedGradeCount: number;
  unresolvedCount: number;
  oodCount: number;
  tolerancePendingCount: number;
  nearOptimalShare: number | null;
  meanRegretSupported: number | null;
  truncated: boolean;
  cancelled: boolean;
}

/** A small adapter for tests/consumers that only need the source-safe fields. */
export function canonicalReviewActionKey(action: ReviewCanonicalAction): string {
  return action.key;
}

export function actionSupportViewFromAssessment(
  action: ReviewCanonicalAction,
  assessment: ActionSupportAssessment,
  conditioningSummary: string[] = [],
): PublicActionSupportView {
  return {
    opaquePublicActionId: action.key,
    semanticFacts: {
      kind: action.kind,
      targetChips: action.targetChips,
      investedChips: action.investedChips,
      raisesCurrentBet: action.raisesCurrentBet,
      stackOffClass: action.stackOffClass,
    },
    assessment: {
      modelSupport: assessment.modelSupport,
      actionEvidence: assessment.actionEvidence,
      reasonCodes: [...assessment.reasonCodes],
      limitations: [...assessment.limitations],
      authority: assessment.authority,
      evidenceScopeId: assessment.evidenceScopeId,
      assessmentVersion: assessment.assessmentVersion,
    },
    conditioningSummary,
    traceAvailability: "unavailable_historical_trace",
  };
}

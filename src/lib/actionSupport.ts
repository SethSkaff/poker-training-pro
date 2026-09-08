import type { Street } from "../types/poker";
import type { PlayerCountSemantics } from "./playerCountSemantics";
import type { CanonicalAction, WagerGeometry } from "./pokerActionSemantics";

export const ACTION_SUPPORT_SCHEMA_VERSION = 1 as const;
export const ACTION_SUPPORT_ASSESSMENT_VERSION = "action-support-v1" as const;

export type ObserverScope = "hero" | "public" | "internal";
export type SupportStatus = "supported" | "sparse" | "assumption_sensitive" | "ood" | "unavailable";
export type ActionEvidenceStatus = "ordinary" | "supported_unusual" | "anomalous" | "unknown";

export interface SupportMaybeNumber {
  value: number | null;
  reason: string | null;
}

export interface ConditioningDimensionEvidence {
  dimension: string;
  observedValue: string | number | null;
  usedRepresentation: string | null;
  status: "conditioned" | "assumed" | "unsupported" | "not_applicable";
  basis: string;
  reference?: string;
  justification?: string;
}

export interface ConditioningEvidence {
  modelId: string;
  conditioningPrefixHash: string;
  sizingSignature: string | null;
  status: "conditioned" | "assumed" | "unsupported" | "not_applicable";
  dimensions: ConditioningDimensionEvidence[];
  domainEvidence: {
    status: "supported" | "partial" | "unsupported";
    supportedDescription: string;
    extrapolation: string | null;
    basis: string;
  };
  limitations: string[];
}

export interface ResponseSupportEvidence {
  simulations: number;
  sampleCounts: { allFold: number; call: number; reRaise: number };
  conditionalSamples: { call: number; reRaise: number };
  emptyBranchFallback: { call: boolean; reRaise: boolean };
  confidenceBasis: "sampled_branch" | "empty_branch_fallback" | "exact_reference";
  status: "adequate" | "sparse" | "not_applicable" | "unavailable";
}

/** Source-safe alias used by decision events and offline evidence adapters. */
export type ResponseSupport = ResponseSupportEvidence;

export interface MechanicalEvidence {
  status: "valid" | "invalid" | "unknown";
  evidencePaths: string[];
  errors: string[];
}

export interface ActionSupportInput {
  schemaVersion: typeof ACTION_SUPPORT_SCHEMA_VERSION;
  assessmentVersion: typeof ACTION_SUPPORT_ASSESSMENT_VERSION;
  semanticKey: string;
  observerScope: ObserverScope;
  evidenceScopeId: string;
  modelId: string;
  modelVersion: string;
  objective: "chip_ev" | "payout_ev" | "qualification_probability";
  inputIdentity: string;
  action: CanonicalAction;
  geometry: WagerGeometry;
  street: Street;
  counts: PlayerCountSemantics;
  position: { actorSeat: number; buttonSeat: number; actorRelativeSeat: number; positionVsResponders: "in" | "out" | "mixed" | "none" };
  publicPrefix: { digest: string; actions: Array<{ playerId: string; kind: string; targetChips: number }> };
  reopening: { isFullRaise: boolean; isShortAllInIncrease: boolean; newlyReopenedPlayerIds: string[] };
  boundaryOrigin: "ordinary" | "exact_call" | "minimum" | "all_in" | "forced_amount" | "unknown";
  policyEvidence: {
    probability: SupportMaybeNumber;
    rank: SupportMaybeNumber;
    source: "rational" | "normal" | "scripted" | "unavailable";
  };
  responseEvidence: ResponseSupportEvidence | null;
  referenceEvidence: {
    status: "positive" | "negative" | "sensitive" | "unavailable";
    conditioning: ConditioningEvidence | null;
    response: ResponseSupportEvidence | null;
    unusualSignal: boolean;
    ordinaryBasis: string | null;
    limitation: string | null;
  } | null;
  sensitivity?: {
    bundleId: string;
    models: Array<{
      modelId: string;
      status: SupportStatus;
      regretUpper: number | null;
      reason: string | null;
    }>;
  } | null;
  mechanicalEvidence?: MechanicalEvidence;
}

export interface ActionSupportAssessment {
  schemaVersion: typeof ACTION_SUPPORT_SCHEMA_VERSION;
  assessmentVersion: typeof ACTION_SUPPORT_ASSESSMENT_VERSION;
  semanticKey: string;
  observerScope: ObserverScope;
  evidenceScopeId: string;
  modelId: string;
  modelVersion: string;
  objective: ActionSupportInput["objective"];
  inputIdentity: string;
  mechanicalValidity: MechanicalEvidence["status"];
  modelSupport: SupportStatus;
  actionEvidence: ActionEvidenceStatus;
  reasonCodes: string[];
  measurements: Record<string, { value: number | null; unit: string; basis: string }>;
  limitations: string[];
  evidencePaths: string[];
  authority: "evidence_only";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function withoutIdentity(input: ActionSupportInput): Record<string, unknown> {
  const { inputIdentity: _ignored, ...payload } = input;
  return payload;
}

/** Stable source-safe identity; T1 adds cryptographic artifact hashes offline. */
export function actionSupportInputIdentity(input: ActionSupportInput): string {
  return stableJson(withoutIdentity(input));
}

export function validateActionSupportInput(input: ActionSupportInput): void {
  if (input.schemaVersion !== ACTION_SUPPORT_SCHEMA_VERSION || input.assessmentVersion !== ACTION_SUPPORT_ASSESSMENT_VERSION) {
    throw new Error("Unsupported action-support schema version");
  }
  if (input.inputIdentity !== actionSupportInputIdentity(input)) {
    throw new Error("Action-support input identity mismatch");
  }
  if (input.geometry.potAtDecisionChips < 0 || input.geometry.actorStackChips < 0) {
    throw new Error("Action-support geometry contains a negative chip amount");
  }
}

function pushUnique(target: string[], values: readonly string[]): void {
  for (const value of values) if (!target.includes(value)) target.push(value);
}

/**
 * A pure, orthogonal assessment. It never recommends a different action and
 * never emits grade/permission authority.
 */
export function assessActionSupport(input: ActionSupportInput): ActionSupportAssessment {
  validateActionSupportInput(input);
  const reasons: string[] = [];
  const paths: string[] = [];
  const limitations: string[] = [];
  const mechanical = input.mechanicalEvidence ?? {
    status: "unknown" as const,
    evidencePaths: [],
    errors: [],
  };
  pushUnique(paths, mechanical.evidencePaths);
  if (mechanical.status === "invalid") reasons.push("invalid_transition_or_replay_mismatch");
  if (mechanical.status === "unknown") reasons.push("missing_mechanical_evidence");

  let modelSupport: SupportStatus = "unavailable";
  const reference = input.referenceEvidence;
  if (!reference) {
    reasons.push("missing_reference_evidence");
    limitations.push("No named reference/domain evidence was supplied.");
  } else if (reference.status === "negative") {
    modelSupport = "supported";
    reasons.push("reference_supports_loss_or_discrepancy");
  } else if (reference.status === "sensitive") {
    modelSupport = "assumption_sensitive";
    reasons.push("sensitivity_disagreement");
  } else if (reference.status === "unavailable") {
    modelSupport = "unavailable";
    reasons.push("unsupported_conditioning_or_domain");
  } else if (reference.conditioning?.domainEvidence.status === "unsupported" || reference.conditioning?.status === "unsupported") {
    modelSupport = "ood";
    reasons.push("unsupported_conditioning_or_domain");
  } else if (reference.response?.status === "sparse" || input.responseEvidence?.status === "sparse" || reference.response?.confidenceBasis === "empty_branch_fallback") {
    modelSupport = "sparse";
    reasons.push(reference.response?.confidenceBasis === "empty_branch_fallback" ? "empty_branch_fallback" : "sparse_call_or_reraise_branch");
  } else if (reference.conditioning?.domainEvidence.status === "partial") {
    modelSupport = "assumption_sensitive";
    reasons.push("partial_reference_domain");
  } else {
    modelSupport = "supported";
    reasons.push("reference_domain_supported");
  }
  if (reference?.conditioning) {
    pushUnique(paths, reference.conditioning.dimensions.map((_, index) => `referenceEvidence.conditioning.dimensions[${index}]`));
    if (reference.conditioning.domainEvidence.extrapolation) limitations.push(reference.conditioning.domainEvidence.extrapolation);
    limitations.push(...reference.conditioning.limitations);
  }
  if (reference?.limitation) limitations.push(reference.limitation);
  if (input.objective !== "chip_ev") {
    reasons.push("unsupported_objective");
    limitations.push("Chip-EV evidence cannot be silently relabeled as payout or qualification value.");
  }

  let actionEvidence: ActionEvidenceStatus = "unknown";
  if (reference?.unusualSignal && modelSupport === "supported") {
    actionEvidence = "supported_unusual";
    reasons.push("independently_supported_unusual_reference");
  } else if (reference?.ordinaryBasis && modelSupport === "supported") {
    actionEvidence = "ordinary";
    reasons.push("ordinary_evidence_within_declared_domain");
  } else if (reference?.status === "negative" && modelSupport !== "supported") {
    actionEvidence = "anomalous";
  } else if (modelSupport === "ood" || modelSupport === "unavailable") {
    reasons.push("missing_evidence");
  }
  if (input.boundaryOrigin === "all_in" || input.geometry.actorCommitmentFraction >= 0.9) {
    reasons.push("extreme_geometry_needing_scrutiny");
  }
  const measurements: ActionSupportAssessment["measurements"] = {
    actorCommitmentFraction: {
      value: input.geometry.actorCommitmentFraction,
      unit: "fraction",
      basis: "pre-action actor remaining stack",
    },
    potAtDecision: {
      value: input.geometry.potAtDecisionChips,
      unit: "chips",
      basis: "pre-action commitment ledger",
    },
  };
  if (input.geometry.callCostOverCurrentPot.value !== null) {
    measurements.callCostOverCurrentPot = { value: input.geometry.callCostOverCurrentPot.value, unit: "ratio", basis: "C/P" };
  }
  return {
    schemaVersion: ACTION_SUPPORT_SCHEMA_VERSION,
    assessmentVersion: ACTION_SUPPORT_ASSESSMENT_VERSION,
    semanticKey: input.semanticKey,
    observerScope: input.observerScope,
    evidenceScopeId: input.evidenceScopeId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    objective: input.objective,
    inputIdentity: input.inputIdentity,
    mechanicalValidity: mechanical.status,
    modelSupport: input.objective === "chip_ev" ? modelSupport : "unavailable",
    actionEvidence,
    reasonCodes: [...new Set(reasons)],
    measurements,
    limitations: [...new Set(limitations)],
    evidencePaths: [...new Set(paths)],
    authority: "evidence_only",
  };
}

export interface PublicActionSupportView {
  opaquePublicActionId: string;
  semanticFacts: {
    kind: CanonicalAction["kind"];
    targetChips: number;
    investedChips: number;
    raisesCurrentBet: boolean;
    stackOffClass: CanonicalAction["stackOffClass"];
  };
  assessment: Pick<ActionSupportAssessment, "modelSupport" | "actionEvidence" | "reasonCodes" | "limitations" | "authority" | "evidenceScopeId" | "assessmentVersion">;
  conditioningSummary: string[];
  traceAvailability: "available" | "unavailable_historical_trace";
}

export function projectActionSupportForObserver(
  input: ActionSupportInput,
  assessment: ActionSupportAssessment,
  observerScope: ObserverScope,
): PublicActionSupportView {
  validateActionSupportInput(input);
  if (assessment.observerScope !== observerScope || input.observerScope !== observerScope) {
    throw new Error("Action-support assessment observer scope mismatch");
  }
  if (observerScope === "internal") throw new Error("Internal assessments cannot be projected to an observer");
  return {
    opaquePublicActionId: input.semanticKey,
    semanticFacts: {
      kind: input.action.kind,
      targetChips: input.action.targetChips,
      investedChips: input.action.investedChips,
      raisesCurrentBet: input.action.raisesCurrentBet,
      stackOffClass: input.action.stackOffClass,
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
    conditioningSummary: input.referenceEvidence?.conditioning
      ? input.referenceEvidence.conditioning.dimensions.map((dimension) => `${dimension.dimension}:${dimension.status}`)
      : ["conditioning_unavailable"],
    traceAvailability: "unavailable_historical_trace",
  };
}

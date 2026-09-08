import {
  serializeReviewerInput,
  type ReviewerInputV2,
  type ReviewerOutputV2,
} from "./criticInput";
import {
  runReviewerRequest,
  type ReviewerAdapter,
  type ReviewerResponseCache,
  type ReviewerRunReceipt,
  createInMemoryReviewerCache,
} from "./criticAdapter";

export type PilotStratum = "verified_defect" | "defensible_unusual" | "ordinary" | "ambiguous_ood";
export type CaseProvenance = "exact_verified" | "expert_adjudicated" | "pending_review";
export type PilotSplit = "development" | "calibration" | "holdout";

export interface PilotCase {
  baseCaseId: string;
  familyId: string;
  stratum: PilotStratum;
  provenance: CaseProvenance;
  input: ReviewerInputV2;
  referenceLabel?: string;
  humanLabelRef?: string;
}

export interface PilotVariant {
  variantId: string;
  baseCaseId: string;
  familyId: string;
  transform: "identity" | "exact_duplicate" | "name_permutation" | "global_suit_permutation" | "scale_10x" | "whitespace_order" | "equivalent_command" | "substantive_contrast";
  input: ReviewerInputV2;
  expectedDifference: "same" | "different" | "not_applicable" | "pending";
}

export interface PilotAcceptancePolicy {
  version: string;
  falseAlarmBudget: string;
  highImpactMissPriorities: string[];
  minimumEvidenceCoverage: string;
  allowedDomains: string[];
  sourceEvidence: string;
  approvedByHuman: boolean;
}

export interface ReviewerQualification {
  schemaVersion: 1;
  fingerprint: string;
  dimension: string;
  domain: string;
  state: "UNVALIDATED" | "PILOT" | "VALIDATED_LIMITED" | "SUSPENDED";
  strategyAuthority: false;
  releaseGateAuthority: false;
  userGradeAuthority: false;
  promotionStatus: "none" | "pilot_only" | "promotion_pending" | "human_validated" | "suspended";
  humanRecordRef: string | null;
  limitations: string[];
}

export interface PilotManifest {
  schemaVersion: 1;
  manifestId: string;
  version: string;
  splitSalt: string;
  slotCounts: Record<PilotStratum, number>;
  cases: PilotCase[];
  splitByFamily: Record<string, PilotSplit>;
  forcedDevelopmentFamilies: Record<string, string>;
  selectedCaseIds: string[];
  provenanceCounts: Record<CaseProvenance, number>;
  status: "fixture_only" | "pending_review";
  acceptancePolicy: PilotAcceptancePolicy | null;
}

export interface PilotRunResult {
  manifestId: string;
  requestedBaseCases: number;
  executedBaseCases: number;
  variants: PilotVariant[];
  receipts: ReviewerRunReceipt[];
  outputs: Array<{ variantId: string; output: ReviewerOutputV2 | null }>;
  status: "unvalidated" | "promotion_pending" | "pilot_complete";
  missingEvidence: string[];
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

function splitFor(familyId: string, splitSalt: string): PilotSplit {
  const bucket = hash(`${splitSalt}:${familyId}`) % 100;
  return bucket < 60 ? "development" : bucket < 80 ? "calibration" : "holdout";
}

function cloneInput(input: ReviewerInputV2): ReviewerInputV2 {
  return structuredClone(input);
}

function suitPermutation(input: ReviewerInputV2): ReviewerInputV2 {
  const map: Record<string, string> = { clubs: "diamonds", diamonds: "hearts", hearts: "spades", spades: "clubs" };
  const output = cloneInput(input);
  const mapCard = (card: { rank: string; suit: string }) => ({ ...card, suit: map[card.suit] ?? card.suit });
  if (output.ownCards) output.ownCards = output.ownCards.map(mapCard) as ReviewerInputV2["ownCards"];
  output.publicTimeline.board = output.publicTimeline.board.map(mapCard) as ReviewerInputV2["publicTimeline"]["board"];
  return output;
}

function scaleTen(input: ReviewerInputV2): ReviewerInputV2 {
  const output = cloneInput(input);
  const scale = (value: number) => value * 10;
  output.geometry = {
    ...output.geometry,
    potBeforeChips: scale(output.geometry.potBeforeChips),
    actualCallChips: scale(output.geometry.actualCallChips),
    targetChips: scale(output.geometry.targetChips),
    investedChips: scale(output.geometry.investedChips),
    raiseByChips: scale(output.geometry.raiseByChips),
    actorStackChips: scale(output.geometry.actorStackChips),
  };
  output.legalActions = output.legalActions.map((action) => ({ ...action, targetChips: scale(action.targetChips), investedChips: scale(action.investedChips), raiseByChips: scale(action.raiseByChips) }));
  output.selectedAction = output.selectedAction ? { ...output.selectedAction, targetChips: scale(output.selectedAction.targetChips), investedChips: scale(output.selectedAction.investedChips), raiseByChips: scale(output.selectedAction.raiseByChips) } : undefined;
  output.publicTimeline.actions = output.publicTimeline.actions.map((action) => ({ ...action, targetChips: scale(action.targetChips) }));
  return output;
}

function namePermutation(input: ReviewerInputV2): ReviewerInputV2 {
  const output = cloneInput(input);
  const aliases = new Set(output.publicTimeline.actions.map((action) => action.actorAlias));
  const replacement = new Map<string, string>();
  const publicAliases = [...aliases].filter((alias) => alias !== "P1").sort();
  if (publicAliases.length > 1) {
    for (let index = 0; index < publicAliases.length; index += 1) replacement.set(publicAliases[index], publicAliases[(index + 1) % publicAliases.length]);
    output.publicTimeline.actions = output.publicTimeline.actions.map((action) => ({ ...action, actorAlias: replacement.get(action.actorAlias) ?? action.actorAlias }));
  }
  return output;
}

export function transformPilotCase(base: PilotCase, transform: PilotVariant["transform"]): PilotVariant {
  const input = cloneInput(base.input);
  let transformed = input;
  let expectedDifference: PilotVariant["expectedDifference"] = "same";
  switch (transform) {
    case "exact_duplicate":
      expectedDifference = "same";
      break;
    case "name_permutation": transformed = namePermutation(input); break;
    case "global_suit_permutation": transformed = suitPermutation(input); break;
    case "scale_10x": transformed = scaleTen(input); break;
    case "whitespace_order":
      // The public action order is semantic. Only reorder independent summary rows.
      transformed.legalActions = [...transformed.legalActions].reverse();
      transformed.observerTendencySummary = [...transformed.observerTendencySummary].reverse();
      break;
    case "equivalent_command":
      if (transformed.selectedAction) transformed.selectedAction = { ...transformed.selectedAction, key: `${transformed.selectedAction.kind}:${transformed.selectedAction.targetChips}` };
      break;
    case "substantive_contrast":
      expectedDifference = "pending";
      if (transformed.selectedAction) transformed.selectedAction = { ...transformed.selectedAction, targetChips: transformed.selectedAction.targetChips + 1 };
      break;
    case "identity":
      break;
  }
  return {
    variantId: `${base.baseCaseId}:${transform}`,
    baseCaseId: base.baseCaseId,
    familyId: base.familyId,
    transform,
    input: transformed,
    expectedDifference,
  };
}

function fixtureSlots(cases: readonly PilotCase[], stratum: PilotStratum): PilotCase[] {
  return cases.filter((entry) => entry.stratum === stratum).slice(0, 50);
}

function selectedPilotCases(cases: readonly PilotCase[], manifestId: string): PilotCase[] {
  return (["verified_defect", "defensible_unusual", "ordinary", "ambiguous_ood"] as const).flatMap((stratum) => cases
    .filter((entry) => entry.stratum === stratum)
    .sort((left, right) => hash(`${manifestId}:${left.baseCaseId}`) - hash(`${manifestId}:${right.baseCaseId}`) || left.baseCaseId.localeCompare(right.baseCaseId))
    .slice(0, 10));
}

export function createPilotManifest(options: {
  manifestId?: string;
  version?: string;
  splitSalt?: string;
  cases: readonly PilotCase[];
  acceptancePolicy?: PilotAcceptancePolicy | null;
}): PilotManifest {
  const splitSalt = options.splitSalt ?? "pilot-split-v1";
  const strata: PilotStratum[] = ["verified_defect", "defensible_unusual", "ordinary", "ambiguous_ood"];
  const selected: PilotCase[] = [];
  for (const stratum of strata) selected.push(...fixtureSlots(options.cases, stratum));
  const splitByFamily: Record<string, PilotSplit> = {};
  const forcedDevelopmentFamilies: Record<string, string> = {};
  for (const entry of selected) {
    if (entry.familyId.toLowerCase().includes("wesley")) {
      splitByFamily[entry.familyId] = "development";
      forcedDevelopmentFamilies[entry.familyId] = "protected named family is development-only";
    } else splitByFamily[entry.familyId] = splitFor(entry.familyId, splitSalt);
  }
  const manifestId = options.manifestId ?? `pilot:${hash(`${options.version ?? "pilot-v1"}:${splitSalt}`).toString(16)}`;
  const provenanceCounts: Record<CaseProvenance, number> = { exact_verified: 0, expert_adjudicated: 0, pending_review: 0 };
  for (const entry of selected) provenanceCounts[entry.provenance] += 1;
  return {
    schemaVersion: 1,
    manifestId,
    version: options.version ?? "pilot-v1",
    splitSalt,
    slotCounts: { verified_defect: 50, defensible_unusual: 50, ordinary: 50, ambiguous_ood: 50 },
    cases: selected.map((entry) => ({ ...entry, input: cloneInput(entry.input) })),
    splitByFamily,
    forcedDevelopmentFamilies,
    selectedCaseIds: selectedPilotCases(selected, manifestId).map((entry) => entry.baseCaseId),
    provenanceCounts,
    status: selected.some((entry) => entry.provenance === "pending_review") || selected.length < 200 ? "pending_review" : "fixture_only",
    acceptancePolicy: options.acceptancePolicy ?? null,
  };
}

export const buildPilotManifest = createPilotManifest;

export function createEightCaseFixture(cases: readonly PilotCase[]): PilotCase[] {
  const output: PilotCase[] = [];
  for (const stratum of ["verified_defect", "defensible_unusual", "ordinary", "ambiguous_ood"] as const) {
    output.push(...cases.filter((entry) => entry.stratum === stratum).slice(0, 2));
  }
  return output;
}

export async function runReviewerPilot(
  manifest: PilotManifest,
  adapter: ReviewerAdapter,
  options: { baseCaseLimit?: number; cache?: ReviewerResponseCache; includeTransforms?: boolean } = {},
): Promise<PilotRunResult> {
  const selected = new Set(manifest.selectedCaseIds);
  const plannedCases = manifest.cases.filter((entry) => selected.has(entry.baseCaseId));
  const cases = (options.baseCaseLimit === undefined ? plannedCases : manifest.cases).slice(0, options.baseCaseLimit ?? plannedCases.length);
  const variants: PilotVariant[] = [];
  for (const entry of cases) {
    variants.push(transformPilotCase(entry, "identity"));
    variants.push(transformPilotCase(entry, "exact_duplicate"));
    if (options.includeTransforms !== false) {
      variants.push(transformPilotCase(entry, "name_permutation"));
      variants.push(transformPilotCase(entry, "global_suit_permutation"));
      variants.push(transformPilotCase(entry, "scale_10x"));
      variants.push(transformPilotCase(entry, "whitespace_order"));
      variants.push(transformPilotCase(entry, "equivalent_command"));
      variants.push(transformPilotCase(entry, "substantive_contrast"));
    }
  }
  const cache = options.cache ?? createInMemoryReviewerCache();
  const receipts: ReviewerRunReceipt[] = [];
  const outputs: PilotRunResult["outputs"] = [];
  for (const variant of variants) {
    const result = await runReviewerRequest(variant.input, adapter, { cache, cacheMode: variant.transform === "identity" ? "use" : "bypass" });
    receipts.push(result.receipt);
    outputs.push({ variantId: variant.variantId, output: result.output });
  }
  const hasHumanEvidence = cases.some((entry) => entry.provenance === "expert_adjudicated" && entry.humanLabelRef);
  return {
    manifestId: manifest.manifestId,
    requestedBaseCases: cases.length,
    executedBaseCases: cases.length,
    variants,
    receipts,
    outputs,
    status: hasHumanEvidence ? "pilot_complete" : "promotion_pending",
    missingEvidence: hasHumanEvidence ? [] : ["qualified_human_raters", "held_out_reference_labels", "preregistered_acceptance_policy"],
  };
}

export function initialReviewerQualification(
  adapter: Pick<ReviewerAdapter, "identity" | "version" | "promptFingerprint">,
  dimension = "decision",
  domain = "holdem-no-limit",
): ReviewerQualification {
  const fingerprint = `${adapter.identity}:${adapter.version}:${adapter.promptFingerprint}:reviewer-io-v2:${dimension}:${domain}`;
  return {
    schemaVersion: 1,
    fingerprint,
    dimension,
    domain,
    state: "UNVALIDATED",
    strategyAuthority: false,
    releaseGateAuthority: false,
    userGradeAuthority: false,
    promotionStatus: "none",
    humanRecordRef: null,
    limitations: ["mock_or_unvalidated_reviewer", "no_strategy_authority"],
  };
}

export function startReviewerPilot(record: ReviewerQualification, manifest: PilotManifest): ReviewerQualification {
  if (record.state !== "UNVALIDATED") throw new Error("Only an unvalidated reviewer can start a pilot");
  return { ...record, state: "PILOT", promotionStatus: "pilot_only", limitations: [...record.limitations, `pilot:${manifest.manifestId}`] };
}

export function attemptReviewerPromotion(input: {
  record: ReviewerQualification;
  acceptancePolicy: PilotAcceptancePolicy | null;
  humanValidationRecordRef: string | null;
  heldOutEvidenceComplete: boolean;
  declaredDimensions: string[];
}): ReviewerQualification {
  if (!input.acceptancePolicy?.approvedByHuman || !input.humanValidationRecordRef || !input.heldOutEvidenceComplete) {
    return { ...input.record, promotionStatus: "promotion_pending", limitations: [...new Set([...input.record.limitations, "promotion_pending"]) ] };
  }
  return {
    ...input.record,
    state: "VALIDATED_LIMITED",
    promotionStatus: "human_validated",
    humanRecordRef: input.humanValidationRecordRef,
    limitations: [...new Set([...input.record.limitations, `limited:${input.declaredDimensions.join(",")}`])],
  };
}

export const validateReviewerPromotion = attemptReviewerPromotion;

export function qualificationFingerprintChanged(
  record: ReviewerQualification,
  adapter: Pick<ReviewerAdapter, "identity" | "version" | "promptFingerprint">,
): boolean {
  return !record.fingerprint.startsWith(`${adapter.identity}:${adapter.version}:${adapter.promptFingerprint}:`);
}

export function pilotInputHash(variant: PilotVariant): string {
  return serializeReviewerInput(variant.input);
}

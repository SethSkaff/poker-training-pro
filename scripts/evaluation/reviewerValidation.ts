import type { ReviewerOutputV2 } from "./criticInput";
import type {
  PilotAcceptancePolicy,
  PilotCase,
  PilotRunResult,
  PilotVariant,
  ReviewerQualification,
} from "./reviewerPilot";

export interface ValidationGoldLabel {
  baseCaseId: string;
  strategicPlausibility: "concern" | "plausible" | "insufficient";
  source: "exact_verified" | "expert_adjudicated";
  raterRefs: string[];
  uncertain?: boolean;
}

export interface ValidationPromotionRecord {
  schemaVersion: 1;
  recordId: string;
  source: "fixture_only" | "human_validation";
  allowedDimensions: string[];
  allowedDomains: string[];
  evidenceRefs: string[];
  humanRecordRef: string | null;
  strategyAuthority: false;
  releaseGateAuthority: false;
  userGradeAuthority: false;
  status: "fixture_only" | "approved_limited" | "promotion_pending";
}

export interface ReviewerValidationResultV2 {
  schemaVersion: 1;
  reviewerFingerprint: string;
  pilotManifestId: string;
  baseCaseCount: number;
  transformationCount: number;
  repeatCount: number;
  confusion: Record<string, Record<string, number>>;
  precisionRecall: Record<string, { precision: number | null; recall: number | null; numerator: number; denominator: number }>;
  abstention: { count: number; denominator: number; rate: number | null };
  highPriorityFalsePositives: number;
  factualErrorCount: number;
  consistencyPairs: { compared: number; disagreements: number };
  confidenceBuckets: Record<string, number>;
  raterAgreement: { pairs: number; disagreements: number; status: "available" | "pending" };
  incrementalYield: { confirmedFindings: number; additionalMinutes: number | null; tokens: number | null; cost: number | null };
  status: "promotion_pending" | "baseline_establishment_only" | "limited_validated" | "invalid";
  missingEvidence: string[];
  promotionRecordRef: string | null;
}

function emptyConfusion(): Record<string, Record<string, number>> {
  return Object.fromEntries(["concern", "plausible", "insufficient"].map((label) => [label, { concern: 0, plausible: 0, insufficient: 0 }])) as Record<string, Record<string, number>>;
}

function outputFor(run: PilotRunResult, baseCaseId: string): ReviewerOutputV2 | null {
  const variant = run.variants.find((entry) => entry.baseCaseId === baseCaseId && entry.transform === "identity");
  return variant ? run.outputs.find((entry) => entry.variantId === variant.variantId)?.output ?? null : null;
}

function metric(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function validateReviewerPilot(input: {
  run: PilotRunResult;
  cases: readonly PilotCase[];
  goldLabels?: readonly ValidationGoldLabel[];
  acceptancePolicy?: PilotAcceptancePolicy | null;
  qualification: ReviewerQualification;
}): ReviewerValidationResultV2 {
  const goldByCase = new Map((input.goldLabels ?? []).map((label) => [label.baseCaseId, label]));
  const confusion = emptyConfusion();
  let compared = 0;
  let abstentions = 0;
  let highPriorityFalsePositives = 0;
  let factualErrors = 0;
  for (const entry of input.cases) {
    const gold = goldByCase.get(entry.baseCaseId);
    const output = outputFor(input.run, entry.baseCaseId);
    if (!gold || gold.uncertain || !output) continue;
    const predicted = output.assessments.strategicPlausibility;
    confusion[gold.strategicPlausibility][predicted] += 1;
    compared += 1;
    if (predicted === "insufficient") abstentions += 1;
    if (gold.strategicPlausibility === "plausible" && output.findings.some((finding) => finding.priority === "high")) highPriorityFalsePositives += 1;
    for (const finding of output.findings) if (finding.evidencePaths.some((path) => path.includes("truth") || path.includes("hidden"))) factualErrors += 1;
  }
  const precisionRecall = Object.fromEntries(["concern", "plausible"].map((label) => {
    const truePositive = confusion[label][label];
    const predicted = Object.values(confusion).reduce((sum, row) => sum + (row[label] ?? 0), 0);
    const actual = Object.values(confusion[label]).reduce((sum, value) => sum + value, 0);
    return [label, { precision: metric(truePositive, predicted), recall: metric(truePositive, actual), numerator: truePositive, denominator: actual }];
  }));
  const identityVariants = input.run.variants.filter((variant) => variant.transform === "identity");
  const transformed = input.run.variants.length - identityVariants.length;
  const repeatVariants = input.run.variants.filter((variant) => variant.transform === "identity");
  const missingEvidence: string[] = [];
  if (!input.goldLabels?.length) missingEvidence.push("qualified_human_or_exact_gold_labels");
  if (!input.acceptancePolicy?.approvedByHuman) missingEvidence.push("human_approved_acceptance_policy");
  if (input.run.status === "promotion_pending") missingEvidence.push(...input.run.missingEvidence);
  const hasComparableGold = (input.goldLabels ?? []).some((label) => !label.uncertain);
  const status = factualErrors > 0
    ? "invalid" as const
    : input.qualification.state === "VALIDATED_LIMITED" && missingEvidence.length === 0
      ? "limited_validated" as const
      : hasComparableGold
        ? "baseline_establishment_only" as const
        : "promotion_pending" as const;
  const comparableRaterLabels = (input.goldLabels ?? []).filter((label) => !label.uncertain);
  return {
    schemaVersion: 1,
    reviewerFingerprint: input.qualification.fingerprint,
    pilotManifestId: input.run.manifestId,
    baseCaseCount: identityVariants.length,
    transformationCount: transformed,
    repeatCount: repeatVariants.length,
    confusion,
    precisionRecall,
    abstention: { count: abstentions, denominator: compared, rate: metric(abstentions, compared) },
    highPriorityFalsePositives,
    factualErrorCount: factualErrors,
    consistencyPairs: { compared: transformed, disagreements: 0 },
    confidenceBuckets: { low: input.run.outputs.filter((entry) => entry.output?.findings.some((finding) => finding.confidence === "low")).length, medium: input.run.outputs.filter((entry) => entry.output?.findings.some((finding) => finding.confidence === "medium")).length, high: input.run.outputs.filter((entry) => entry.output?.findings.some((finding) => finding.confidence === "high")).length },
    raterAgreement: { pairs: comparableRaterLabels.reduce((sum, label) => sum + Math.max(0, label.raterRefs.length - 1), 0), disagreements: 0, status: comparableRaterLabels.some((label) => label.raterRefs.length > 1) ? "available" : "pending" },
    incrementalYield: { confirmedFindings: 0, additionalMinutes: null, tokens: null, cost: null },
    status,
    missingEvidence: [...new Set(missingEvidence)],
    promotionRecordRef: null,
  };
}

export const scoreReviewerPilot = validateReviewerPilot;

export function recordFixtureOnlyPromotion(input: {
  qualification: ReviewerQualification;
  dimensions: string[];
  domains: string[];
  evidenceRefs: string[];
}): ValidationPromotionRecord {
  return {
    schemaVersion: 1,
    recordId: `fixture-promotion:${input.qualification.fingerprint}`,
    source: "fixture_only",
    allowedDimensions: [...input.dimensions],
    allowedDomains: [...input.domains],
    evidenceRefs: [...input.evidenceRefs],
    humanRecordRef: null,
    strategyAuthority: false,
    releaseGateAuthority: false,
    userGradeAuthority: false,
    status: "fixture_only",
  };
}

export function assertNoPromotionFromModelMajority(result: ReviewerValidationResultV2): void {
  if (result.status === "limited_validated" && !result.promotionRecordRef) throw new Error("Limited validation requires an explicit promotion record");
}

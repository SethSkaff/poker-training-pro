import { createHash } from "node:crypto";
import { writeImmutableArtifact } from "./artifactStore";
import type { ArtifactRef, Split } from "./contracts";

export interface BaselineArtifact {
  schemaVersion: 1;
  baselineId: string;
  creationSourceRunRefs: ArtifactRef[];
  creationSourceChecksums: string[];
  schemaVersionRef: string;
  semanticsVersion: string;
  registryVersion: string;
  harnessVersion: string;
  policyIdentity: string;
  bankRef: ArtifactRef | null;
  splitRef: string;
  selectedMetrics: Record<string, { estimate: number | null; numerator: number | null; denominator: number | null; uncertainty: string | null }>;
  scope: string;
  objective: string;
  clock: string;
  comparisonEligibility: "matched" | "descriptive_only" | "incompatible";
  provenance: "descriptive_snapshot" | "approved_reference";
  promotionRecordRef: string | null;
  supersedes: string | null;
}

export interface HoldoutUsageEntry {
  schemaVersion: 1;
  usageId: string;
  holdoutRef: string;
  purpose: string;
  openedAt: string;
  runId: string;
  inspectedForTuning: boolean;
  status: "read_only" | "spent";
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, Object.keys(value as object).sort())).digest("hex");
}

export function createDescriptiveBaseline(input: Omit<BaselineArtifact, "baselineId" | "provenance" | "promotionRecordRef" | "supersedes"> & { supersedes?: string | null }): BaselineArtifact {
  const body = { ...input, supersedes: input.supersedes ?? null, provenance: "descriptive_snapshot" as const, promotionRecordRef: null };
  return { ...body, baselineId: `baseline:${hash(body)}` };
}

export async function writeBaselineArtifact(root: string, relativePath: string, baseline: BaselineArtifact): Promise<ArtifactRef> {
  if (!relativePath.includes("baseline")) throw new Error("Baseline artifact path must be under a baseline namespace");
  return writeImmutableArtifact({ root, relativePath, content: `${JSON.stringify(baseline, null, 2)}\n`, requireNew: true });
}

export async function writeHoldoutUsageEntry(root: string, entry: HoldoutUsageEntry): Promise<ArtifactRef> {
  return writeImmutableArtifact({ root, relativePath: `holdout-usage/${entry.usageId}.json`, content: `${JSON.stringify(entry, null, 2)}\n`, requireNew: true });
}

export function assertCalibrationInputAllowed(input: { split: Split; holdoutSpent?: boolean; purpose: string }): void {
  if (input.split === "holdout") throw new Error("Holdout artifacts cannot be used as calibration or baseline-writer input");
  if (input.holdoutSpent) throw new Error("Spent holdout artifacts cannot be used to tune a baseline");
  if (!input.purpose.trim()) throw new Error("Calibration purpose is required");
}

export function createHoldoutUsageEntry(input: Omit<HoldoutUsageEntry, "schemaVersion" | "usageId" | "status" | "inspectedForTuning"> & { inspectedForTuning?: boolean }): HoldoutUsageEntry {
  const inspectedForTuning = input.inspectedForTuning ?? false;
  const body = { ...input, inspectedForTuning, status: inspectedForTuning ? "spent" as const : "read_only" as const };
  return { ...body, schemaVersion: 1, usageId: `holdout-use:${hash(body)}` };
}

export function assertBaselinePromotionAllowed(input: { baseline: BaselineArtifact; promotionRecordRef: string | null; evidenceRefs: readonly string[] }): void {
  if (input.baseline.provenance === "approved_reference") throw new Error("Approved baseline records are immutable");
  if (!input.promotionRecordRef || input.evidenceRefs.length === 0) throw new Error("Promotion requires an explicit human record and evidence references");
}

export function assertNoExpectedValueRegeneration(input: { baselineHashBefore: string; baselineHashAfter: string; candidateWasUsedToWriteExpected: boolean }): void {
  if (input.candidateWasUsedToWriteExpected) throw new Error("Candidate output may not regenerate baseline expectations");
  if (input.baselineHashBefore !== input.baselineHashAfter) throw new Error("Baseline changed during comparison");
}

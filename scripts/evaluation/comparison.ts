import type { ArtifactRef } from "./contracts";
import type { EvaluationMetricResult, Interval, BaselineComparison } from "./report";
import { pairedHoeffdingInterval } from "./statistics";

export interface ComparisonRun {
  runId: string;
  semanticsVersion: string;
  registryVersion: string;
  sourceTreeHash: string;
  baselineRef: ArtifactRef;
  blocks: Record<string, Record<string, number>>;
  metrics: EvaluationMetricResult[];
}

export function compareRuns(baseline: ComparisonRun, candidate: ComparisonRun): BaselineComparison[] {
  const output: BaselineComparison[] = [];
  for (const candidateMetric of candidate.metrics) {
    const baselineMetric = baseline.metrics.find((metric) => metric.metricId === candidateMetric.metricId && metric.sliceId === candidateMetric.sliceId);
    const matchedBlockIds = Object.keys(candidate.blocks).filter((blockId) => baseline.blocks[blockId] !== undefined);
    const missingPairIds = Object.keys(candidate.blocks).filter((blockId) => baseline.blocks[blockId] === undefined);
    let status: BaselineComparison["status"] = "diagnostic_only";
    let comparability: BaselineComparison["comparability"] = "descriptive_only";
    let reasons: string[] = [];
    let delta: BaselineComparison["deltaCandidateMinusBaseline"] = { value: null, reason: "missing_baseline" };
    let interval: BaselineComparison["interval"] = { value: null, reason: "missing_baseline" };
    if (!baselineMetric) reasons.push("metric_missing_from_baseline");
    else if (baseline.semanticsVersion !== candidate.semanticsVersion || baseline.registryVersion !== candidate.registryVersion) {
      comparability = "incompatible";
      status = "invalid_run";
      reasons.push("semantics_or_registry_mismatch");
    } else if (matchedBlockIds.length === 0) {
      reasons.push("no_matched_blocks");
    } else if (candidateMetric.estimate.value === null || baselineMetric.estimate.value === null) {
      reasons.push("sparse_or_unvisited_metric");
    } else {
      comparability = "matched";
      const value = candidateMetric.estimate.value - baselineMetric.estimate.value;
      delta = { value, reason: null };
      const differences = matchedBlockIds.map((blockId) => (candidate.blocks[blockId][candidateMetric.metricId] ?? 0) - (baseline.blocks[blockId][candidateMetric.metricId] ?? 0));
      const bound = pairedHoeffdingInterval(differences, -1, 1);
      interval = bound ? { value: bound, reason: null } : { value: null, reason: "sparse" };
      status = "diagnostic_only";
      reasons = missingPairIds.length ? ["missing_pairs_excluded"] : [];
    }
    output.push({ schemaVersion: 1, baselineRef: baseline.baselineRef, candidateRunId: candidate.runId, comparability, reasons, matchedBlockIds, missingPairIds, metricId: candidateMetric.metricId, sliceId: candidateMetric.sliceId, deltaCandidateMinusBaseline: delta, interval, practicalMargin: { value: null, reason: "no_approved_margin" }, marginEvidenceRef: null, multiplicityFamilyId: null, status });
  }
  return output;
}

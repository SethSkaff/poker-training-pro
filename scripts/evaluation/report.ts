import type { ArtifactRef, Maybe } from "./contracts";

export interface Interval {
  lower: number;
  upper: number;
  level: number;
  method: "exact" | "wilson" | "zero_event_exact" | "cluster_bootstrap_percentile" | "paired_hoeffding";
  independentUnit: "block" | "base_case" | "scenario_family" | "iid_draw";
}

export interface EvaluationMetricResult {
  schemaVersion: 1;
  metricId: string;
  definitionVersion: string;
  runId: string;
  policyId: string;
  sliceId: string;
  estimand: string;
  unit: "proportion" | "BB" | "chips" | "count" | "hands" | "ms" | "bits";
  numerator: number | null;
  denominator: number | null;
  estimate: Maybe<number>;
  interval: Maybe<Interval>;
  distinctDecisions: number;
  distinctHands: number;
  independentBlocks: number;
  effectiveN: Maybe<number>;
  missingCount: number;
  pendingCount: number;
  coverage: "adequate" | "sparse" | "unvisited" | "impossible" | "invalid";
  authority: "contract" | "diagnostic" | "approved_regression" | "retired";
  status: "pass" | "regression" | "insufficient_evidence" | "invalid_run" | "unsupported_reference" | "diagnostic_only";
  registryRef: ArtifactRef;
  supportingEventRefs: ArtifactRef[];
}

export interface BaselineComparison {
  schemaVersion: 1;
  baselineRef: ArtifactRef;
  candidateRunId: string;
  comparability: "matched" | "descriptive_only" | "incompatible";
  reasons: string[];
  matchedBlockIds: string[];
  missingPairIds: string[];
  metricId: string;
  sliceId: string;
  deltaCandidateMinusBaseline: Maybe<number>;
  interval: Maybe<Interval>;
  practicalMargin: Maybe<number>;
  marginEvidenceRef: ArtifactRef | null;
  multiplicityFamilyId: string | null;
  status: EvaluationMetricResult["status"];
}

export interface ActionAuditRow {
  canonicalKind: "fold" | "check" | "call" | "bet" | "raise";
  encounterId: string;
  familyId: string;
  blockId: string;
  objective: string;
  gradeEligible: boolean;
  gradeReason: string;
  supportStatus: string;
  regretLower: number | null;
  regretUpper: number | null;
  grade: "excellent" | "supported_loss" | null;
  traceLink: string | null;
  decisionStatus: string;
}

export interface ActionAuditReport {
  schemaVersion: 1;
  encountered: number;
  statusCounts: Record<string, number>;
  byCategory: Record<string, {
    category: string;
    encountered: number;
    gradeEligible: number;
    supported: number;
    statusCounts: Record<string, number>;
    exclusionReasons: Record<string, number>;
    regretLower: number[];
    regretUpper: number[];
    gradeCounts: { excellent: number; supported_loss: number; null: number };
    traceAvailable: number;
    families: number;
    blocks: number;
  }>;
}

export interface EvaluationReport {
  schemaVersion: 1;
  runId: string;
  status: "complete" | "insufficient_evidence" | "invalid_run";
  scope: "hero" | "full-field";
  clock: "frozen" | "nominal-live";
  objective: "chip" | "payout" | "qualification";
  coverage: { total: number; finalized: number; missing: number; pending: number; status: "adequate" | "sparse" | "unvisited" };
  metrics: EvaluationMetricResult[];
  actionAudit: ActionAuditReport | null;
  pendingEvidence: string[];
  flags: Array<{ id: string; reasonCodes: string[]; findingState: string; traceRef: string | null }>;
}

export function renderEvaluationReport(report: EvaluationReport): string {
  const lines = [
    `# Poker behavioral evaluation ${report.runId}`,
    "",
    `Status: **${report.status}**`,
    `Scope: ${report.scope}; clock: ${report.clock}; objective: ${report.objective}`,
    `Coverage: ${report.coverage.finalized}/${report.coverage.total} finalized; pending ${report.coverage.pending}; missing ${report.coverage.missing} (${report.coverage.status})`,
    "",
    "## Metrics",
  ];
  for (const metric of report.metrics) {
    const estimate = metric.estimate.value === null ? `unavailable (${metric.estimate.reason})` : metric.estimate.value.toFixed(6);
    const interval = metric.interval.value ? `[${metric.interval.value.lower.toFixed(6)}, ${metric.interval.value.upper.toFixed(6)}]` : "unavailable";
    lines.push(`- ${metric.metricId}: ${estimate}; interval ${interval}; authority ${metric.authority}; status ${metric.status}`);
  }
  if (report.actionAudit) {
    lines.push("", "## Action-category audit");
    for (const [category, value] of Object.entries(report.actionAudit.byCategory)) {
      lines.push(`- ${category}: encountered ${value.encountered}, grade eligible ${value.gradeEligible}, traced ${value.traceAvailable}`);
    }
  }
  lines.push("", "## Pending empirical evidence");
  for (const item of report.pendingEvidence) lines.push(`- ${item}`);
  return `${lines.join("\n")}\n`;
}

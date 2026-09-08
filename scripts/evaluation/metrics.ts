import type { BehavioralDecisionEvent } from "./decisionEvent";
import type { OpportunityReduction } from "./opportunities";
import type { ArtifactRef, Maybe } from "./contracts";
import { clusterBootstrap, wilsonInterval, type ClusterObservation } from "./statistics";
import type { ActionAuditReport, ActionAuditRow, EvaluationMetricResult, Interval } from "./report";

function ref(label: string): ArtifactRef {
  return { relativePath: `evaluation/${label}`, sha256: "0".repeat(64), bytes: 0 };
}

export interface BehaviorAggregate {
  runId: string;
  policyId: string;
  totalEvents: number;
  finalizedEvents: number;
  invalidEvents: number;
  distinctHands: number;
  independentBlocks: number;
  actionCounts: Record<"fold" | "check" | "call" | "bet" | "raise", number>;
  stackOffCounts: { aggressiveJam: number; allInCall: number };
  coverage: {
    eligible: number;
    finalized: number;
    missing: number;
    pending: number;
    status: "adequate" | "sparse" | "unvisited";
  };
  commitmentTail: Record<string, { count: number; probabilityMass: number | null }>;
  metrics: EvaluationMetricResult[];
  opportunityReduction?: OpportunityReduction;
}

function metric(
  runId: string,
  policyId: string,
  metricId: string,
  estimate: number | null,
  numerator: number | null,
  denominator: number | null,
  distinctDecisions: number,
  distinctHands: number,
  independentBlocks: number,
  missingCount = 0,
  pendingCount = 0,
  interval: Interval | null = null,
  status: EvaluationMetricResult["status"] = estimate === null ? "insufficient_evidence" : "diagnostic_only",
): EvaluationMetricResult {
  const maybe: Maybe<number> = estimate === null ? { value: null, reason: denominator === 0 ? "unvisited" : "insufficient_evidence" } : { value: estimate, reason: null };
  return {
    schemaVersion: 1,
    metricId,
    definitionVersion: "v1",
    runId,
    policyId,
    sliceId: "all",
    estimand: metricId,
    unit: "proportion",
    numerator,
    denominator,
    estimate: maybe,
    interval: interval ? { value: interval, reason: null } : { value: null, reason: "insufficient_or_clustered" },
    distinctDecisions,
    distinctHands,
    independentBlocks,
    effectiveN: independentBlocks > 0 ? { value: independentBlocks, reason: null } : { value: null, reason: "no_independent_blocks" },
    missingCount,
    pendingCount,
    coverage: denominator === 0 ? "unvisited" : missingCount > 0 || pendingCount > 0 ? "sparse" : "adequate",
    authority: "diagnostic",
    status,
    registryRef: ref(`registry/${metricId}.json`),
    supportingEventRefs: [],
  };
}

export function aggregateBehavior(
  events: readonly BehavioralDecisionEvent[],
  options: { runId?: string; policyId?: string; clusters?: readonly ClusterObservation[]; opportunityReduction?: OpportunityReduction } = {},
): BehaviorAggregate {
  const runId = options.runId ?? "evaluation-run";
  const policyId = options.policyId ?? events[0]?.policy.id ?? "unknown-policy";
  const finalized = events.filter((event) => event.execution === "observed" && event.postcondition.status === "pass");
  const invalid = events.filter((event) => event.postcondition.status === "fail");
  const actionCounts = { fold: 0, check: 0, call: 0, bet: 0, raise: 0 } as BehaviorAggregate["actionCounts"];
  const stackOffCounts = { aggressiveJam: 0, allInCall: 0 };
  for (const event of finalized) {
    actionCounts[event.chosen.kind] += 1;
    if (event.chosen.stackOffClass === "aggressive_jam") stackOffCounts.aggressiveJam += 1;
    if (event.chosen.stackOffClass === "all_in_call") stackOffCounts.allInCall += 1;
  }
  const hands = new Set(finalized.map((event) => event.reproduction.handId));
  const blocks = new Set(finalized.map((event) => event.reproduction.blockId));
  const clusters = options.clusters ?? [...blocks].map((blockId) => ({ blockId, numerator: finalized.filter((event) => event.reproduction.blockId === blockId && event.chosen.stackOffClass === "aggressive_jam").length, denominator: finalized.filter((event) => event.reproduction.blockId === blockId).length }));
  const jamCount = stackOffCounts.aggressiveJam;
  const jamInterval = clusters.length >= 30 ? clusterBootstrap(clusters).interval : null;
  const metrics = [
    metric(runId, policyId, "action.aggressiveJam", finalized.length ? jamCount / finalized.length : null, jamCount, finalized.length, finalized.length, hands.size, blocks.size, events.length - finalized.length, invalid.length, jamInterval),
  ];
  return {
    runId,
    policyId,
    totalEvents: events.length,
    finalizedEvents: finalized.length,
    invalidEvents: invalid.length,
    distinctHands: hands.size,
    independentBlocks: blocks.size,
    actionCounts,
    stackOffCounts,
    coverage: { eligible: events.length, finalized: finalized.length, missing: events.length - finalized.length, pending: events.filter((event) => event.postcondition.status !== "pass").length, status: finalized.length === 0 ? "unvisited" : finalized.length < events.length ? "sparse" : "adequate" },
    commitmentTail: Object.fromEntries([0.25, 0.5, 0.75, 0.9, 1].map((threshold) => {
      const matches = finalized.filter((event) => event.geometry.actorCommitmentFraction >= threshold);
      return [String(threshold), { count: matches.length, probabilityMass: finalized.length ? matches.reduce((sum, event) => sum + (event.candidates.find((candidate) => candidate.action.key === event.chosen.key)?.selectionProbability.value ?? 0), 0) : null }];
    })),
    metrics,
    opportunityReduction: options.opportunityReduction,
  };
}

export interface ActionAuditInput {
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

export function aggregateActionAudit(rows: readonly ActionAuditInput[]): ActionAuditReport {
  const categories = ["fold", "check", "call", "bet", "raise"] as const;
  const byCategory = Object.fromEntries(categories.map((category) => {
    const entries = rows.filter((row) => row.canonicalKind === category);
    const statusCounts: Record<string, number> = {};
    for (const row of entries) statusCounts[row.decisionStatus] = (statusCounts[row.decisionStatus] ?? 0) + 1;
    const eligible = entries.filter((row) => row.gradeEligible);
    return [category, {
      category,
      encountered: entries.length,
      gradeEligible: eligible.length,
      supported: entries.filter((row) => row.supportStatus === "supported").length,
      statusCounts,
      exclusionReasons: Object.fromEntries(entries.filter((row) => !row.gradeEligible).map((row) => [row.gradeReason, entries.filter((candidate) => !candidate.gradeEligible && candidate.gradeReason === row.gradeReason).length])),
      regretLower: entries.map((row) => row.regretLower).filter((value): value is number => value !== null),
      regretUpper: entries.map((row) => row.regretUpper).filter((value): value is number => value !== null),
      gradeCounts: { excellent: entries.filter((row) => row.grade === "excellent").length, supported_loss: entries.filter((row) => row.grade === "supported_loss").length, null: entries.filter((row) => row.grade === null).length },
      traceAvailable: entries.filter((row) => row.traceLink !== null).length,
      families: new Set(entries.map((row) => row.familyId)).size,
      blocks: new Set(entries.map((row) => row.blockId)).size,
    }];
  })) as ActionAuditReport["byCategory"];
  return { schemaVersion: 1, encountered: rows.length, statusCounts: Object.fromEntries([...new Set(rows.map((row) => row.decisionStatus))].map((status) => [status, rows.filter((row) => row.decisionStatus === status).length])), byCategory };
}

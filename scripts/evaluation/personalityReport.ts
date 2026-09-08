import { NORMAL_OPPONENT_PROFILES } from "../../src/modes/normal";
import type { StyleContractObservation } from "./personalities";

export type PersonalityDimension =
  | "continue_propensity"
  | "raise_given_continue"
  | "opening_defending_three_bet"
  | "wager_magnitude"
  | "actor_commitment"
  | "purpose_mix"
  | "size_recurrence"
  | "observed_tendency_response";

export interface GroupedInterval {
  group: string;
  count: number;
  mean: number | null;
  lower: number | null;
  upper: number | null;
  lowData: boolean;
}

export interface PersonalityDimensionReport {
  dimension: PersonalityDimension;
  source: "normal_selection" | "reference_labeled" | "policy_labeled" | "descriptive";
  value: number | null;
  intervals: GroupedInterval[];
  lowData: boolean;
}

export interface PersonalityComparison {
  schemaVersion: 1;
  profileKey: keyof typeof NORMAL_OPPONENT_PROFILES;
  profileId: string;
  observationCount: number;
  nodeCount: number;
  occupancyWeight: number;
  dimensions: PersonalityDimensionReport[];
  normalProbabilityByCategory: Record<string, number>;
  rationalProbabilityByCategory: Record<string, number> | null;
  rationalStatus: "available" | "unavailable";
  probabilityDeltaByCategory: Record<string, number> | null;
  jsDivergenceVsRational: number | null;
  jsDivergenceVsProfiles: Record<string, number>;
  negativeControls: { forcedActionAgreement: number | null; clearValueAgreement: number | null };
  classifierStatus: "not_run" | "diagnostic";
  lowData: boolean;
  missingEvidence: string[];
}

export interface PersonalityReport {
  schemaVersion: 1;
  scope: { targetNodesPerProfile: number; targetReplicas: number; targetSessionBlocks: number; actualProfiles: number };
  comparisons: PersonalityComparison[];
  convergence: "descriptive" | "unresolved";
  missingEvidence: string[];
}

function actionCategory(key: string): string {
  const type = key.split(":", 1)[0];
  if (type === "all-in" || type === "raise" || type === "bet") return "raise";
  if (type === "call") return "call";
  if (type === "fold") return "fold";
  return "check";
}

export function canonicalNormalCategory(key: string): string {
  return actionCategory(key);
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function groupedIntervals(observations: readonly StyleContractObservation[], value: (entry: StyleContractObservation) => number | null): GroupedInterval[] {
  const groups = new Map<string, number[]>();
  for (const entry of observations) {
    const candidate = value(entry);
    if (candidate === null) continue;
    const list = groups.get(entry.context) ?? [];
    list.push(candidate);
    groups.set(entry.context, list);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([group, values]) => {
    const average = mean(values);
    const margin = values.length > 1 && average !== null ? 1.96 * Math.sqrt(values.reduce((sum, item) => sum + (item - average) ** 2, 0) / (values.length - 1)) / Math.sqrt(values.length) : null;
    return { group, count: values.length, mean: average, lower: margin === null || average === null ? average : average - margin, upper: margin === null || average === null ? average : average + margin, lowData: values.length < 8 };
  });
}

function distribution(observations: readonly StyleContractObservation[]): Record<string, number> {
  const sums = new Map<string, number>();
  let total = 0;
  for (const observation of observations) {
    const weight = observation.occupancyWeight ?? 1;
    for (const entry of observation.decision.selectionDistribution.entries) {
      sums.set(actionCategory(entry.key), (sums.get(actionCategory(entry.key)) ?? 0) + entry.probability * weight);
    }
    total += weight;
  }
  return Object.fromEntries([...sums.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, total > 0 ? value / total : 0]));
}

function rationalDistribution(observations: readonly StyleContractObservation[]): Record<string, number> | null {
  if (observations.length === 0 || observations.some((entry) => !entry.rationalDistribution)) return null;
  const sums = new Map<string, number>();
  let total = 0;
  for (const observation of observations) {
    const weight = observation.occupancyWeight ?? 1;
    for (const [key, probability] of Object.entries(observation.rationalDistribution ?? {})) sums.set(actionCategory(key), (sums.get(actionCategory(key)) ?? 0) + probability * weight);
    total += weight;
  }
  return Object.fromEntries([...sums.entries()].map(([key, value]) => [key, total > 0 ? value / total : 0]));
}

function normalizeDistribution(value: Readonly<Record<string, number>>): Record<string, number> {
  const keys = Object.keys(value).sort();
  const total = keys.reduce((sum, key) => sum + Math.max(0, value[key] ?? 0), 0);
  return Object.fromEntries(keys.map((key) => [key, total > 0 ? Math.max(0, value[key] ?? 0) / total : 0]));
}

export function jensenShannonDivergence(left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>): number {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const a = normalizeDistribution(Object.fromEntries(keys.map((key) => [key, left[key] ?? 0])));
  const b = normalizeDistribution(Object.fromEntries(keys.map((key) => [key, right[key] ?? 0])));
  const midpoint = Object.fromEntries(keys.map((key) => [key, ((a[key] ?? 0) + (b[key] ?? 0)) / 2]));
  const kl = (source: Readonly<Record<string, number>>) => keys.reduce((sum, key) => {
    const p = source[key] ?? 0;
    const m = midpoint[key] ?? 0;
    return sum + (p > 0 && m > 0 ? p * Math.log2(p / m) : 0);
  }, 0);
  return (kl(a) + kl(b)) / 2;
}

function dimensions(observations: readonly StyleContractObservation[]): PersonalityDimensionReport[] {
  const metric = (dimension: PersonalityDimension, source: PersonalityDimensionReport["source"], value: (entry: StyleContractObservation) => number | null): PersonalityDimensionReport => {
    const intervals = groupedIntervals(observations, value);
    return { dimension, source, value: mean(observations.map(value).filter((candidate): candidate is number => candidate !== null)), intervals, lowData: observations.length < 8 || intervals.some((entry) => entry.lowData) };
  };
  return [
    metric("continue_propensity", "normal_selection", (entry) => 1 - (entry.decision.selectionDistribution.entries.find((item) => actionCategory(item.key) === "fold")?.probability ?? 0)),
    metric("raise_given_continue", "normal_selection", (entry) => {
      const continueProbability = 1 - (entry.decision.selectionDistribution.entries.find((item) => actionCategory(item.key) === "fold")?.probability ?? 0);
      const raiseProbability = entry.decision.selectionDistribution.entries.filter((item) => actionCategory(item.key) === "raise").reduce((sum, item) => sum + item.probability, 0);
      return continueProbability > 0 ? raiseProbability / continueProbability : null;
    }),
    metric("opening_defending_three_bet", "normal_selection", (entry) => entry.context === "opening" || entry.context === "defending" || entry.context === "three_bet" ? (entry.decision.selectionDistribution.entries.filter((item) => actionCategory(item.key) === "raise").reduce((sum, item) => sum + item.probability, 0)) : null),
    metric("wager_magnitude", "descriptive", (entry) => entry.potChips > 0 ? entry.decision.selectionDistribution.entries.reduce((sum, item) => sum + item.probability * (item.command.to ?? 0) / entry.potChips, 0) : null),
    metric("actor_commitment", "descriptive", (entry) => entry.actorStackChips > 0 ? entry.decision.selectionDistribution.entries.reduce((sum, item) => sum + item.probability * (item.command.to ?? 0) / entry.actorStackChips, 0) : null),
    metric("purpose_mix", "reference_labeled", (entry) => entry.referenceSource === "pending" ? null : entry.decision.selectionDistribution.entries.reduce((sum, item) => sum + item.probability * (item.purpose === "value" || item.purpose === "thin-value" ? 1 : 0), 0)),
    metric("size_recurrence", "descriptive", (entry) => entry.decision.selectionDistribution.entries.filter((item) => item.probability > 0).length > 0 ? entry.decision.selectionDistribution.entries.reduce((sum, item) => sum + item.probability * (item.command.to ?? 0), 0) : null),
    metric("observed_tendency_response", "normal_selection", (entry) => entry.decision.adaptationPressure),
  ];
}

function compareOne(profileKey: keyof typeof NORMAL_OPPONENT_PROFILES, observations: readonly StyleContractObservation[], all: ReadonlyMap<string, readonly StyleContractObservation[]>): PersonalityComparison {
  const normalProbabilityByCategory = distribution(observations);
  const rational = rationalDistribution(observations);
  const categories = Object.keys(normalProbabilityByCategory);
  const probabilityDeltaByCategory = rational ? Object.fromEntries([...new Set([...categories, ...Object.keys(rational)])].sort().map((category) => [category, (normalProbabilityByCategory[category] ?? 0) - (rational[category] ?? 0)])) : null;
  const jsDivergenceVsProfiles = Object.fromEntries([...all.entries()].filter(([key]) => key !== profileKey).map(([key, rows]) => [NORMAL_OPPONENT_PROFILES[key as keyof typeof NORMAL_OPPONENT_PROFILES].id, jensenShannonDivergence(normalProbabilityByCategory, distribution(rows))]));
  const controls = (predicate: (entry: StyleContractObservation) => boolean): number | null => {
    const rows = observations.filter(predicate);
    if (rows.length === 0) return null;
    const bestKeys = rows.map((entry) => entry.decision.selectionDistribution.bestActionKey);
    return bestKeys.filter((key) => rows.some((entry) => entry.decision.selectionDistribution.entries.some((item) => item.key === key && item.probability >= 0.999999))).length / rows.length;
  };
  const missingEvidence: string[] = [];
  if (observations.length < 300) missingEvidence.push("target_300_common_nodes_per_profile");
  if (observations.some((entry) => entry.referenceSource === "pending")) missingEvidence.push("reference_or_policy_labels_for_purpose_dimensions");
  if (!rational) missingEvidence.push("rational_conditional_distribution");
  return {
    schemaVersion: 1,
    profileKey,
    profileId: NORMAL_OPPONENT_PROFILES[profileKey].id,
    observationCount: observations.length,
    nodeCount: new Set(observations.map((entry) => entry.nodeId)).size,
    occupancyWeight: observations.reduce((sum, entry) => sum + (entry.occupancyWeight ?? 1), 0),
    dimensions: dimensions(observations),
    normalProbabilityByCategory,
    rationalProbabilityByCategory: rational,
    rationalStatus: rational ? "available" : "unavailable",
    probabilityDeltaByCategory,
    jsDivergenceVsRational: rational ? jensenShannonDivergence(normalProbabilityByCategory, rational) : null,
    jsDivergenceVsProfiles,
    negativeControls: { forcedActionAgreement: controls((entry) => entry.forcedAction === true), clearValueAgreement: controls((entry) => entry.clearValueAnchor === true) },
    classifierStatus: "not_run",
    lowData: observations.length < 8,
    missingEvidence,
  };
}

export function comparePersonalities(input: {
  observations: readonly StyleContractObservation[];
  targetNodesPerProfile?: number;
  targetReplicas?: number;
  targetSessionBlocks?: number;
}): PersonalityReport {
  const grouped = new Map<keyof typeof NORMAL_OPPONENT_PROFILES, StyleContractObservation[]>();
  for (const observation of input.observations) {
    const rows = grouped.get(observation.profileKey) ?? [];
    rows.push(observation);
    grouped.set(observation.profileKey, rows);
  }
  const comparisons = [...grouped.entries()].map(([key, rows]) => compareOne(key, rows, grouped));
  const missingEvidence = [...new Set(comparisons.flatMap((entry) => entry.missingEvidence))];
  return {
    schemaVersion: 1,
    scope: { targetNodesPerProfile: input.targetNodesPerProfile ?? 300, targetReplicas: input.targetReplicas ?? 8, targetSessionBlocks: input.targetSessionBlocks ?? 30, actualProfiles: grouped.size },
    comparisons,
    convergence: input.observations.length > 0 ? "descriptive" : "unresolved",
    missingEvidence,
  };
}

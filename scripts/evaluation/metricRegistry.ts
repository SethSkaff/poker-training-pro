export type MetricAuthority = "contract" | "diagnostic" | "approved_regression" | "retired";

export interface MetricRegistryEntry {
  metricId: string;
  definitionVersion: string;
  estimand: string;
  denominator: string;
  conditioning: string;
  origin: string;
  authority: MetricAuthority;
  sampleRequirement: string;
  practicalMargin: number | null;
  uncertaintyMethod: string;
  owner: string;
  releaseGate: boolean;
  retirementReason?: string;
}

export const METRIC_REGISTRY: readonly MetricRegistryEntry[] = [
  {
    metricId: "mechanical.transition",
    definitionVersion: "v1",
    estimand: "independent transition validity",
    denominator: "all finalized actions",
    conditioning: "legal engine states",
    origin: "implementation contract A02",
    authority: "contract",
    sampleRequirement: "every action",
    practicalMargin: 0,
    uncertaintyMethod: "exact",
    owner: "T2",
    releaseGate: true,
  },
  {
    metricId: "player_hand.vpip",
    definitionVersion: "v1",
    estimand: "binary voluntary entry per dealt player-hand",
    denominator: "dealt_hand",
    conditioning: "preflop voluntary call/bet/raise",
    origin: "implementation contract 5.2",
    authority: "diagnostic",
    sampleRequirement: "registry precision rule",
    practicalMargin: null,
    uncertaintyMethod: "wilson",
    owner: "T3",
    releaseGate: false,
  },
  {
    metricId: "legacy.facingCallRate",
    definitionVersion: "legacy-v1",
    estimand: "historical facing-decision call fraction",
    denominator: "legacy preflop/action rows",
    conditioning: "historical measurement script",
    origin: "scripts/audit-ai-behavior-gates.ts 2026-07 bands",
    authority: "retired",
    sampleRequirement: "historical report only",
    practicalMargin: null,
    uncertaintyMethod: "unsupported",
    owner: "T3",
    releaseGate: false,
    retirementReason: "The old 20%-65% band was an unsupported realism quota with mixed opportunities; retain its observed value only as a retired diagnostic.",
  },
  {
    metricId: "legacy.normalRationalRaiseGap",
    definitionVersion: "legacy-v1",
    estimand: "absolute raise-back gap between modes",
    denominator: "legacy mixed opportunity population",
    conditioning: "legacy audit run",
    origin: "scripts/audit-ai-behavior-gates.ts E12-001",
    authority: "retired",
    sampleRequirement: "historical report only",
    practicalMargin: null,
    uncertaintyMethod: "unsupported",
    owner: "T3",
    releaseGate: false,
    retirementReason: "A three-point separation quota rewards artificial style divergence and lacks human/competence evidence.",
  },
];

export function evaluateMetricAuthority(metricId: string): MetricRegistryEntry {
  const entry = METRIC_REGISTRY.find((candidate) => candidate.metricId === metricId);
  if (!entry) throw new Error(`Metric ${metricId} is not registered`);
  return entry;
}

export function assertNoUnsupportedReleaseQuota(): void {
  const unsupported = METRIC_REGISTRY.filter((entry) => entry.authority === "retired" && entry.releaseGate);
  if (unsupported.length) throw new Error(`Retired metrics cannot be release gates: ${unsupported.map((entry) => entry.metricId).join(", ")}`);
}

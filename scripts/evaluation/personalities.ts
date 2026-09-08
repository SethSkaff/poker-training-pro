import {
  NORMAL_OPPONENT_PROFILES,
  type NormalDecision,
  type NormalOpponentProfile,
} from "../../src/modes/normal";

export type StyleLabel = "profile_a" | "profile_b" | "same" | "abstain";
export type StyleEvidenceSource = "reference" | "policy" | "human" | "pending";

export interface StyleContractObservation {
  nodeId: string;
  familyId: string;
  sessionId: string;
  profileKey: keyof typeof NORMAL_OPPONENT_PROFILES;
  decision: NormalDecision;
  context: "opening" | "defending" | "three_bet" | "postflop" | "river" | "other";
  potChips: number;
  actorStackChips: number;
  rationalDistribution?: Readonly<Record<string, number>>;
  referenceSource: StyleEvidenceSource;
  forcedAction?: boolean;
  clearValueAnchor?: boolean;
  occupancyWeight?: number;
  publicFeatures: Readonly<Record<string, number>>;
}

export interface StyleContract {
  profileKey: keyof typeof NORMAL_OPPONENT_PROFILES;
  profileId: string;
  name: string;
  description: string;
  personality: NormalOpponentProfile["personality"];
  competenceRate: number;
  maxEvLossBb: number;
}

export interface StyleContractBundle {
  schemaVersion: 1;
  bankVersion: string;
  target: { commonNodesPerProfile: number; equityReplicas: number; sessionBlocks: number };
  contracts: StyleContract[];
  observations: StyleContractObservation[];
  missingEvidence: string[];
}

export interface BlindedStyleCase {
  caseId: string;
  familyAlias: string;
  features: Record<string, number>;
  actionDistribution: Record<string, number>;
  expectedLabel: null;
}

export interface BlindedStyleBundle {
  schemaVersion: 1;
  bundleId: string;
  cases: BlindedStyleCase[];
  featureNames: string[];
  labels: null;
  redactionPolicy: "public_features_only";
}

export interface ImportedStyleLabel {
  caseId: string;
  label: StyleLabel;
  confidence: "low" | "medium" | "high" | "abstain";
  raterRef: string;
}

export interface StyleLabelImport {
  schemaVersion: 1;
  labels: ImportedStyleLabel[];
  missingEvidence: string[];
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function profileContracts(): StyleContract[] {
  return Object.entries(NORMAL_OPPONENT_PROFILES).map(([profileKey, profile]) => ({
    profileKey: profileKey as keyof typeof NORMAL_OPPONENT_PROFILES,
    profileId: profile.id,
    name: profile.name,
    description: profile.description,
    personality: { ...profile.personality },
    competenceRate: profile.competenceRate,
    maxEvLossBb: profile.maxEvLossBb,
  }));
}

export function buildStyleContracts(input: {
  observations?: readonly StyleContractObservation[];
  bankVersion?: string;
  commonNodesPerProfile?: number;
  equityReplicas?: number;
  sessionBlocks?: number;
} = {}): StyleContractBundle {
  const observations = [...(input.observations ?? [])].map((entry) => ({
    ...entry,
    decision: structuredClone(entry.decision),
    publicFeatures: { ...entry.publicFeatures },
    ...(entry.rationalDistribution ? { rationalDistribution: { ...entry.rationalDistribution } } : {}),
  }));
  return {
    schemaVersion: 1,
    bankVersion: input.bankVersion ?? "personality-bank-pending",
    target: {
      commonNodesPerProfile: input.commonNodesPerProfile ?? 300,
      equityReplicas: input.equityReplicas ?? 8,
      sessionBlocks: input.sessionBlocks ?? 30,
    },
    contracts: profileContracts(),
    observations,
    missingEvidence: observations.length === 0 ? ["normal_common_state_observations"] : [],
  };
}

function assertSafeFeatureName(name: string): void {
  if (/profile|name|seed|mode|outcome|result|hole|private|hidden|opponent|truth|id/i.test(name)) {
    throw new Error(`Style classifier feature leaks prohibited metadata: ${name}`);
  }
}

export function exportBlindedStyleBundle(input: {
  observations: readonly StyleContractObservation[];
  bundleId?: string;
}): BlindedStyleBundle {
  const featureNames = [...new Set(input.observations.flatMap((entry) => Object.keys(entry.publicFeatures)))].sort();
  featureNames.forEach(assertSafeFeatureName);
  const cases = input.observations.map((entry, index) => ({
    caseId: `style-case-${hash(`${input.bundleId ?? "style-bundle"}:${entry.familyId}:${entry.nodeId}:${index}`)}`,
    familyAlias: `family-${hash(entry.familyId)}`,
    features: Object.fromEntries(featureNames.map((name) => [name, entry.publicFeatures[name] ?? 0])),
    actionDistribution: Object.fromEntries(entry.decision.selectionDistribution.entries.map((item) => [item.key, item.probability])),
    expectedLabel: null,
  }));
  return {
    schemaVersion: 1,
    bundleId: input.bundleId ?? `style-bundle:${hash(String(cases.length))}`,
    cases,
    featureNames,
    labels: null,
    redactionPolicy: "public_features_only",
  };
}

export function importStyleLabels(bundle: BlindedStyleBundle, labels: readonly ImportedStyleLabel[]): StyleLabelImport {
  const known = new Set(bundle.cases.map((entry) => entry.caseId));
  for (const label of labels) {
    if (!known.has(label.caseId)) throw new Error(`Style label references unknown case ${label.caseId}`);
    if (!label.raterRef || label.label === undefined) throw new Error("Style label requires a rater reference and label");
  }
  return {
    schemaVersion: 1,
    labels: labels.map((label) => ({ ...label })),
    missingEvidence: labels.length === 0 ? ["blinded_human_style_labels"] : [],
  };
}

interface StandardizedFeatureSet {
  names: string[];
  means: Record<string, number>;
  scales: Record<string, number>;
}

function standardizeFeatures(rows: readonly BlindedStyleCase[]): StandardizedFeatureSet {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row.features)))].sort();
  const means: Record<string, number> = {};
  const scales: Record<string, number> = {};
  for (const name of names) {
    const values = rows.map((row) => row.features[name] ?? 0);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
    means[name] = mean;
    scales[name] = Math.sqrt(variance) || 1;
  }
  return { names, means, scales };
}

export interface StyleClassifierResult {
  status: "available" | "pending";
  trainCases: number;
  testCases: number;
  correct: number;
  accuracy: number | null;
  permutationAccuracy: number | null;
  groupedFamilies: number;
  missingEvidence: string[];
}

export function fitNearestCentroidStyleClassifier(input: {
  rows: readonly StyleContractObservation[];
  heldOutFamilyIds?: readonly string[];
  permutationLabels?: readonly (keyof typeof NORMAL_OPPONENT_PROFILES)[];
}): StyleClassifierResult {
  const heldOut = new Set(input.heldOutFamilyIds ?? []);
  const train = input.rows.filter((row) => !heldOut.has(row.familyId));
  const test = input.rows.filter((row) => heldOut.has(row.familyId));
  if (train.length === 0 || test.length === 0) return { status: "pending", trainCases: train.length, testCases: test.length, correct: 0, accuracy: null, permutationAccuracy: null, groupedFamilies: new Set(input.rows.map((row) => row.familyId)).size, missingEvidence: ["development_and_held_out_style_families"] };
  const rows = train.map((row, index) => ({
    caseId: `train-${index}`,
    familyAlias: "internal",
    features: { ...row.publicFeatures },
    actionDistribution: {},
    expectedLabel: null,
  }));
  const stats = standardizeFeatures(rows);
  const distance = (left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>) => stats.names.reduce((sum, name) => sum + (((left[name] ?? 0) - (stats.means[name] ?? 0)) / (stats.scales[name] ?? 1) - ((right[name] ?? 0) - (stats.means[name] ?? 0)) / (stats.scales[name] ?? 1)) ** 2, 0);
  const centroids = new Map<keyof typeof NORMAL_OPPONENT_PROFILES, Record<string, number>>();
  for (const profileKey of Object.keys(NORMAL_OPPONENT_PROFILES) as (keyof typeof NORMAL_OPPONENT_PROFILES)[]) {
    const profileRows = train.filter((row) => row.profileKey === profileKey);
    if (profileRows.length === 0) continue;
    centroids.set(profileKey, Object.fromEntries(stats.names.map((name) => [name, profileRows.reduce((sum, row) => sum + (row.publicFeatures[name] ?? 0), 0) / profileRows.length])));
  }
  let correct = 0;
  for (const row of test) {
    const prediction = [...centroids.entries()].sort((left, right) => distance(row.publicFeatures, left[1]) - distance(row.publicFeatures, right[1]))[0]?.[0];
    if (prediction === row.profileKey) correct += 1;
  }
  const classCount = Math.max(1, centroids.size);
  return {
    status: "available",
    trainCases: train.length,
    testCases: test.length,
    correct,
    accuracy: correct / test.length,
    permutationAccuracy: input.permutationLabels && input.permutationLabels.length >= classCount ? 1 / classCount : null,
    groupedFamilies: new Set(input.rows.map((row) => row.familyId)).size,
    missingEvidence: input.permutationLabels ? [] : ["permutation_label_baseline"],
  };
}

export function profileIdForKey(profileKey: keyof typeof NORMAL_OPPONENT_PROFILES): string {
  return NORMAL_OPPONENT_PROFILES[profileKey].id;
}

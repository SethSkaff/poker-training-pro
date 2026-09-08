export interface TimingObservation {
  sessionId: string;
  familyId: string;
  actionLabel: string;
  publicFeatures: Readonly<Record<string, number>>;
  actionDelayFeatures?: Readonly<Record<string, number>>;
  actualDelayMs?: number;
  privateStrengthLabel?: number;
  device?: string;
  runtime?: string;
}

export interface TimingPredictorResult {
  status: "available" | "pending";
  trainCases: number;
  testCases: number;
  correct: number;
  accuracy: number | null;
  missingEvidence: string[];
}

export interface TimingPredictabilityReport {
  schemaVersion: 1;
  measurement: "external_action_delay" | "missing";
  publicStateOnly: TimingPredictorResult;
  publicStatePlusDelay: TimingPredictorResult;
  potentialTellDiagnostic: { improvement: number | null; interpretation: "diagnostic_only" | "unresolved" };
  groupedSessions: number;
  groupedFamilies: number;
  deviceRuntime: Array<{ device: string | null; runtime: string | null; count: number }>;
  privateStrengthExcluded: true;
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

function assertFeatureNames(features: Readonly<Record<string, number>>): void {
  for (const name of Object.keys(features)) {
    if (/private|hidden|hole|opponent|profile|seed|outcome|result|truth|mode/i.test(name)) throw new Error(`Timing predictor feature is not public: ${name}`);
  }
}

function splitRows(rows: readonly TimingObservation[]): { train: TimingObservation[]; test: TimingObservation[] } {
  const families = [...new Set(rows.map((row) => row.familyId))].sort();
  const testFamilies = new Set(families.filter((family) => hash(family) % 5 === 0));
  const test = rows.filter((row) => testFamilies.has(row.familyId));
  const train = rows.filter((row) => !testFamilies.has(row.familyId));
  return test.length > 0 && train.length > 0 ? { train, test } : { train: rows.slice(0, Math.floor(rows.length / 2)), test: rows.slice(Math.floor(rows.length / 2)) };
}

function nearestCentroid(rows: readonly TimingObservation[], test: readonly TimingObservation[], useDelay: boolean): TimingPredictorResult {
  if (rows.length === 0 || test.length === 0) return { status: "pending", trainCases: rows.length, testCases: test.length, correct: 0, accuracy: null, missingEvidence: ["grouped_train_and_test_timing_cases"] };
  const featureNames = [...new Set(rows.flatMap((row) => [...Object.keys(row.publicFeatures), ...(useDelay ? Object.keys(row.actionDelayFeatures ?? {}) : [])]))].sort();
  featureNames.forEach((name) => assertFeatureNames({ [name]: 0 }));
  const centroids = new Map<string, Record<string, number>>();
  const labels = [...new Set(rows.map((row) => row.actionLabel))].sort();
  for (const label of labels) {
    const group = rows.filter((row) => row.actionLabel === label);
    centroids.set(label, Object.fromEntries(featureNames.map((name) => [name, group.reduce((sum, row) => sum + (row.publicFeatures[name] ?? (useDelay ? row.actionDelayFeatures?.[name] : undefined) ?? 0), 0) / group.length])));
  }
  const vector = (row: TimingObservation, name: string) => row.publicFeatures[name] ?? (useDelay ? row.actionDelayFeatures?.[name] : undefined) ?? 0;
  let correct = 0;
  for (const row of test) {
    const prediction = [...centroids.entries()].sort((left, right) => featureNames.reduce((sum, name) => sum + (vector(row, name) - (left[1][name] ?? 0)) ** 2, 0) - featureNames.reduce((sum, name) => sum + (vector(row, name) - (right[1][name] ?? 0)) ** 2, 0))[0]?.[0];
    if (prediction === row.actionLabel) correct += 1;
  }
  return { status: "available", trainCases: rows.length, testCases: test.length, correct, accuracy: correct / test.length, missingEvidence: [] };
}

export function evaluateTimingPredictability(input: {
  observations: readonly TimingObservation[];
  existingDelayLimitMs?: number | null;
}): TimingPredictabilityReport {
  for (const row of input.observations) {
    assertFeatureNames(row.publicFeatures);
    if (row.actionDelayFeatures) assertFeatureNames(row.actionDelayFeatures);
  }
  const available = input.observations.filter((row) => row.actualDelayMs !== undefined && Number.isFinite(row.actualDelayMs));
  const missingEvidence: string[] = [];
  if (available.length === 0) missingEvidence.push("externally_observable_action_delay");
  const { train, test } = splitRows(available);
  const publicStateOnly = nearestCentroid(train, test, false);
  const publicStatePlusDelay = nearestCentroid(train.filter((row) => row.actionDelayFeatures), test.filter((row) => row.actionDelayFeatures), true);
  const improvement = publicStateOnly.accuracy !== null && publicStatePlusDelay.accuracy !== null ? publicStatePlusDelay.accuracy - publicStateOnly.accuracy : null;
  return {
    schemaVersion: 1,
    measurement: available.length > 0 ? "external_action_delay" : "missing",
    publicStateOnly,
    publicStatePlusDelay,
    potentialTellDiagnostic: { improvement, interpretation: improvement === null ? "unresolved" : "diagnostic_only" },
    groupedSessions: new Set(available.map((row) => row.sessionId)).size,
    groupedFamilies: new Set(available.map((row) => row.familyId)).size,
    deviceRuntime: [...new Map(input.observations.map((row) => [`${row.device ?? ""}|${row.runtime ?? ""}`, { device: row.device ?? null, runtime: row.runtime ?? null, count: 0 }])).values()].map((entry) => ({ ...entry, count: input.observations.filter((row) => (row.device ?? null) === entry.device && (row.runtime ?? null) === entry.runtime).length })),
    privateStrengthExcluded: true,
    missingEvidence,
  };
}

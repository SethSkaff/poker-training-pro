export type SchemaVersion = 1;
export type Hash = string;

export interface ArtifactRef {
  relativePath: string;
  sha256: Hash;
  bytes: number;
}

export type Maybe<T> =
  | { value: T; reason: null }
  | { value: null; reason: string };

export type Split = "development" | "calibration" | "holdout";
export type RunStatus =
  | "complete"
  | "budget_exhausted"
  | "cancelled"
  | "invalid";

export interface PolicyIdentity {
  id: Hash;
  mode: "normal" | "rational" | "scripted" | "experimental";
  policyVersion: string;
  engineVersion: string;
  contentVersion: string;
  sourceTreeHash: Hash;
  parameterHash: Hash;
  profileKey: string | null;
  profileId: string | null;
  profileHash: Hash | null;
  adapterVersion: string;
}

export interface Reproduction {
  manifestHash: Hash;
  scenarioId: string | null;
  familyId: string;
  blockId: string;
  sessionId: string;
  handId: string;
  handNumber: number;
  decisionIndex: number;
  streetActionIndex: number;
  initialStateRef: ArtifactRef;
  prefixRef: ArtifactRef;
  sourceSnapshotRef: ArtifactRef;
  stateHash: Hash;
  masterSeed: string;
  dealSeed: string;
  equitySeed: string;
  actionSeed: string;
  samplingSeed: string;
  seedStreamVersion: string;
  rolloutReplicate: number;
  policy: PolicyIdentity;
  simulations: number;
  temperature: number | null;
}

export type EvaluationScope = "hero" | "full-field";
export type EvaluationClock = "frozen" | "nominal-live";
export type EvaluationObjective = "chip" | "payout" | "qualification";

export interface RunManifest {
  schemaVersion: SchemaVersion;
  runId: Hash;
  harnessVersion: string;
  semanticsVersion: string;
  registryVersion: string;
  commandArgv: string[];
  gitHead: string;
  branch: string;
  dirty: boolean;
  sourceTreeHash: Hash;
  sourceFiles: ArtifactRef[];
  diffRef: ArtifactRef | null;
  untrackedSourceRefs: ArtifactRef[];
  lockfileHash: Hash;
  runtime: {
    node: string;
    npm: string;
    platform: string;
    arch: string;
  };
  policies: PolicyIdentity[];
  experiment: {
    commonState: boolean;
    naturalPlay: boolean;
    fixedStack: boolean;
    adaptation: boolean;
    reviewer: boolean;
  };
  scope: EvaluationScope;
  clock: EvaluationClock;
  objective: EvaluationObjective;
  bankRef: ArtifactRef | null;
  split: Split;
  seeds: {
    master: string[];
    salt: string;
  };
  budgets: Record<string, number>;
  baselineRef: ArtifactRef | null;
  samplingConfigRef: ArtifactRef | null;
}

export interface RunReceipt {
  schemaVersion: SchemaVersion;
  runId: Hash;
  createdAt: string;
  finishedAt: string | null;
  status: RunStatus;
  reason: string | null;
  actualCounts: Record<string, number>;
  costMs: number | null;
  outputRefs: ArtifactRef[];
}

export function available<T>(value: T): Maybe<T> {
  return { value, reason: null };
}

export function unavailable<T>(reason: string): Maybe<T> {
  return { value: null, reason };
}

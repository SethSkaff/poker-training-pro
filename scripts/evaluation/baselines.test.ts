import { describe, expect, it } from "vitest";
import { assertCalibrationInputAllowed, assertNoExpectedValueRegeneration, createDescriptiveBaseline, createHoldoutUsageEntry } from "./baselines";

describe("A15 baseline and holdout immutability", () => {
  it("rejects holdout/spent material as calibration input", () => {
    expect(() => assertCalibrationInputAllowed({ split: "holdout", purpose: "tune" })).toThrow(/Holdout/);
    expect(() => assertCalibrationInputAllowed({ split: "development", holdoutSpent: true, purpose: "tune" })).toThrow(/Spent/);
    expect(() => assertCalibrationInputAllowed({ split: "development", purpose: "tune" })).not.toThrow();
  });

  it("creates descriptive snapshots without inventing approval", () => {
    const baseline = createDescriptiveBaseline({ schemaVersion: 1, creationSourceRunRefs: [], creationSourceChecksums: ["source"], schemaVersionRef: "v1", semanticsVersion: "semantics", registryVersion: "registry", harnessVersion: "harness", policyIdentity: "policy", bankRef: null, splitRef: "development", selectedMetrics: {}, scope: "hero", objective: "chip", clock: "frozen", comparisonEligibility: "descriptive_only" });
    expect(baseline.baselineId).toMatch(/^baseline:/);
    expect(baseline.provenance).toBe("descriptive_snapshot");
    expect(baseline.promotionRecordRef).toBeNull();
  });

  it("records holdout usage and rejects expected-value regeneration", () => {
    const entry = createHoldoutUsageEntry({ holdoutRef: "holdout-1", purpose: "read-only comparison", openedAt: "fixture", runId: "run-1" });
    expect(entry.status).toBe("read_only");
    const spent = createHoldoutUsageEntry({ holdoutRef: "holdout-1", purpose: "tune", openedAt: "fixture", runId: "run-2", inspectedForTuning: true });
    expect(spent.status).toBe("spent");
    expect(() => assertNoExpectedValueRegeneration({ baselineHashBefore: "same", baselineHashAfter: "same", candidateWasUsedToWriteExpected: true })).toThrow(/regenerate/);
    expect(() => assertNoExpectedValueRegeneration({ baselineHashBefore: "same", baselineHashAfter: "same", candidateWasUsedToWriteExpected: false })).not.toThrow();
  });
});

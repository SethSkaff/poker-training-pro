import { describe, expect, it } from "vitest";
import { compareRuns } from "./comparison";

const metric = (runId: string, estimate: number) => ({ schemaVersion: 1 as const, metricId: "x", definitionVersion: "v1", runId, policyId: "p", sliceId: "all", estimand: "x", unit: "proportion" as const, numerator: estimate, denominator: 1, estimate: { value: estimate, reason: null }, interval: { value: null, reason: "test" }, distinctDecisions: 1, distinctHands: 1, independentBlocks: 1, effectiveN: { value: 1, reason: null }, missingCount: 0, pendingCount: 0, coverage: "adequate" as const, authority: "diagnostic" as const, status: "diagnostic_only" as const, registryRef: { relativePath: "r", sha256: "0".repeat(64), bytes: 0 }, supportingEventRefs: [] });

describe("A06 baseline comparison", () => {
  it("pairs common blocks and does not pass without an approved margin", () => {
    const result = compareRuns({ runId: "base", semanticsVersion: "v1", registryVersion: "v1", sourceTreeHash: "base", baselineRef: { relativePath: "base", sha256: "1".repeat(64), bytes: 1 }, blocks: { a: { x: 0.2 }, b: { x: 0.4 } }, metrics: [metric("base", 0.3)] }, { runId: "candidate", semanticsVersion: "v1", registryVersion: "v1", sourceTreeHash: "candidate", baselineRef: { relativePath: "base", sha256: "1".repeat(64), bytes: 1 }, blocks: { a: { x: 0.3 }, c: { x: 0.8 } }, metrics: [metric("candidate", 0.5)] });
    expect(result[0].comparability).toBe("matched");
    expect(result[0].missingPairIds).toEqual(["c"]);
    expect(result[0].practicalMargin.value).toBeNull();
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import {
  auditSeedList,
  classifyEffectiveStack,
  runNormalAllInAudit,
  type NormalAllInAuditReport,
} from "./normal-all-in-audit";

describe("Normal all-in audit inputs", () => {
  it("creates an explicit stable seed list", () => {
    expect(auditSeedList(3, "audit")).toEqual([
      "audit-0",
      "audit-1",
      "audit-2",
    ]);
  });

  it("uses policy-relevant effective-stack bands", () => {
    expect(classifyEffectiveStack(5)).toBe("0-5 BB");
    expect(classifyEffectiveStack(5.01)).toBe(">5-12 BB");
    expect(classifyEffectiveStack(12)).toBe(">5-12 BB");
    expect(classifyEffectiveStack(40)).toBe(">12-40 BB");
    expect(classifyEffectiveStack(80)).toBe(">40-80 BB");
    expect(classifyEffectiveStack(80.01)).toBe(">80 BB");
  });

  it("rejects missing, duplicate, and invalid samples", () => {
    expect(() => auditSeedList(0, "audit")).toThrow(/positive integer/);
    expect(() => runNormalAllInAudit({ seeds: [], clocks: ["frozen"] })).toThrow(
      /At least one audit seed/,
    );
    expect(() =>
      runNormalAllInAudit({ seeds: ["same", "same"], clocks: ["frozen"] })
    ).toThrow(/unique/);
  });
});

describe("Normal all-in audit production-engine integration", () => {
  let report: NormalAllInAuditReport;

  beforeAll(() => {
    report = runNormalAllInAudit({
      seeds: ["normal-all-in-audit-test-00"],
      clocks: ["frozen"],
      maxHandsPerTournament: 2,
      auditDate: "test",
      sourceRevision: "test",
      reproductionCommand: "test",
    });
  }, 60_000);

  it("verifies every production policy command and all-in postcondition", () => {
    const summary = report.summaries.frozen!;
    expect(summary.hands).toBe(2);
    expect(summary.decisions).toBeGreaterThan(0);
    expect(summary.legality.decisionsVerified).toBe(summary.decisions);
    expect(summary.legality.allInsVerified).toBe(summary.allInActions);
    expect(summary.legality.violations).toBe(0);
    for (const allIn of report.allIns) {
      expect(allIn.legal).toMatchObject({
        allInAvailable: true,
        targetMatches: true,
        zeroStackAfter: true,
        allInStatusAfter: true,
      });
    }
  });

  it("keeps denominators and stack-depth partitions machine-checkable", () => {
    const summary = report.summaries.frozen!;
    expect(
      Object.values(summary.byStreet).reduce(
        (sum, bucket) => sum + bucket.decisions,
        0,
      ),
    ).toBe(summary.decisions);
    expect(
      Object.values(summary.byEffectiveStack).reduce(
        (sum, bucket) => sum + bucket.decisions,
        0,
      ),
    ).toBe(summary.decisions);
    expect(summary.releaseGateComparison).toBeDefined();
    expect(report.inputs.seeds).toEqual(["normal-all-in-audit-test-00"]);
    expect(Object.keys(report.relevantSourceSha256)).toHaveLength(5);
  });
});

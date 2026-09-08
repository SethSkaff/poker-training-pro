import { describe, expect, it } from "vitest";
import { aggregateActionAudit } from "./metrics";

describe("A06 generic action audit", () => {
  it("reconciles categories including excluded/unscored decisions", () => {
    const report = aggregateActionAudit([
      { canonicalKind: "call", encounterId: "1", familyId: "f", blockId: "b", objective: "chip_ev", gradeEligible: true, gradeReason: "supported", supportStatus: "supported", regretLower: 0, regretUpper: 0.1, grade: "excellent", traceLink: "trace", decisionStatus: "supported_near_optimal" },
      { canonicalKind: "call", encounterId: "2", familyId: "f", blockId: "b", objective: "chip_ev", gradeEligible: false, gradeReason: "ood", supportStatus: "ood", regretLower: null, regretUpper: null, grade: null, traceLink: "trace", decisionStatus: "ood" },
      { canonicalKind: "fold", encounterId: "3", familyId: "f2", blockId: "b2", objective: "chip_ev", gradeEligible: false, gradeReason: "tolerance_pending", supportStatus: "supported", regretLower: 0, regretUpper: 0, grade: null, traceLink: null, decisionStatus: "tolerance_pending" },
    ]);
    expect(report.encountered).toBe(3);
    expect(report.byCategory.call.encountered).toBe(2);
    expect(report.byCategory.call.gradeEligible).toBe(1);
    expect(Object.values(report.statusCounts).reduce((sum, count) => sum + count, 0)).toBe(3);
  });
});

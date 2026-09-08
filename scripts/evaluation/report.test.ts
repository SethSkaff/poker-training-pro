import { describe, expect, it } from "vitest";
import { renderEvaluationReport, type EvaluationReport } from "./report";

describe("A06 report", () => {
  it("prints coverage and pending evidence instead of hiding missing cells", () => {
    const report: EvaluationReport = { schemaVersion: 1, runId: "run", status: "insufficient_evidence", scope: "hero", clock: "frozen", objective: "chip", coverage: { total: 3, finalized: 2, missing: 1, pending: 1, status: "sparse" }, metrics: [], actionAudit: null, pendingEvidence: ["expert labels pending", "tolerance pending"], flags: [] };
    const text = renderEvaluationReport(report);
    expect(text).toContain("insufficient_evidence");
    expect(text).toContain("expert labels pending");
    expect(text).toContain("2/3 finalized");
  });
});

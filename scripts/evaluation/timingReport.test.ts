import { describe, expect, it } from "vitest";
import { evaluateTimingPredictability } from "./timingReport";

describe("A12 timing report", () => {
  it("keeps missing external delay evidence unresolved", () => {
    const report = evaluateTimingPredictability({ observations: [] });
    expect(report.measurement).toBe("missing");
    expect(report.potentialTellDiagnostic.interpretation).toBe("unresolved");
    expect(report.missingEvidence).toContain("externally_observable_action_delay");
    expect(report.privateStrengthExcluded).toBe(true);
  });

  it("uses grouped public features plus externally observable delay as a diagnostic only", () => {
    const observations = Array.from({ length: 12 }, (_, index) => ({
      sessionId: `session-${index}`,
      familyId: `family-${index}`,
      actionLabel: index % 2 ? "call" : "raise",
      publicFeatures: { pressure: index % 2 },
      actionDelayFeatures: { delayBucket: index % 2 },
      actualDelayMs: 100 + index,
      privateStrengthLabel: index / 12,
      device: "fixture",
      runtime: "vitest",
    }));
    const report = evaluateTimingPredictability({ observations });
    expect(report.measurement).toBe("external_action_delay");
    expect(report.potentialTellDiagnostic.interpretation).toBe("diagnostic_only");
    expect(report.privateStrengthExcluded).toBe(true);
    expect(report.groupedFamilies).toBe(12);
  });

  it("rejects hidden or private predictor features", () => {
    expect(() => evaluateTimingPredictability({ observations: [{ sessionId: "s", familyId: "f", actionLabel: "call", publicFeatures: { privateStrength: 1 } }] })).toThrow(/not public/);
  });
});

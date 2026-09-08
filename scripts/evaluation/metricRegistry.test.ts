import { describe, expect, it } from "vitest";
import { assertNoUnsupportedReleaseQuota, evaluateMetricAuthority } from "./metricRegistry";

describe("A03 metric authority registry", () => {
  it("retains historical subjective quotas as retired and non-gating", () => {
    const entry = evaluateMetricAuthority("legacy.facingCallRate");
    expect(entry.authority).toBe("retired");
    expect(entry.releaseGate).toBe(false);
    expect(entry.retirementReason).toMatch(/unsupported/);
    expect(() => assertNoUnsupportedReleaseQuota()).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { createMixtureBelief, runAdaptationExperiment, updateMixtureBelief } from "./adaptationExperiment";

describe("A14 offline adaptation experiment", () => {
  it("keeps fixed/adaptive arms paired and uses the declared schedule set", () => {
    const result = runAdaptationExperiment({ seed: "adaptation-test", blockCount: 2, handsPerBlock: 4 });
    expect(result.status).toBe("pending_external");
    expect(result.seedManifest.unique).toBe(true);
    expect(result.commonSchedulePairing).toHaveLength(6);
    expect(result.conditions).toHaveLength(12);
    expect(result.conditions.every((condition) => condition.metrics.payout.status === "pending")).toBe(true);
    const fixed = result.conditions.find((condition) => condition.arm === "fixed-belief" && condition.scheduleId === "value-heavy");
    const adaptive = result.conditions.find((condition) => condition.arm === "adaptive-belief" && condition.scheduleId === "value-heavy");
    expect(fixed?.trajectories[0].belief.weights).toEqual(fixed?.trajectories[fixed.trajectories.length - 1].belief.weights);
    expect(adaptive?.trajectories[0].belief.weights).not.toEqual(adaptive?.trajectories[adaptive.trajectories.length - 1].belief.weights);
    expect(adaptive?.commonProbeValues.every((probe) => probe.supported)).toBe(true);
  });

  it("preserves prior odds when two scripted models have identical public likelihood", () => {
    const belief = createMixtureBelief(["value-heavy", "value-heavy-to-passive"]);
    const updated = updateMixtureBelief({ belief, context: "facingPressure", legalActions: [{ key: "call", kind: "call", targetChips: 100 }, { key: "raise", kind: "raise", targetChips: 300 }], observedAction: { key: "raise", kind: "raise", targetChips: 300 }, handIndex: 0 });
    expect(updated.weights["value-heavy"] / updated.weights["value-heavy-to-passive"]).toBeCloseTo(1, 12);
  });

  it("leaves external authority and live adoption visibly unavailable", () => {
    const result = runAdaptationExperiment({ schedules: ["value-heavy-to-passive"], blockCount: 1, handsPerBlock: 12 });
    expect(result.missingEvidence).toContain("live_adoption_authority");
    expect(result.conditions[1].postSwitchRecovery.switchHandIndex).toBe(10);
    expect(result.conditions[1].metrics.qualification.status).toBe("pending");
  });
});

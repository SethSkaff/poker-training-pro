import { describe, expect, it } from "vitest";
import { createScenarioBank } from "./scenarioBank";
import { scaleScenario, permuteScenarioSuits } from "./scenarioTransforms";
import { verifyScenarioReachability } from "./scenarios";

describe("A04 scenario transforms", () => {
  it("scales legal commitments and preserves the target ratio", () => {
    const base = createScenarioBank(4).scenarios[0];
    const scaled = scaleScenario(base, 10);
    verifyScenarioReachability(scaled);
    expect(scaled.familyId).toBe(base.familyId);
    expect(scaled.transformationLineage).toContain(base.scenarioId);
    expect(scaled.expectedMechanics.potChips).toBe(base.expectedMechanics.potChips * 10);
  });

  it("applies a bijective suit permutation without changing mechanics", () => {
    const base = createScenarioBank(4).scenarios[0];
    const transformed = permuteScenarioSuits(base, { clubs: "diamonds", diamonds: "clubs", hearts: "spades", spades: "hearts" });
    verifyScenarioReachability(transformed);
    expect(transformed.expectedMechanics.potChips).toBe(base.expectedMechanics.potChips);
    expect(transformed.transformationLineage).toContain(base.scenarioId);
  });
});

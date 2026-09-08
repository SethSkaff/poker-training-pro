import { describe, expect, it } from "vitest";
import { createScenarioBank } from "./scenarioBank";
import { selectReviewSamples, type SampleCandidate } from "./sampling";

describe("A05 deterministic review sampling", () => {
  it("samples the finalized uniform stream reproducibly, including flagged candidates", () => {
    const scenarios = createScenarioBank(8).scenarios;
    const candidates = scenarios.map((scenario, index) => ({
      id: scenario.scenarioId,
      event: {} as never,
      familyId: scenario.familyId,
      blockId: `block-${index % 2}`,
      primaryCell: "flop:heads_up",
      score: index,
      streams: index % 2 === 0 ? ["stratified" as const, "tails" as const] : ["disagreements" as const],
      finalized: true,
    })) satisfies SampleCandidate[];
    const first = selectReviewSamples(candidates, { samplingSeed: "a05" , budgets: { uniform: 3, stratified: 2, tails: 2, disagreements: 2, "changed-path": 0 } });
    const second = selectReviewSamples(candidates, { samplingSeed: "a05" , budgets: { uniform: 3, stratified: 2, tails: 2, disagreements: 2, "changed-path": 0 } });
    expect(first.uniform.map((sample) => sample.id)).toEqual(second.uniform.map((sample) => sample.id));
    expect(first.uniform.length).toBe(3);
  });
});

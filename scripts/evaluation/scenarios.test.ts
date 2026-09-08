import { describe, expect, it } from "vitest";
import { getLegalActions } from "../../src/engine/betting";
import { createScenarioBank } from "./scenarioBank";
import { verifyScenarioReachability } from "./scenarios";

describe("A04 reachable scenario bank", () => {
  it("builds the reconstructed jam with independent pot and stack arithmetic", () => {
    const bank = createScenarioBank(120);
    const jam = bank.scenarios.find((scenario) => scenario.familyId === "wesley-reconstructed");
    expect(jam).toBeDefined();
    if (!jam) return;
    verifyScenarioReachability(jam);
    expect(jam.expectedMechanics.potChips).toBe(22_467);
    expect(jam.targetEngineState.players.find((player) => player.id === "hero")?.stack).toBe(20_282);
    const legal = getLegalActions(jam.targetEngineState, "hero");
    expect(legal.callAmount).toBe(20_282);
    expect(legal.allInTo).toBe(20_282);
    expect(jam.expectedMechanics.notes).toContain("P+C=42749");
  });

  it("produces at least 120 nodes with frozen family splits", () => {
    const bank = createScenarioBank(120);
    expect(bank.scenarios).toHaveLength(120);
    expect(new Set(bank.scenarios.map((scenario) => scenario.scenarioId)).size).toBe(120);
    for (const scenario of bank.scenarios) expect(scenario.split).toBeDefined();
    const familySplits = new Map<string, string>();
    for (const scenario of bank.scenarios) {
      const prior = familySplits.get(scenario.familyId);
      if (prior) expect(scenario.split).toBe(prior);
      familySplits.set(scenario.familyId, scenario.split ?? "");
    }
  });
});

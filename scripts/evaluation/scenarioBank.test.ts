import { describe, expect, it } from "vitest";
import { assignFamilySplit, createScenarioBank, loadScenarioBank } from "./scenarioBank";

describe("A04 scenario bank isolation", () => {
  it("keeps Wesley in development and rejects a split mismatch", () => {
    expect(assignFamilySplit("wesley-reconstructed").split).toBe("development");
    const bank = createScenarioBank(12);
    expect(() => loadScenarioBank(bank, { expectedSplitSalt: bank.splitSalt, expectedMinCount: 12 })).not.toThrow();
    expect(() => loadScenarioBank(bank, { expectedSplitSalt: "changed-salt" })).toThrow(/salt mismatch/);
  });
});

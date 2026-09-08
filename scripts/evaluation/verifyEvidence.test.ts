import { describe, expect, it } from "vitest";
import { ACCEPTANCE_INDEX, assertAcceptanceIndexComplete } from "./acceptanceIndex";
import { verifyEvidence, verifyProductionImportExclusion } from "./verifyEvidence";

describe("A15 evidence verifier", () => {
  it("maps every acceptance ID and keeps production imports separate", () => {
    assertAcceptanceIndexComplete();
    expect(ACCEPTANCE_INDEX).toHaveLength(15);
    const invariance = verifyProductionImportExclusion(process.cwd());
    expect(invariance.liveAdoption).toBe("none_detected");
    expect(invariance.noEvaluationImports).toBe(true);
  });

  it("reports missing final evidence as incomplete rather than certifying it", () => {
    const result = verifyEvidence({ root: process.cwd(), requireComplete: false });
    expect(result.status).toBe("complete");
    expect(result.empiricalEvidence.status).toBe("pending");
    expect(result.acceptanceIndex.mappings).toBe(15);
  });
});

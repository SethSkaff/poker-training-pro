import { join } from "node:path";
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

  it("gates executable conformance under --require-complete without a fixture output directory", () => {
    // The release stage deliberately does not launch a campaign, and fixture
    // evidence lives under the ignored /work/ tree, so requiring an output
    // directory here made the gate unsatisfiable in every clean checkout.
    const result = verifyEvidence({ root: process.cwd(), requireComplete: true });
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("complete");
    const named = verifyEvidence({ root: process.cwd(), outputDir: join(process.cwd(), "work", "missing-evidence"), requireComplete: true });
    expect(named.status).toBe("incomplete");
    expect(named.errors.some((error) => error.startsWith("Required evidence output directory is missing"))).toBe(true);
  });

  it("reports missing final evidence as incomplete rather than certifying it", () => {
    const result = verifyEvidence({ root: process.cwd(), requireComplete: false });
    expect(result.status).toBe("complete");
    expect(result.empiricalEvidence.status).toBe("pending");
    expect(result.acceptanceIndex.mappings).toBe(15);
  });
});

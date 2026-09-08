import { describe, expect, it } from "vitest";
import { createReviewerInput, validateReviewerOutput } from "./criticInput";
import { assertReviewerRequestHasNoEndpointFallback } from "./criticAdapter";

function makeInput() {
  return createReviewerInput({
    opaqueCaseId: "contract-case",
    actorId: "actor-source-id",
    actorCards: [{ rank: "A", suit: "spades" }, { rank: "A", suit: "hearts" }],
    publicPlayers: [{ id: "actor-source-id", seat: 2 }, { id: "other-source-id", seat: 3 }],
    street: "flop",
    board: [{ rank: "2", suit: "clubs" }, { rank: "7", suit: "diamonds" }, { rank: "9", suit: "spades" }],
    publicActions: [{ playerId: "other-source-id", street: "flop", kind: "bet", targetChips: 75 }],
    legalActions: [],
    geometry: { potBeforeChips: 100, actualCallChips: 75, targetChips: 75, investedChips: 75, raiseByChips: 0, investmentOverPot: 0.75, raiseOverPotAfterCall: null, actorStackChips: 500, pairwiseRemainingDepth: 5 },
  });
}

describe("A10 reviewer contract negatives", () => {
  it("requires each concern to have findings and each insufficiency to name missing evidence", () => {
    const input = makeInput();
    const common = { schemaVersion: 2, caseId: input.caseId, findings: [], missingInformation: [], inputContradictions: [] };
    expect(validateReviewerOutput(input, { ...common, assessments: { strategicPlausibility: "concern", wagerNumberPlausibility: "plausible", styleConsistency: "not_provided" } }).valid).toBe(false);
    expect(validateReviewerOutput(input, { ...common, assessments: { strategicPlausibility: "insufficient", wagerNumberPlausibility: "insufficient", styleConsistency: "insufficient" } }).valid).toBe(false);
    expect(validateReviewerOutput(input, { ...common, missingInformation: ["no independent label"], assessments: { strategicPlausibility: "insufficient", wagerNumberPlausibility: "insufficient", styleConsistency: "insufficient" } }).valid).toBe(true);
  });

  it("does not permit a default environment endpoint", () => {
    expect(() => assertReviewerRequestHasNoEndpointFallback("const endpoint = process.env.REVIEWER_URL")).toThrow(/environment/);
    expect(() => assertReviewerRequestHasNoEndpointFallback("const endpoint = options.endpoint")).not.toThrow();
  });

  it("does not confuse valid schema with reviewer accuracy or authority", () => {
    const input = makeInput();
    const output = {
      schemaVersion: 2,
      caseId: input.caseId,
      assessments: { strategicPlausibility: "plausible", wagerNumberPlausibility: "plausible", styleConsistency: "not_provided" },
      findings: [],
      missingInformation: [],
      inputContradictions: [],
    };
    const validation = validateReviewerOutput(input, output);
    expect(validation.valid).toBe(true);
    expect(output).not.toHaveProperty("strategyAuthority");
  });
});

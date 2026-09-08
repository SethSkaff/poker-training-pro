import { describe, expect, it } from "vitest";
import { createReviewerInput } from "./criticInput";
import {
  createHttpReviewerAdapter,
  createInMemoryReviewerCache,
  createMockReviewerAdapter,
  runReviewerRequest,
} from "./criticAdapter";

function input() {
  return createReviewerInput({
    opaqueCaseId: "adapter-case",
    actorId: "hero",
    actorCards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "diamonds" }],
    publicPlayers: [{ id: "hero", seat: 0 }, { id: "villain", seat: 1 }],
    street: "river",
    board: [{ rank: "2", suit: "clubs" }, { rank: "7", suit: "hearts" }, { rank: "9", suit: "spades" }, { rank: "J", suit: "diamonds" }, { rank: "3", suit: "clubs" }],
    publicActions: [],
    legalActions: [],
    geometry: { potBeforeChips: 100, actualCallChips: 0, targetChips: 0, investedChips: 0, raiseByChips: 0, investmentOverPot: 0, raiseOverPotAfterCall: null, actorStackChips: 100, pairwiseRemainingDepth: 1 },
  });
}

describe("A10 reviewer adapters", () => {
  it("runs offline mock review without a network path and remains unvalidated", async () => {
    const result = await runReviewerRequest(input(), createMockReviewerAdapter());
    expect(result.output?.validationStatus).toBe("valid");
    expect(result.output?.assessments.strategicPlausibility).toBe("insufficient");
    expect(result.receipt.endpointCategory).toBe("mock");
    expect(result.receipt.validationStatus).toBe("unvalidated");
    expect(result.receipt.responseRef).toContain("review-response:");
  });

  it("caches identical calls but bypasses cache for independent duplicates", async () => {
    const cache = createInMemoryReviewerCache();
    let calls = 0;
    const adapter = createMockReviewerAdapter({ response: () => { calls += 1; return {
      schemaVersion: 2,
      caseId: "adapter-case",
      assessments: { strategicPlausibility: "insufficient", wagerNumberPlausibility: "insufficient", styleConsistency: "insufficient" },
      findings: [], missingInformation: ["human"], inputContradictions: [],
    }; } });
    const first = await runReviewerRequest(input(), adapter, { cache });
    const second = await runReviewerRequest(input(), adapter, { cache });
    const duplicate = await runReviewerRequest(input(), adapter, { cache, cacheMode: "bypass" });
    expect(calls).toBe(2);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(duplicate.cacheHit).toBe(false);
    expect(duplicate.receipt.cacheMode).toBe("bypass");
  });

  it("records invalid response rather than converting malformed output into a verdict", async () => {
    const result = await runReviewerRequest(input(), createMockReviewerAdapter({ response: () => ({ schemaVersion: 99, caseId: "wrong" }) }));
    expect(result.output).toBeNull();
    expect(result.receipt.validationStatus).toBe("invalid_response");
    expect(result.receipt.transportError).toContain("invalid_response:");
  });

  it("requires explicit endpoint/model/fetch and validates the final serialized request", async () => {
    let body = "";
    const adapter = createHttpReviewerAdapter({
      endpoint: "http://localhost:0/reviewer",
      model: "fixture-model",
      fetchImpl: async (_url, init) => {
        body = init.body;
        return { ok: true, json: async () => ({
          schemaVersion: 2,
          caseId: "adapter-case",
          assessments: { strategicPlausibility: "insufficient", wagerNumberPlausibility: "insufficient", styleConsistency: "insufficient" },
          findings: [], missingInformation: ["human"], inputContradictions: [],
        }) };
      },
    });
    const result = await runReviewerRequest(input(), adapter);
    expect(result.output?.caseId).toBe("adapter-case");
    expect(body).not.toContain("villain");
    expect(body).not.toContain("seed");
    expect(body).not.toContain("holeCards");
  });
});

import { describe, expect, it } from "vitest";
import {
  assertReviewerInputSafe,
  createReviewerInput,
  resolveReviewerEvidencePath,
  serializeReviewerInput,
  validateReviewerOutput,
  type ReviewerDecisionSource,
  type ReviewerInputV2,
} from "./criticInput";

function source(): ReviewerDecisionSource {
  return {
    opaqueCaseId: "case-opaque-1",
    actorId: "hero-internal",
    actorCards: [{ rank: "A", suit: "spades" }, { rank: "K", suit: "diamonds" }] as const,
    publicPlayers: [{ id: "hero-internal", seat: 0 }, { id: "villain-private", seat: 1 }],
    street: "river" as const,
    board: [
      { rank: "2", suit: "clubs" },
      { rank: "7", suit: "hearts" },
      { rank: "9", suit: "spades" },
      { rank: "J", suit: "diamonds" },
      { rank: "3", suit: "clubs" },
    ],
    publicActions: [{ playerId: "villain-private", street: "river" as const, kind: "bet", targetChips: 100 }],
    legalActions: [{ key: "call", kind: "call" as const, targetChips: 100, investedChips: 100, raisesCurrentBet: false, raiseByChips: 0, isActorAllIn: false, stackOffClass: "none" as const, isFullRaise: false, isShortAllInIncrease: false }],
    geometry: { potBeforeChips: 200, actualCallChips: 100, targetChips: 100, investedChips: 100, raiseByChips: 0, investmentOverPot: 0.5, raiseOverPotAfterCall: null, actorStackChips: 1_000, pairwiseRemainingDepth: 5 },
  };
}

describe("A10 blinded reviewer input", () => {
  it("uses stable P aliases and exposes only actor cards in a decision task", () => {
    const input = createReviewerInput(source());
    const serialized = serializeReviewerInput(input);
    expect(input.actorAlias).toBe("P1");
    expect(input.publicTimeline.actions[0].actorAlias).toBe("P2");
    expect(input.ownCards).toHaveLength(2);
    expect(serialized).not.toContain("villain-private");
    expect(serialized).not.toContain("hero-internal");
    expect(serialized).not.toContain("seed");
    expect(serialized).not.toContain("Wesley");
  });

  it("omits actor cards from the public session task", () => {
    const input = createReviewerInput({ ...source(), task: "session_public" });
    expect(input.ownCards).toBeUndefined();
    expect(() => assertReviewerInputSafe(input)).not.toThrow();
  });

  it("rejects a future-board or hidden-card field even when nested under a harmless label", () => {
    const input = createReviewerInput(source());
    const unsafeTimeline = { ...input.publicTimeline, diagnostic: { futureBoard: [{ rank: "A", suit: "hearts" }] } } as unknown as ReviewerInputV2["publicTimeline"];
    expect(() => assertReviewerInputSafe({ ...input, publicTimeline: unsafeTimeline })).toThrow(/forbidden field/);
  });

  it("resolves evidence paths against the allowlisted input", () => {
    const input = createReviewerInput(source());
    expect(resolveReviewerEvidencePath(input, "/publicTimeline/board/0/rank")).toBe("2");
    expect(resolveReviewerEvidencePath(input, "/truth/hidden")).toBeUndefined();
    expect(validateReviewerOutput(input, {
      schemaVersion: 2,
      caseId: input.caseId,
      assessments: { strategicPlausibility: "plausible", wagerNumberPlausibility: "plausible", styleConsistency: "not_provided" },
      findings: [{ category: "candidate_magnitude", priority: "low", evidencePaths: ["/publicTimeline/board/0"], claim: "test", possibleJustification: "test", requestedCheck: "test", confidence: "low" }],
      missingInformation: [],
      inputContradictions: [],
    }).valid).toBe(true);
  });
});

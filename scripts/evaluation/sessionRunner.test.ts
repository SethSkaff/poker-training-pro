import { describe, expect, it } from "vitest";
import { runEvaluationSession } from "./sessionRunner";

describe("A05 interactive capture", () => {
  it("captures pre-action events with deterministic seeded actions", () => {
    const first = runEvaluationSession({ seed: "a05-seeded", mode: "rational", maxHands: 1, maxActionsPerHand: 4_000, policyOptions: { simulations: 60 } });
    const second = runEvaluationSession({ seed: "a05-seeded", mode: "rational", maxHands: 1, maxActionsPerHand: 4_000, policyOptions: { simulations: 60 } });
    expect(first.status).toBe("budget_exhausted");
    expect(first.hands[0]?.completed).toBe(true);
    expect(first.events.length).toBeGreaterThan(0);
    expect(first.events.map((event) => event.chosen.key)).toEqual(second.events.map((event) => event.chosen.key));
    expect(first.events[0].preState).not.toBe(first.events[0].chosen.result.state);
  });

  it("keeps a capped hand censored instead of calling it complete", () => {
    const result = runEvaluationSession({ seed: "a05-cap", mode: "rational", maxHands: 1, maxActionsPerHand: 1, policyOptions: { simulations: 60 } });
    expect(result.censored).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.status).toBe("budget_exhausted");
  });
});

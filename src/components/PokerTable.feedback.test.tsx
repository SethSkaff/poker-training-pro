import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { gradeTrainingAttempt } from "../lib/trainingEngine";
import type { PokerAction } from "../types/poker";
import { FeedbackPanel, trainingFeedbackMath } from "./PokerTable";

function scenario(id: string) {
  const found = trainingScenarios.find((item) => item.id === id);
  if (!found) throw new Error(`Missing scenario ${id}`);
  return found;
}

function renderFeedback(id: string, action: PokerAction) {
  const selected = scenario(id);
  const graded = gradeTrainingAttempt({
    scenario: selected,
    action,
    mathAnswer: selected.mathQuestion.correctValue,
    decisionElo: 1000,
    mathElo: 1000,
    actionElapsedMs: 1000,
    mathElapsedMs: 1000,
  });
  return renderToStaticMarkup(
    <FeedbackPanel
      action={action}
      graded={graded}
      mathAttempted
      onNext={() => undefined}
      onReview={() => undefined}
    />,
  );
}

describe("training feedback mathematics", () => {
  it("derives public pot odds and exposes every modeled action EV", () => {
    const selected = scenario("preflop-pot-odds-ak");
    const math = trainingFeedbackMath(selected);
    expect(math).toMatchObject({
      potBefore: 2700,
      costToCall: 1800,
      potAfterCall: 4500,
      potOdds: 40,
      requiredEquity: 40,
      actionEvs: [["call", 1.35], ["fold", 0]],
    });
    // Equity is simulated against a random opponent hand, so it is asserted as
    // a plausible, deterministic figure rather than a hardcoded constant.
    expect(math.equitySimulations).toBeGreaterThan(0);
    expect(math.estimatedEquity).toBeGreaterThan(0);
    expect(math.estimatedEquity).toBeLessThan(100);
    expect(trainingFeedbackMath(selected).estimatedEquity).toBe(
      math.estimatedEquity,
    );
  });

  it("keeps grading concise for correct, close, and wrong actions", () => {
    const correct = renderFeedback("preflop-pot-odds-ak", "call");
    const close = renderFeedback("turn-close-flush-price", "fold");
    const wrong = renderFeedback("flop-dirty-straight-outs", "raise");

    for (const markup of [correct, close, wrong]) {
      expect(markup).toContain("Recommended action");
      expect(markup).toContain("Math:");
      expect(markup).not.toContain("Decision mathematics");
      expect(markup).not.toContain("Pot before your action");
      expect(markup).not.toContain("uniformly random opponent hand");
    }
    expect(correct).toContain("correct");
    expect(close).toContain("Strong decision");
    expect(wrong).toContain("Needs another look");
  });

  it("keeps the compact result available to assistive technology", () => {
    const markup = renderFeedback("preflop-pot-odds-ak", "call");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("feedback-panel--compact");
  });
});

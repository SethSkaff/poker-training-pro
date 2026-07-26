import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trainingScenarios } from "../data/trainingScenarios";
import { formatChips } from "../lib/format";
import { gradeTrainingAttempt } from "../lib/trainingEngine";
import { FeedbackPanel, trainingFeedbackMath } from "./PokerTable";

function scenario(id: string) {
  const found = trainingScenarios.find((item) => item.id === id);
  if (!found) throw new Error(`Missing scenario ${id}`);
  return found;
}

function renderFeedback(id: string, action: "call" | "fold") {
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
      scenario={selected}
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

  it("renders decision math for correct, close, and wrong actions", () => {
    const correct = renderFeedback("preflop-pot-odds-ak", "call");
    const close = renderFeedback("turn-close-flush-price", "fold");
    const wrong = renderFeedback("flop-dirty-straight-outs", "call");

    for (const markup of [correct, close, wrong]) {
      expect(markup).toContain("Decision mathematics");
      expect(markup).toContain("Pot before your action");
      expect(markup).toContain("Cost to call");
      expect(markup).toContain("Required equity");
      expect(markup).toContain("Recommended action");
      expect(markup).toContain("EV regret");
      expect(markup).toContain("Modeled action EVs");
      expect(markup).toContain("If your range estimate");
      // E17: the maths must appear on correct answers too, not only mistakes.
      expect(markup).toContain("Pot odds");
      expect(markup).toContain("Your equity (vs a random hand)");
      // Why the recommendation wins, from the numbers.
      expect(markup).toContain("wins because it is worth");
      // How far the conclusion is from flipping.
      expect(markup).toMatch(/equity you needed|fold equity and position/);
      // The assumption behind the equity figure is stated, not implied.
      expect(markup).toContain("uniformly random opponent hand");
    }
    expect(correct).toContain(formatChips(2700));
    expect(correct).toContain("40.0%");
    expect(close).toContain("Yes");
    expect(wrong).toContain("0.58 bb");
  });

  it("keeps the explanation available to assistive technology", () => {
    const markup = renderFeedback("preflop-pot-odds-ak", "call");
    // The panel is a polite live region and stays mounted until the player
    // moves on -- it is not a transient toast.
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-label="Decision mathematics"');
  });
});

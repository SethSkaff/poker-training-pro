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
    expect(trainingFeedbackMath(selected)).toEqual({
      potBefore: 2700,
      costToCall: 1800,
      potAfterCall: 4500,
      requiredEquity: 40,
      actionEvs: [["call", 1.35], ["fold", 0]],
    });
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
    }
    expect(correct).toContain(formatChips(2700));
    expect(correct).toContain("40.0%");
    expect(close).toContain("Yes");
    expect(wrong).toContain("0.58 bb");
  });
});

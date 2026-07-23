import { describe, expect, it } from "vitest";
import {
  trainingScenarios,
  type RatedTrainingScenario,
} from "../data/trainingScenarios";
import {
  calculateEloDelta,
  evaluateAction,
  evaluateMathAnswer,
  expectedEloScore,
  gradeTrainingAttempt,
  measureAttemptTiming,
  parseMathAnswer,
  selectNearTransferScenario,
  summarizeTiming,
  validateTrainingScenario,
  validateTrainingScenarioBank,
} from "./trainingEngine";

describe("table-style math answer parsing", () => {
  it("accepts percentages, decimals, and literal fractions", () => {
    expect(parseMathAnswer("33%", "%")).toBe(33);
    expect(parseMathAnswer("0.33", "%")).toBe(33);
    expect(parseMathAnswer("1/3", "%")).toBeCloseTo(33.333, 2);
  });

  it("accepts poker odds notation for percentage questions", () => {
    expect(parseMathAnswer("2:1", "%")).toBeCloseTo(33.333, 2);
    expect(parseMathAnswer("3:1", "%")).toBe(25);
  });

  it("reads colon and slash forms literally for ratio questions", () => {
    expect(parseMathAnswer("3:5", "ratio")).toBe(0.6);
    expect(parseMathAnswer("3/5", "ratio")).toBe(0.6);
  });

  it("accepts decimal comma, decimal point, and explicit space grouping", () => {
    expect(parseMathAnswer("33,5%", "%")).toBe(33.5);
    expect(parseMathAnswer("0,33", "%")).toBe(33);
    expect(parseMathAnswer("1,5/3", "ratio")).toBe(0.5);
    expect(parseMathAnswer("2,5:1", "%")).toBeCloseTo(28.571, 2);
    expect(parseMathAnswer("5,500", "chips")).toBeUndefined();
    expect(parseMathAnswer("5\u202f500", "chips")).toBe(5500);
    expect(parseMathAnswer("1.234,5", "chips")).toBeUndefined();
    expect(parseMathAnswer("1,234.5", "chips")).toBeUndefined();
  });

  it("rejects malformed, negative, and zero-denominator answers", () => {
    expect(parseMathAnswer("", "%")).toBeUndefined();
    expect(parseMathAnswer("one third", "%")).toBeUndefined();
    expect(parseMathAnswer("1/0", "%")).toBeUndefined();
    expect(parseMathAnswer("1,2,3", "chips")).toBeUndefined();
    expect(parseMathAnswer("-1", "outs")).toBeUndefined();
  });
});

function scenario(id: string): RatedTrainingScenario {
  const found = trainingScenarios.find((item) => item.id === id);
  if (!found) throw new Error(`Missing fixture scenario ${id}`);
  return found;
}

describe("training scenario bank", () => {
  it("is internally valid and covers every street", () => {
    expect(validateTrainingScenarioBank()).toEqual([]);
    expect(new Set(trainingScenarios.map((item) => item.street))).toEqual(
      new Set(["preflop", "flop", "turn", "river"]),
    );
  });

  it("provides exactly one linked numeric math question per scenario", () => {
    for (const item of trainingScenarios) {
      expect(item.mathQuestion).toBeTypeOf("object");
      expect(item.mathQuestion.prompt.length).toBeGreaterThan(10);
      expect(Number.isFinite(item.mathQuestion.correctValue)).toBe(true);
      expect(item.mathQuestion.tolerance).toBeGreaterThanOrEqual(0);
    }
  });

  it("detects duplicate visible cards", () => {
    const source = scenario("flop-flush-draw-all-in");
    const invalid: RatedTrainingScenario = {
      ...source,
      board: [source.heroCards[0], ...source.board.slice(1)],
    };

    expect(validateTrainingScenario(invalid)).toContain(
      "Hero cards and board must not contain duplicate cards.",
    );
  });
});

describe("EV-regret-aware action grading", () => {
  it("gives full credit to the best action", () => {
    const result = evaluateAction(scenario("preflop-pot-odds-ak"), "call");

    expect(result.correct).toBe(true);
    expect(result.score).toBe(1);
    expect(result.regret).toBe(0);
    expect(result.bestAction).toBe("call");
  });

  it("gives partial credit to a close but inferior action", () => {
    const result = evaluateAction(
      scenario("preflop-button-shove-fold-equity"),
      "raise",
    );

    expect(result.correct).toBe(false);
    expect(result.close).toBe(true);
    expect(result.score).toBe(0.5);
    expect(result.regret).toBeCloseTo(0.44, 8);
  });

  it("accepts both actions inside a genuine EV-equivalence band", () => {
    const closeSpot = scenario("turn-close-flush-price");

    expect(evaluateAction(closeSpot, "call").score).toBe(1);
    expect(evaluateAction(closeSpot, "fold").score).toBe(1);
    expect(evaluateAction(closeSpot, "fold").regret).toBeCloseTo(0.03, 8);
  });

  it("rejects an action that is not legal or evaluated", () => {
    const result = evaluateAction(scenario("river-icm-bubble-call"), "raise");

    expect(result.correct).toBe(false);
    expect(result.score).toBe(0);
    expect(result.regret).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("math grading and tolerances", () => {
  const potOdds = scenario("preflop-pot-odds-ak");

  it("accepts practical table estimates inside the tolerance", () => {
    expect(evaluateMathAnswer(potOdds, 39).correct).toBe(true);
    expect(evaluateMathAnswer(potOdds, 41.5).correct).toBe(true);
  });

  it("awards partial credit inside the near-miss band", () => {
    const result = evaluateMathAnswer(potOdds, 43);

    expect(result.correct).toBe(false);
    expect(result.close).toBe(true);
    expect(result.score).toBe(0.5);
  });

  it("treats an omitted or non-finite answer as incorrect", () => {
    expect(evaluateMathAnswer(potOdds).score).toBe(0);
    expect(evaluateMathAnswer(potOdds, Number.NaN).score).toBe(0);
  });

  it("allows a one-out near miss when the full tolerance is exact", () => {
    const dirtyOuts = scenario("flop-dirty-straight-outs");

    expect(evaluateMathAnswer(dirtyOuts, 7).score).toBe(1);
    expect(evaluateMathAnswer(dirtyOuts, 8).score).toBe(0.5);
    expect(evaluateMathAnswer(dirtyOuts, 9).score).toBe(0);
  });
});

describe("separate Elo changes", () => {
  it("uses the expected-score curve and provisional K factor", () => {
    expect(expectedEloScore(1000, 1000)).toBe(0.5);
    expect(calculateEloDelta(1000, 1000, 1, 0)).toBe(16);
    expect(calculateEloDelta(1000, 1000, 0, 30)).toBe(-8);
  });

  it("updates decision and math ratings independently", () => {
    const graded = gradeTrainingAttempt({
      scenario: "preflop-pot-odds-ak",
      action: "call",
      mathAnswer: 10,
      decisionElo: 1000,
      mathElo: 1000,
      actionElapsedMs: 9000,
      mathElapsedMs: 12_000,
      completedAt: "2026-07-22T12:00:00.000Z",
      decisionAttempts: 3,
      mathAttempts: 3,
    });

    expect(graded.decisionEloDelta).toBeGreaterThan(0);
    expect(graded.mathEloDelta).toBeLessThan(0);
    expect(graded.result.eloDelta).toBe(
      graded.decisionEloDelta + graded.mathEloDelta,
    );
    expect(graded.result.actionCorrect).toBe(true);
    expect(graded.result.mathCorrect).toBe(false);
    expect(graded.result.elapsedMs).toBe(21_000);
    expect(graded.result.completedAt).toBe("2026-07-22T12:00:00.000Z");
  });
});

describe("timing metrics", () => {
  it("keeps action and math timing separate", () => {
    const timing = measureAttemptTiming(
      scenario("flop-flush-draw-all-in"),
      8000,
      10_000,
    );

    expect(timing.actionMs).toBe(8000);
    expect(timing.mathMs).toBe(10_000);
    expect(timing.totalMs).toBe(18_000);
    expect(timing.withinTableClock).toBe(true);
    expect(timing.pace).toBe("fast");
  });

  it("rejects invalid negative durations", () => {
    expect(() =>
      measureAttemptTiming(scenario("flop-flush-draw-all-in"), -1, 1000),
    ).toThrow(/cannot be negative/);
  });

  it("summarizes robust medians, p80, and clock-band accuracy", () => {
    const summary = summarizeTiming([
      {
        actionMs: 10_000,
        mathMs: 10_000,
        actionCorrect: true,
        mathCorrect: true,
      },
      {
        actionMs: 15_000,
        mathMs: 15_000,
        actionCorrect: false,
        mathCorrect: true,
      },
      {
        actionMs: 25_000,
        mathMs: 25_000,
        actionCorrect: true,
        mathCorrect: false,
      },
    ]);

    expect(summary.medianActionMs).toBe(15_000);
    expect(summary.medianMathMs).toBe(15_000);
    expect(summary.medianTotalMs).toBe(30_000);
    expect(summary.p80TotalMs).toBe(42_000);
    expect(summary.withinTableClockRate).toBeCloseTo(2 / 3, 8);
    expect(summary.decisionAccuracyWithinClock).toBe(0.5);
    expect(summary.mathAccuracyWithinClock).toBe(1);
  });
});

describe("near-transfer selection", () => {
  it("deterministically chooses the same math skill on a different street", () => {
    const next = selectNearTransferScenario("preflop-pot-odds-ak");

    expect(next?.id).toBe("river-bluff-catch-price");
    expect(next?.mathQuestion.topic).toBe("pot-odds");
    expect(next?.street).not.toBe("preflop");
  });

  it("deprioritizes completed scenarios and honors a focus topic", () => {
    const next = selectNearTransferScenario("preflop-pot-odds-ak", {
      completedScenarioIds: ["river-bluff-catch-price"],
      focusTopic: "equity",
    });

    expect(next?.id).not.toBe("river-bluff-catch-price");
    expect(next?.mathQuestion.topic).toBe("equity");
  });
});

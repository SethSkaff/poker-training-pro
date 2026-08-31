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
  selectTrainingSessionStartScenario,
  summarizeTiming,
  trainingScenarioHistorySimilarity,
  validateTrainingScenario,
  validateTrainingScenarioBank,
  trainingScenarioSimilarity,
  rejectUnsuitableScenarios,
  NEAR_DUPLICATE_SIMILARITY,
  TRAINING_SCENARIO_REPEAT_WINDOW,
} from "./trainingEngine";
import { defaultProgress, defaultSettings } from "./storage";
import { createSaveEnvelope, restoreSaveBackup } from "./saveMigration";

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

  it("grades a call in the short-stack shove spot instead of treating it as unavailable", () => {
    const result = evaluateAction(
      scenario("preflop-button-shove-fold-equity"),
      "call",
    );

    expect(result.chosenEv).toBeTypeOf("number");
    expect(result.correct).toBe(false);
    expect(result.score).toBe(0);
    expect(result.regret).toBeGreaterThan(
      scenario("preflop-button-shove-fold-equity").training.partialCreditRegret,
    );
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

  it("moves math Elo in the expected direction for blank, wrong, and correct attempts", () => {
    const base = {
      scenario: "preflop-pot-odds-ak",
      action: "call" as const,
      decisionElo: 1000,
      mathElo: 1000,
      actionElapsedMs: 1000,
      mathElapsedMs: 1000,
    };

    expect(gradeTrainingAttempt(base).mathEloDelta).toBeLessThan(0);
    expect(gradeTrainingAttempt({ ...base, mathAnswer: 10 }).mathEloDelta).toBeLessThan(0);
    expect(
      gradeTrainingAttempt({
        ...base,
        mathAnswer: scenario("preflop-pot-odds-ak").mathQuestion.correctValue,
      }).mathEloDelta,
    ).toBeGreaterThan(0);
  });

  it("persists both independently updated ratings in a Training save", () => {
    const graded = gradeTrainingAttempt({
      scenario: "preflop-pot-odds-ak",
      action: "call",
      mathAnswer: 10,
      decisionElo: defaultProgress.decisionElo,
      mathElo: defaultProgress.mathElo,
      actionElapsedMs: 1000,
      mathElapsedMs: 1000,
    });
    const restored = restoreSaveBackup(
      JSON.stringify(
        createSaveEnvelope(defaultSettings, {
          ...defaultProgress,
          decisionElo: graded.decisionEloAfter,
          mathElo: graded.mathEloAfter,
          results: [graded.result],
        }),
      ),
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.error.message);
    const persisted = restored.save;

    expect(persisted.data.progress.decisionElo).toBe(
      graded.decisionEloAfter,
    );
    expect(persisted.data.progress.mathElo).toBe(graded.mathEloAfter);
    expect(persisted.data.progress.results[0]).toMatchObject({
      mathAnswer: 10,
      mathCorrect: false,
    });
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
  it("deterministically chooses a different skill and action rather than cycling on one topic", () => {
    const next = selectNearTransferScenario("preflop-pot-odds-ak");

    expect(next?.id).not.toBe("river-bluff-catch-price");
    expect(next?.mathQuestion.topic).not.toBe("pot-odds");
    expect(next?.recommendedAction).not.toBe("call");
  });

  it("deprioritizes completed scenarios and honors a focus topic", () => {
    const next = selectNearTransferScenario("preflop-pot-odds-ak", {
      completedScenarioIds: ["river-bluff-catch-price"],
      focusTopic: "equity",
    });

    expect(next?.id).not.toBe("river-bluff-catch-price");
    expect(next?.mathQuestion.topic).toBe("equity");
  });

  it("covers the full bank without a fixed cycle from every starting scenario", () => {
    for (const start of trainingScenarios) {
      const ids = [start.id];
      let current = start;
      for (let draw = 0; draw < trainingScenarios.length * 2; draw += 1) {
        const next = selectNearTransferScenario(current, {
          completedScenarioIds: ids,
          recentScenarioIds: ids,
        });
        if (!next) throw new Error("Expected a training scenario");
        ids.push(next.id);
        current = next;
      }
      expect(new Set(ids).size).toBe(trainingScenarios.length);
      expect(new Set(ids.slice(-6)).size).toBe(6);
      expect(
        new Set(
          ids.map(
            (id) => trainingScenarios.find((scenario) => scenario.id === id)?.recommendedAction,
          ),
        ).size,
      ).toBeGreaterThan(2);
    }
  });

  it("never repeats any of the prior 50 ids when a fresh scenario exists", () => {
    const base = scenario("preflop-pot-odds-ak");
    const pool = Array.from(
      { length: TRAINING_SCENARIO_REPEAT_WINDOW + 2 },
      (_, index): RatedTrainingScenario => ({
        ...base,
        id: `repeat-window-${index}`,
      }),
    );
    const current = pool[TRAINING_SCENARIO_REPEAT_WINDOW];
    const recentScenarioIds = pool
      .slice(0, TRAINING_SCENARIO_REPEAT_WINDOW)
      .map((item) => item.id);

    const next = selectNearTransferScenario(
      current,
      { recentScenarioIds },
      pool,
    );

    expect(next?.id).toBe(`repeat-window-${TRAINING_SCENARIO_REPEAT_WINDOW + 1}`);
    expect(recentScenarioIds).not.toContain(next?.id);
  });

  it("tracks the poker features needed to avoid near-duplicate recent prompts", () => {
    const source = scenario("preflop-pot-odds-ak");
    const lookalike: RatedTrainingScenario = {
      ...source,
      id: "preflop-pot-odds-ak-lookalike",
      prompt: "Against the shown range, the small blind shoves and action returns to you.",
    };
    const similarity = trainingScenarioHistorySimilarity(lookalike, source);

    expect(similarity).toMatchObject({
      sameHeroCards: true,
      sameBoardTexture: true,
      sameStackStructure: true,
      samePotOddsThreshold: true,
      sameAction: true,
      sameLesson: true,
    });
    expect(similarity.wordingOverlap).toBeGreaterThan(0);

    const next = selectNearTransferScenario(
      source,
      { recentScenarioIds: [source.id] },
      [source, lookalike, scenario("turn-semi-bluff-ev")],
    );
    expect(next?.id).toBe("turn-semi-bluff-ev");
  });

  it("selects reproducible starts that are not permanently the first scenario", () => {
    const starts = ["Ada", "Ben", "Cleo", "Drew"].map((name) =>
      selectTrainingSessionStartScenario(name)?.id,
    );
    expect(selectTrainingSessionStartScenario("Ada")?.id).toBe(starts[0]);
    expect(new Set(starts).size).toBeGreaterThan(1);
    expect(starts.some((id) => id !== trainingScenarios[0]?.id)).toBe(true);
  });

  it("uses decision Elo and math Elo independently when selecting the next scenario", () => {
    const current = scenario("preflop-pot-odds-ak");
    const lowDecision = selectNearTransferScenario(current, {
      decisionElo: 1000,
      mathElo: 1500,
    });
    const highDecision = selectNearTransferScenario(current, {
      decisionElo: 1500,
      mathElo: 1000,
    });

    expect(lowDecision?.training.decisionDifficulty).toBeLessThanOrEqual(1340);
    expect(lowDecision?.training.mathDifficulty).toBeGreaterThanOrEqual(1160);
    expect(highDecision?.training.decisionDifficulty).toBeGreaterThanOrEqual(1210);
    expect(highDecision?.training.mathDifficulty).toBeLessThanOrEqual(1230);
  });

  it("keeps beginners out of the hardest bank tier and advanced players out of trivial tiers", () => {
    const low = selectTrainingSessionStartScenario("Ada", [], trainingScenarios, {
      decisionElo: 1000,
      mathElo: 1000,
    });
    const high = selectTrainingSessionStartScenario("Ada", [], trainingScenarios, {
      decisionElo: 1700,
      mathElo: 1700,
    });

    expect(low?.training.decisionDifficulty).toBeLessThanOrEqual(1340);
    expect(low?.training.mathDifficulty).toBeLessThanOrEqual(1230);
    expect(high?.training.decisionDifficulty).toBeGreaterThanOrEqual(1210);
    expect(high?.training.mathDifficulty).toBeGreaterThanOrEqual(1160);
    expect(selectTrainingSessionStartScenario("Ada", [], trainingScenarios, {
      decisionElo: 1700,
      mathElo: 1700,
    })?.id).toBe(high?.id);
  });
});

describe("near-duplicate rejection", () => {
  it("treats a scenario differing by a chip as the same question", () => {
    // Strict structural fingerprinting passes this pair as distinct, which is
    // exactly the gap E15-002 names: a learner does not experience "pot 2700"
    // and "pot 2750" as different problems.
    const [base] = trainingScenarios;
    const nudged = {
      ...base,
      id: `${base.id}-nudged`,
      pot: Math.round(base.pot * 1.01),
    };
    expect(
      trainingScenarioSimilarity(base, nudged),
    ).toBeGreaterThanOrEqual(NEAR_DUPLICATE_SIMILARITY);
  });

  it("treats a genuinely different spot as different", () => {
    const byStreet = new Map(
      trainingScenarios.map((scenario) => [scenario.street, scenario]),
    );
    const preflop = byStreet.get("preflop");
    const river = byStreet.get("river");
    if (!preflop || !river) return;
    expect(trainingScenarioSimilarity(preflop, river)).toBeLessThan(
      NEAR_DUPLICATE_SIMILARITY,
    );
  });

  it("is reflexive and symmetric", () => {
    const [first, second] = trainingScenarios;
    expect(trainingScenarioSimilarity(first, first)).toBe(1);
    expect(trainingScenarioSimilarity(first, second)).toBe(
      trainingScenarioSimilarity(second, first),
    );
  });

  it("reports why each candidate was rejected", () => {
    const [current, recent] = trainingScenarios;
    const trace = rejectUnsuitableScenarios(current, trainingScenarios, {
      recentScenarios: [recent],
    });

    expect(trace.rejected.find((entry) => entry.id === current.id)?.reason).toBe(
      "current",
    );
    expect(trace.rejected.find((entry) => entry.id === recent.id)?.reason).toBe(
      "recently-served",
    );
    // Reasons are inspectable rather than buried in a score weight.
    for (const entry of trace.rejected) {
      expect([
        "current",
        "recently-served",
        "near-duplicate-of-recent",
        "off-target-difficulty",
      ]).toContain(entry.reason);
    }
  });

  it("falls back rather than deadlocking when everything is rejected", () => {
    // A hard filter over a twelve-scenario bank would eventually reject the
    // whole pool. Serving a repeat is worse than serving something fresh, but
    // far better than serving nothing.
    const [current] = trainingScenarios;
    const next = selectNearTransferScenario(current, {
      recentScenarioIds: trainingScenarios.map((scenario) => scenario.id),
    });
    expect(next).toBeDefined();
  });
});

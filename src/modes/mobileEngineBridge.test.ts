import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

import { evaluateBestHand, compareHandValues } from "../engine/evaluator";
import { createShuffledDeck } from "../engine/deck";
import { parseQuizMathAnswer } from "../lib/localeNumbers";
import { gradeTrainingAttempt, calculateEloDelta } from "../lib/trainingEngine";
import { trainingScenarios } from "../data/trainingScenarios";
import { calculateAiDecisionTiming } from "./decisionTiming";
import { directTimedBlinds } from "./timedBlindDirector";
import type { PokerAction, Street } from "../types/poker";

/**
 * Cross-runtime parity: the bundled mobile `poker-engine.js` (evaluated in an
 * isolated VM the same way JavaScriptCore evaluates it on device) must produce
 * the same results as the desktop TypeScript engine for the same inputs. This
 * is the strongest verification available on Windows, where no iOS Simulator,
 * Swift compiler, or JavaScriptCore runtime exists.
 */

const ENGINE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../ios/PokerTrainingPro/Resources/Engine/poker-engine.js",
);

interface EngineGlobal {
  PokerTrainingEngine: {
    contractVersion: string;
    invoke: (requestJSON: string) => string;
  };
}

function loadEngine(): EngineGlobal["PokerTrainingEngine"] {
  const source = readFileSync(ENGINE_PATH, "utf8");
  const context: Record<string, unknown> = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "poker-engine.js" });
  const engine = (context as unknown as EngineGlobal).PokerTrainingEngine;
  if (!engine || typeof engine.invoke !== "function") {
    throw new Error("Engine did not expose PokerTrainingEngine.invoke");
  }
  return engine;
}

const engine = loadEngine();

interface EngineResponse {
  contractVersion: string;
  requestID: string;
  ok: boolean;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

let requestCounter = 0;
function call(operation: string, payload: Record<string, unknown> = {}, seed?: string): EngineResponse {
  requestCounter += 1;
  const request = {
    contractVersion: "1.0.0",
    requestID: `test-${requestCounter}`,
    operation,
    seed,
    payload,
  };
  return JSON.parse(engine.invoke(JSON.stringify(request))) as EngineResponse;
}

function ok(operation: string, payload: Record<string, unknown> = {}, seed?: string): Record<string, unknown> {
  const response = call(operation, payload, seed);
  expect(response.ok, `${operation} failed: ${response.error?.message}`).toBe(true);
  return response.result as Record<string, unknown>;
}

describe("mobile engine contract", () => {
  it("exposes the expected contract version and operations", () => {
    expect(engine.contractVersion).toBe("1.0.0");
    const health = ok("health");
    expect(health.deterministic).toBe(true);
    expect(Array.isArray(health.operations)).toBe(true);
    expect(health.operations).toContain("botDecision");
  });

  it("rejects malformed envelopes", () => {
    expect(JSON.parse(engine.invoke("{not json"))).toMatchObject({ ok: false, error: { code: "INVALID_JSON" } });
    const mismatch = JSON.parse(
      engine.invoke(JSON.stringify({ contractVersion: "9.9.9", requestID: "x", operation: "health", payload: {} })),
    );
    expect(mismatch).toMatchObject({ ok: false, error: { code: "CONTRACT_MISMATCH" } });
    expect(call("does-not-exist")).toMatchObject({ ok: false, error: { code: "UNKNOWN_OPERATION" } });
  });

  it("keeps dealPreview deterministic per seed", () => {
    const first = ok("dealPreview", {}, "same-seed");
    const second = ok("dealPreview", {}, "same-seed");
    expect(first).toEqual(second);
    expect((first.hero as unknown[]).length).toBe(2);
    expect((first.board as unknown[]).length).toBe(3);
  });
});

describe("hand evaluator parity", () => {
  it("matches evaluateBestHand across 200 seeded seven-card hands", () => {
    for (let index = 0; index < 200; index += 1) {
      const deck = createShuffledDeck(`hand-${index}`);
      const cards = deck.slice(0, 7);
      const expected = evaluateBestHand(cards);
      const actual = ok("evaluateHand", { cards });
      expect(actual.category, `hand ${index}`).toBe(expected.category);
      expect(actual.categoryName).toBe(expected.categoryName);
      expect(actual.displayName).toBe(expected.displayName);
      expect(actual.tiebreak).toEqual(expected.tiebreak);
    }
  });

  it("matches compareHandValues over seeded matchups", () => {
    for (let index = 0; index < 120; index += 1) {
      const deck = createShuffledDeck(`compare-${index}`);
      const left = deck.slice(0, 7);
      const right = deck.slice(7, 14);
      const expected = compareHandValues(evaluateBestHand(left), evaluateBestHand(right));
      const actual = ok("compareHands", { left, right });
      expect(actual.result, `matchup ${index}`).toBe(expected);
    }
  });
});

describe("quiz parsing parity", () => {
  const cases: Array<{ input: string; unit: "%" | "chips" | "outs" | "ratio" }> = [
    { input: "33%", unit: "%" },
    { input: "0.33", unit: "%" },
    { input: "1/3", unit: "%" },
    { input: "2:1", unit: "%" },
    { input: "3:5", unit: "ratio" },
    { input: "40", unit: "%" },
    { input: "40%", unit: "%" },
    { input: "0,4", unit: "%" },
    { input: "1 800", unit: "chips" },
    { input: "1'800", unit: "chips" },
    { input: "9", unit: "outs" },
    { input: "3/4", unit: "ratio" },
    { input: "5,500", unit: "chips" },
    { input: "not-a-number", unit: "%" },
    { input: "50%", unit: "chips" },
    { input: "", unit: "%" },
    { input: "1:2:3", unit: "%" },
    { input: "0.5", unit: "ratio" },
    { input: "2.5:1", unit: "%" },
    { input: "  66  ", unit: "%" },
  ];

  it("matches parseQuizMathAnswer for every documented form", () => {
    for (const { input, unit } of cases) {
      const expected = parseQuizMathAnswer(input, unit);
      const result = ok("parseMathAnswer", { input, unit });
      const actual = result.value === null ? undefined : (result.value as number);
      if (expected === undefined) {
        expect(actual, `input ${JSON.stringify(input)} (${unit})`).toBeUndefined();
      } else {
        expect(actual, `input ${JSON.stringify(input)} (${unit})`).toBeCloseTo(expected, 9);
      }
    }
  });
});

describe("Elo parity", () => {
  it("matches calculateEloDelta over a grid", () => {
    for (const rating of [900, 1200, 1500]) {
      for (const difficulty of [800, 1200, 1600]) {
        for (const score of [0, 0.5, 1]) {
          for (const attempts of [0, 10, 45]) {
            // Normalize -0 to +0: JSON round-trips negative zero to 0, so the
            // bundle correctly reports 0 where the TS Math.round yields -0.
            const expected = calculateEloDelta(rating, difficulty, score, attempts) + 0;
            const result = ok("eloDelta", { rating, difficulty, score, attempts });
            expect(result.delta, `${rating}/${difficulty}/${score}/${attempts}`).toBe(expected);
          }
        }
      }
    }
  });
});

describe("training grading parity", () => {
  it("matches gradeTrainingAttempt on real scenarios and raw quiz input", () => {
    const actions: PokerAction[] = ["fold", "call", "raise", "check", "all-in"];
    trainingScenarios.slice(0, 20).forEach((scenario, index) => {
      const action = actions[index % actions.length];
      const rawInput = `${scenario.mathQuestion.correctValue}${scenario.mathQuestion.unit === "%" ? "%" : ""}`;
      const mathAnswer = parseQuizMathAnswer(rawInput, scenario.mathQuestion.unit);
      const decisionElo = 1100;
      const mathElo = 1050;

      const expected = gradeTrainingAttempt({
        scenario,
        action,
        mathAnswer,
        decisionElo,
        mathElo,
        actionElapsedMs: 6000,
        mathElapsedMs: 8000,
        decisionAttempts: 5,
        mathAttempts: 5,
      });

      const result = ok("gradeTraining", {
        action,
        mathInput: rawInput,
        unit: scenario.mathQuestion.unit,
        correctValue: scenario.mathQuestion.correctValue,
        tolerance: scenario.mathQuestion.tolerance,
        mathExplanation: scenario.mathQuestion.explanation,
        actionEvs: scenario.training.actionEvs,
        actionEpsilon: scenario.training.actionEpsilon,
        partialCreditRegret: scenario.training.partialCreditRegret,
        acceptableActions: scenario.acceptableActions ?? [],
        actionReason: scenario.actionReason,
        decisionElo,
        mathElo,
        decisionDifficulty: scenario.training.decisionDifficulty,
        mathDifficulty: scenario.training.mathDifficulty,
        decisionAttempts: 5,
        mathAttempts: 5,
        actionElapsedMs: 6000,
        mathElapsedMs: 8000,
        targetDecisionMs: scenario.training.targetDecisionMs,
        targetMathMs: scenario.training.targetMathMs,
      });

      const actionResult = result.action as Record<string, unknown>;
      const mathResult = result.math as Record<string, unknown>;
      const timingResult = result.timing as Record<string, unknown>;

      expect(actionResult.score, `${scenario.id} action score`).toBe(expected.action.score);
      expect(actionResult.correct).toBe(expected.action.correct);
      expect(actionResult.close).toBe(expected.action.close);
      expect(actionResult.bestAction).toBe(expected.action.bestAction);
      expect(mathResult.score, `${scenario.id} math score`).toBe(expected.math.score);
      expect(mathResult.correct).toBe(expected.math.correct);
      expect(timingResult.pace).toBe(expected.timing.pace);
      expect(timingResult.withinTableClock).toBe(expected.timing.withinTableClock);
      expect(result.decisionEloDelta).toBe(expected.decisionEloDelta);
      expect(result.mathEloDelta).toBe(expected.mathEloDelta);
      expect(result.decisionEloAfter).toBe(expected.decisionEloAfter);
      expect(result.mathEloAfter).toBe(expected.mathEloAfter);
    });
  });
});

describe("decision timing parity", () => {
  it("matches calculateAiDecisionTiming including the mobile surface budget", () => {
    const streets: Street[] = ["preflop", "flop", "turn", "river"];
    const actions: PokerAction[] = ["fold", "check", "call", "raise", "all-in"];
    let checks = 0;
    for (let index = 0; index < streets.length; index += 1) {
      for (let a = 0; a < actions.length; a += 1) {
        for (const rate of [0.5, 1, 2]) {
          for (const surface of ["mobile", "desktop"] as const) {
            const input = {
              seed: `timing-${index}-${a}`,
              decisionId: `d-${index}-${a}`,
              street: streets[index],
              action: actions[a],
              cutoffCloseness: 0.4,
              uncertainty: 0.6,
              tempo: 0.2,
              presentationRate: rate,
              surface,
            };
            const expected = calculateAiDecisionTiming(input);
            const result = ok("decisionTiming", input as unknown as Record<string, unknown>);
            expect(result.delayMs, JSON.stringify(input)).toBe(expected.delayMs);
            expect(result.unscaledDelayMs).toBe(expected.unscaledDelayMs);
            expect(result.antiTellNoiseMs).toBe(expected.antiTellNoiseMs);
            expect(result.boundedDifficultyMs).toBe(expected.boundedDifficultyMs);
            expect(result.surface).toBe(expected.surface);
            checks += 1;
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(100);
  });

  it("defaults to the shorter mobile budget", () => {
    const result = ok("decisionTiming", {
      seed: "s",
      decisionId: "d",
      street: "flop",
      action: "call",
      cutoffCloseness: 0,
      uncertainty: 0,
      tempo: 0,
      presentationRate: 1,
    });
    expect(result.surface).toBe("mobile");
    expect(result.unscaledDelayMs as number).toBeLessThanOrEqual(2800);
  });
});

describe("timed blind director parity", () => {
  it("matches directTimedBlinds across phases", () => {
    const players = [
      { id: "a", stack: 30000 },
      { id: "b", stack: 22000 },
      { id: "c", stack: 15000 },
      { id: "d", stack: 8000 },
    ];
    const current = { smallBlind: 100, bigBlind: 200, bigBlindAnte: 200 };
    for (const durationMinutes of [15, 45, 90]) {
      for (const fraction of [0, 0.3, 0.6, 0.8, 1, 1.1]) {
        const elapsedMs = Math.round(durationMinutes * 60000 * fraction);
        const input = {
          durationMinutes,
          elapsedMs,
          current,
          players,
          startingTotalChips: 75000,
        };
        const expected = directTimedBlinds(input);
        const result = ok("timedBlinds", input as unknown as Record<string, unknown>);
        expect(result.bigBlind, `${durationMinutes}m @${fraction}`).toBe(expected.bigBlind);
        expect(result.smallBlind).toBe(expected.smallBlind);
        expect(result.bigBlindAnte).toBe(expected.bigBlindAnte);
        expect(result.phase).toBe(expected.phase);
        expect(result.forcedAllInStack).toBe(expected.forcedAllInStack);
      }
    }
  });
});

describe("on-device equity caps and determinism", () => {
  const hero = [
    { rank: "A", suit: "spades" },
    { rank: "K", suit: "spades" },
  ];
  const board = [
    { rank: "Q", suit: "spades" },
    { rank: "J", suit: "hearts" },
    { rank: "2", suit: "clubs" },
  ];

  it("is deterministic for a fixed seed", () => {
    const first = ok("estimateEquity", { hero, board, opponents: 2, simulations: 200 }, "equity-seed");
    const second = ok("estimateEquity", { hero, board, opponents: 2, simulations: 200 }, "equity-seed");
    expect(first).toEqual(second);
    expect(first.equity as number).toBeGreaterThan(0);
    expect(first.equity as number).toBeLessThanOrEqual(1);
  });

  it("hard-caps simulations to the phone ceiling", () => {
    const result = ok("estimateEquity", { hero, board, opponents: 3, simulations: 100000 }, "cap-seed");
    const work = result.work as Record<string, unknown>;
    expect(work.completedSimulations as number).toBeLessThanOrEqual(600);
    expect(work.maximumSimulationsPerDecision).toBe(600);
    expect(work.simulationsPerSlice as number).toBeLessThanOrEqual(32);
  });

  it("produces a bot decision for both styles within the cap", () => {
    for (const style of ["normal", "rational"]) {
      const decision = ok(
        "botDecision",
        { style, hero, board, opponents: 2, pot: 1200, toCall: 400, bigBlind: 200, legalRaiseTo: 1200 },
        "bot-seed",
      );
      expect(["fold", "check", "call", "raise", "all-in"]).toContain(decision.action);
      const work = decision.work as Record<string, unknown>;
      expect(work.completedSimulations as number).toBeLessThanOrEqual(600);
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { BLACKJACK_RULES, cardFromRank, createSeededRng, getAvailableActions, getInsuranceAction, getOptimalAction, handValue } from "./engine";
import {
  answerTrainerSession, createTrainerScenario, defaultTrainerProgress,
  loadTrainerProgress, nextTrainerSession, saveTrainerProgress,
  trainerScenarioKey, type TrainerScenario,
} from "./trainer";

function correctAction(scenario: TrainerScenario) {
  return scenario.kind === "insurance" ? getInsuranceAction(scenario.trueCount) :
    getOptimalAction(scenario.hand, scenario.dealerUpcard, scenario.trueCount, BLACKJACK_RULES, scenario.availableActions).action;
}

afterEach(() => {
  saveTrainerProgress({ ...defaultTrainerProgress, recentKeys: [] });
  vi.unstubAllGlobals();
});

describe("generated blackjack practice", () => {
  it("never repeats a decision family within ten turns, including session restarts", () => {
    const random = createSeededRng(7823);
    let progress = { ...defaultTrainerProgress };
    const history: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 350; i++) {
      // Exercise selection independently of correctness and across all ratings.
      const session = nextTrainerSession({ ...progress, elo: 400 + i % 21 * 100 }, random);
      const key = trainerScenarioKey(session.scenario);
      expect(history.slice(-10)).not.toContain(key);
      history.push(key);
      seen.add(key);
      progress = session.progress;
      if (i % 7 === 0) {
        saveTrainerProgress(progress);
        progress = loadTrainerProgress();
      }
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it("ignores suits, count, composition and legal-action differences in the repeat key", () => {
    const base = { kind: "action" as const, hand: { cards: [cardFromRank("10"), cardFromRank("6")] }, dealerUpcard: cardFromRank("K") };
    const variant = { ...base, hand: { cards: [cardFromRank("4", "♥"), cardFromRank("5"), cardFromRank("7")] }, dealerUpcard: cardFromRank("10", "♦") };
    expect(trainerScenarioKey(base)).toBe(trainerScenarioKey(variant));
  });

  it("stays varied even when the random source always returns the same value", () => {
    for (const value of [0, 0.5, 0.999999]) {
      let progress = { ...defaultTrainerProgress };
      for (let i = 0; i < 35; i++) {
        const session = nextTrainerSession(progress, () => value);
        expect(progress.recentKeys).not.toContain(trainerScenarioKey(session.scenario));
        progress = session.progress;
      }
    }
  });

  it("generates legal, nonterminal hands with consistent grading and varied compositions", () => {
    const random = createSeededRng(9817);
    let progress = { ...defaultTrainerProgress, elo: 1800 };
    const answers = new Set<string>();
    const handSizes = new Set<number>();
    for (let i = 0; i < 250; i++) {
      const session = nextTrainerSession(progress, random);
      const scenario = session.scenario;
      progress = session.progress;
      expect(handValue(scenario.hand.cards).total).toBeLessThan(21);
      expect(Number.isInteger(scenario.trueCount)).toBe(true);
      if (scenario.kind === "insurance") {
        expect(scenario.dealerUpcard.rank).toBe("A");
      } else {
        expect(scenario.availableActions).toEqual(getAvailableActions(scenario.hand, scenario.dealerUpcard));
        expect(scenario.availableActions).toContain(correctAction(scenario));
        expect(new Set(scenario.hand.cards.map((card) => card.id)).size).toBe(scenario.hand.cards.length);
        handSizes.add(scenario.hand.cards.length);
      }
      answers.add(correctAction(scenario));
      const graded = answerTrainerSession(session, correctAction(scenario));
      expect(graded.result?.correct).toBe(true);
    }
    expect(handSizes).toEqual(new Set([2, 3]));
    expect(answers).toEqual(new Set(["hit", "stand", "double", "split", "surrender", "insurance", "decline"]));
  });

  it("gives beginners neutral counts and foundations while advanced play mixes both sides of indices", () => {
    const sample = (elo: number) => {
      const random = createSeededRng(87121);
      let progress = { ...defaultTrainerProgress, elo };
      const scenarios: TrainerScenario[] = [];
      for (let i = 0; i < 400; i++) {
        const session = nextTrainerSession(progress, random);
        progress = session.progress;
        scenarios.push(session.scenario);
      }
      return {
        scenarios,
        deviations: scenarios.filter((s) => s.lesson === "deviation").length / scenarios.length,
        neutral: scenarios.filter((s) => s.trueCount === 0).length / scenarios.length,
        edges: scenarios.filter((s) => s.nearThreshold).length / scenarios.length,
        difficulty: scenarios.reduce((sum, s) => sum + s.difficulty, 0) / scenarios.length,
      };
    };
    const beginner = sample(900);
    const advanced = sample(1800);
    expect(beginner.deviations).toBeGreaterThan(0.05);
    expect(beginner.deviations).toBeLessThan(0.23);
    expect(beginner.neutral).toBeGreaterThan(0.25);
    expect(advanced.deviations).toBeGreaterThan(0.30);
    expect(advanced.deviations).toBeLessThan(0.55);
    expect(advanced.edges).toBeGreaterThan(beginner.edges + 0.10);
    expect(advanced.difficulty).toBeGreaterThan(beginner.difficulty + 150);
    expect(beginner.neutral).toBeGreaterThan(advanced.neutral);
    for (const sign of [-1, 1]) {
      for (const lesson of ["foundation", "reinforcement", "deviation"]) {
        expect(advanced.scenarios.some((s) => s.kind === "action" && s.lesson === lesson && Math.sign(s.trueCount) === sign)).toBe(true);
      }
      expect(advanced.scenarios.some((s) => s.lesson === "reinforcement" && s.nearThreshold && Math.sign(s.trueCount) === sign)).toBe(true);
      const actions = new Set(advanced.scenarios.filter((s) => Math.sign(s.trueCount) === sign).map(correctAction));
      expect(actions.has("hit")).toBe(true);
      expect(actions.has("stand")).toBe(true);
    }
  });

  it("uses injected randomness reproducibly without a turn-number-based sequence", () => {
    expect(createTrainerScenario(1200, [], createSeededRng(7))).toEqual(createTrainerScenario(1200, [], createSeededRng(7)));
    expect(createTrainerScenario(1200, [], createSeededRng(8))).not.toEqual(createTrainerScenario(1200, [], createSeededRng(7)));
  });
});

describe("blackjack ELO and persistence", () => {
  it("updates once per answer, rewards harder decisions more and penalizes easier misses more", () => {
    const session = nextTrainerSession(defaultTrainerProgress, createSeededRng(9));
    const answer = correctAction(session.scenario);
    const easy = { ...session, scenario: { ...session.scenario, difficulty: 750 } };
    const hard = { ...session, scenario: { ...session.scenario, difficulty: 1600 } };
    const easyCorrect = answerTrainerSession(easy, answer);
    const hardCorrect = answerTrainerSession(hard, answer);
    expect(easyCorrect.progress.elo).toBeGreaterThan(900);
    expect(hardCorrect.progress.elo).toBeGreaterThan(easyCorrect.progress.elo);
    expect(answerTrainerSession(hardCorrect, answer)).toBe(hardCorrect);
    expect(hardCorrect.progress.answered).toBe(1);
    const wrong = session.scenario.kind === "insurance" ? (answer === "insurance" ? "decline" : "insurance") : session.scenario.availableActions.find((action) => action !== answer)!;
    expect(answerTrainerSession(easy, wrong).progress.elo).toBeLessThan(answerTrainerSession(hard, wrong).progress.elo);
    expect(answerTrainerSession(hard, wrong).progress.elo).toBeLessThan(900);
    expect(answerTrainerSession(easy, wrong).progress.correct).toBe(0);
  });

  it("round-trips the rating and recent history, rejects corrupt saves and tolerates blocked storage", () => {
    let stored: string | null = null;
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } });
    const session = nextTrainerSession({ elo: 1432, answered: 40, correct: 29, recentKeys: [] }, createSeededRng(10));
    expect(saveTrainerProgress(session.progress)).toBe(true);
    expect(loadTrainerProgress()).toEqual(session.progress);
    stored = '{"elo": null, "answered": -1}';
    expect(loadTrainerProgress()).toEqual(session.progress);
    stored = "{invalid";
    expect(loadTrainerProgress()).toEqual(session.progress);
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } });
    expect(saveTrainerProgress(session.progress)).toBe(false);
    expect(loadTrainerProgress()).toEqual(session.progress);
  });
});

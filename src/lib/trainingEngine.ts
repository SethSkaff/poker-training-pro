import {
  trainingScenarioById,
  trainingScenarios,
  type RatedTrainingScenario,
} from "../data/trainingScenarios";
import {
  validateTrainingScenario as validateScenarioSchema,
  validateTrainingScenarioBank as validateScenarioBankSchema,
} from "../data/trainingScenarioSchema";
import type {
  MathQuestion,
  MathTopic,
  PokerAction,
  TrainingResult,
} from "../types/poker";
import {
  parseQuizMathAnswer,
  type NumericLocaleResource,
} from "./localeNumbers";
import { compareHandValues, createDeck, createSeededRandom, evaluateBestHand } from "../engine";

const TABLE_CLOCK_MS = 30_000;

export function validateTrainingScenario(
  scenario: RatedTrainingScenario,
): string[] {
  return validateScenarioSchema(scenario);
}

export function validateTrainingScenarioBank(
  scenarios: readonly RatedTrainingScenario[] = trainingScenarios,
): string[] {
  return validateScenarioBankSchema(scenarios);
}

export interface ActionEvaluation {
  action: PokerAction;
  bestAction: PokerAction;
  bestEv: number;
  chosenEv?: number;
  regret: number;
  score: 0 | 0.5 | 1;
  correct: boolean;
  close: boolean;
  explanation: string;
}

export interface MathEvaluation {
  answer?: number;
  correctValue: number;
  error: number;
  tolerance: number;
  score: 0 | 0.5 | 1;
  correct: boolean;
  close: boolean;
  explanation: string;
}

export type PaceBand = "fast" | "steady" | "deliberate";

export interface AttemptTiming {
  actionMs: number;
  mathMs: number;
  totalMs: number;
  actionTargetRatio: number;
  mathTargetRatio: number;
  pace: PaceBand;
  withinTableClock: boolean;
}

export interface GradeTrainingAttemptInput {
  scenario: RatedTrainingScenario | string;
  action: PokerAction;
  mathAnswer?: number;
  decisionElo: number;
  mathElo: number;
  actionElapsedMs: number;
  mathElapsedMs: number;
  completedAt?: string;
  decisionAttempts?: number;
  mathAttempts?: number;
}

export interface GradedTrainingAttempt {
  result: TrainingResult;
  action: ActionEvaluation;
  math: MathEvaluation;
  timing: AttemptTiming;
  decisionEloDelta: number;
  mathEloDelta: number;
  decisionEloAfter: number;
  mathEloAfter: number;
}

export interface TimingSample {
  actionMs: number;
  mathMs: number;
  actionCorrect: boolean;
  mathCorrect: boolean;
}

export interface TimingSummary {
  attempts: number;
  medianActionMs: number;
  medianMathMs: number;
  medianTotalMs: number;
  p80TotalMs: number;
  withinTableClockRate: number;
  decisionAccuracyWithinClock: number;
  mathAccuracyWithinClock: number;
}

export interface NearTransferOptions {
  completedScenarioIds?: Iterable<string>;
  /** Most recent completed/current ids, newest last. Kept out of the next draw. */
  recentScenarioIds?: Iterable<string>;
  focusTopic?: MathTopic;
  preferDifferentStreet?: boolean;
  /**
   * The two ratings deliberately stay separate: a player can receive a more
   * demanding decision while still practising approachable arithmetic, or the
   * reverse. Omit both to use the bank's neutral, diverse ordering.
   */
  decisionElo?: number;
  mathElo?: number;
}

export interface TrainingStartOptions {
  decisionElo?: number;
  mathElo?: number;
}

/**
 * Parses the compact answers players commonly use at a poker table.
 *
 * Percentage questions accept `33`, `33%`, `0.33`, `1/3`, and odds-against
 * notation such as `2:1` (one win in three outcomes = 33.33%).
 * Ratio questions treat `3:5` and `3/5` as the literal ratio 0.6.
 */
export function parseMathAnswer(
  input: string,
  unit: MathQuestion["unit"],
  locale?: NumericLocaleResource,
): number | undefined {
  return parseQuizMathAnswer(input, unit, locale);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function nonNegativeDuration(value: number, label: string): number {
  assertFinite(value, label);
  if (value < 0) {
    throw new RangeError(`${label} cannot be negative.`);
  }
  return Math.round(value);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableBestAction(
  actionEvs: Partial<Record<PokerAction, number>>,
): [PokerAction, number] {
  const entries = Object.entries(actionEvs).filter(
    (entry): entry is [PokerAction, number] => Number.isFinite(entry[1]),
  );

  if (entries.length === 0) {
    throw new Error("A rated scenario must provide at least one finite action EV.");
  }

  entries.sort(([actionA, evA], [actionB, evB]) => {
    if (evA !== evB) return evB - evA;
    return actionA.localeCompare(actionB);
  });
  return entries[0];
}

export function evaluateAction(
  scenario: RatedTrainingScenario,
  action: PokerAction,
): ActionEvaluation {
  const [bestAction, bestEv] = stableBestAction(scenario.training.actionEvs);
  const chosenEv = scenario.training.actionEvs[action];
  const regret =
    chosenEv === undefined || !Number.isFinite(chosenEv)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, bestEv - chosenEv);

  const explicitlyAccepted = scenario.acceptableActions?.includes(action) ?? false;
  const fullCredit =
    explicitlyAccepted || regret <= scenario.training.actionEpsilon + Number.EPSILON;
  const partialCredit =
    !fullCredit &&
    regret <= scenario.training.partialCreditRegret + Number.EPSILON;
  const score: 0 | 0.5 | 1 = fullCredit ? 1 : partialCredit ? 0.5 : 0;

  return {
    action,
    bestAction,
    bestEv,
    chosenEv,
    regret,
    score,
    correct: fullCredit,
    close: partialCredit,
    explanation: scenario.actionReason,
  };
}

export function evaluateMathAnswer(
  scenario: RatedTrainingScenario,
  answer?: number,
): MathEvaluation {
  const { correctValue, tolerance, explanation, unit } = scenario.mathQuestion;
  const hasAnswer = answer !== undefined && Number.isFinite(answer);
  const error = hasAnswer
    ? Math.abs((answer as number) - correctValue)
    : Number.POSITIVE_INFINITY;
  const nearMissTolerance =
    tolerance > 0 ? tolerance * 2 : unit === "outs" ? 1 : 0;
  const fullCredit = error <= tolerance + Number.EPSILON;
  const partialCredit =
    !fullCredit && error <= nearMissTolerance + Number.EPSILON;
  const score: 0 | 0.5 | 1 = fullCredit ? 1 : partialCredit ? 0.5 : 0;

  return {
    answer: hasAnswer ? answer : undefined,
    correctValue,
    error,
    tolerance,
    score,
    correct: fullCredit,
    close: partialCredit,
    explanation,
  };
}

export function expectedEloScore(rating: number, difficulty: number): number {
  assertFinite(rating, "rating");
  assertFinite(difficulty, "difficulty");
  return 1 / (1 + 10 ** ((difficulty - rating) / 400));
}

export function calculateEloDelta(
  rating: number,
  difficulty: number,
  score: number,
  attempts = 0,
): number {
  assertFinite(score, "score");
  assertFinite(attempts, "attempts");
  if (attempts < 0) {
    throw new RangeError("attempts cannot be negative.");
  }

  const kFactor = attempts < 30 ? 32 : 16;
  const expected = expectedEloScore(rating, difficulty);
  return Math.round(kFactor * (clampScore(score) - expected));
}

export function measureAttemptTiming(
  scenario: RatedTrainingScenario,
  actionElapsedMs: number,
  mathElapsedMs: number,
): AttemptTiming {
  const actionMs = nonNegativeDuration(actionElapsedMs, "actionElapsedMs");
  const mathMs = nonNegativeDuration(mathElapsedMs, "mathElapsedMs");
  const totalMs = actionMs + mathMs;
  const actionTargetRatio = actionMs / scenario.training.targetDecisionMs;
  const mathTargetRatio = mathMs / scenario.training.targetMathMs;
  const averageRatio = (actionTargetRatio + mathTargetRatio) / 2;
  const pace: PaceBand =
    averageRatio <= 0.75 ? "fast" : averageRatio <= 1.35 ? "steady" : "deliberate";

  return {
    actionMs,
    mathMs,
    totalMs,
    actionTargetRatio,
    mathTargetRatio,
    pace,
    withinTableClock: totalMs <= TABLE_CLOCK_MS,
  };
}

function resolveScenario(scenario: RatedTrainingScenario | string): RatedTrainingScenario {
  if (typeof scenario !== "string") return scenario;
  const resolved = trainingScenarioById.get(scenario);
  if (!resolved) {
    throw new Error(`Unknown training scenario: ${scenario}`);
  }
  return resolved;
}

export function gradeTrainingAttempt(
  input: GradeTrainingAttemptInput,
): GradedTrainingAttempt {
  const scenario = resolveScenario(input.scenario);
  const action = evaluateAction(scenario, input.action);
  const math = evaluateMathAnswer(scenario, input.mathAnswer);
  const timing = measureAttemptTiming(
    scenario,
    input.actionElapsedMs,
    input.mathElapsedMs,
  );
  const decisionEloDelta = calculateEloDelta(
    input.decisionElo,
    scenario.training.decisionDifficulty,
    action.score,
    input.decisionAttempts,
  );
  const mathEloDelta = calculateEloDelta(
    input.mathElo,
    scenario.training.mathDifficulty,
    math.score,
    input.mathAttempts,
  );
  const elapsedMs = timing.totalMs;

  const result: TrainingResult = {
    scenarioId: scenario.id,
    completedAt: input.completedAt ?? new Date().toISOString(),
    action: input.action,
    actionCorrect: action.correct,
    mathAnswer: math.answer,
    mathCorrect: math.correct,
    elapsedMs,
    eloDelta: decisionEloDelta + mathEloDelta,
  };

  return {
    result,
    action,
    math,
    timing,
    decisionEloDelta,
    mathEloDelta,
    decisionEloAfter: input.decisionElo + decisionEloDelta,
    mathEloAfter: input.mathElo + mathEloDelta,
  };
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return Math.round(
    sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight,
  );
}

function average(values: boolean[]): number {
  if (values.length === 0) return 0;
  return values.filter(Boolean).length / values.length;
}

export function summarizeTiming(samples: TimingSample[]): TimingSummary {
  const normalized = samples.map((sample) => ({
    actionMs: nonNegativeDuration(sample.actionMs, "sample.actionMs"),
    mathMs: nonNegativeDuration(sample.mathMs, "sample.mathMs"),
    actionCorrect: sample.actionCorrect,
    mathCorrect: sample.mathCorrect,
  }));
  const actionTimes = normalized.map((sample) => sample.actionMs).sort((a, b) => a - b);
  const mathTimes = normalized.map((sample) => sample.mathMs).sort((a, b) => a - b);
  const totalTimes = normalized
    .map((sample) => sample.actionMs + sample.mathMs)
    .sort((a, b) => a - b);
  const withinClock = normalized.filter(
    (sample) => sample.actionMs + sample.mathMs <= TABLE_CLOCK_MS,
  );

  return {
    attempts: normalized.length,
    medianActionMs: percentile(actionTimes, 0.5),
    medianMathMs: percentile(mathTimes, 0.5),
    medianTotalMs: percentile(totalTimes, 0.5),
    p80TotalMs: percentile(totalTimes, 0.8),
    withinTableClockRate:
      normalized.length === 0 ? 0 : withinClock.length / normalized.length,
    decisionAccuracyWithinClock: average(
      withinClock.map((sample) => sample.actionCorrect),
    ),
    mathAccuracyWithinClock: average(
      withinClock.map((sample) => sample.mathCorrect),
    ),
  };
}

function sharedTagCount(
  first: RatedTrainingScenario,
  second: RatedTrainingScenario,
): number {
  const tags = new Set(first.tags);
  return second.tags.filter((tag) => tags.has(tag)).length;
}

function cardSignature(cards: RatedTrainingScenario["heroCards"]): string {
  return cards.map((card) => `${card.rank}-${card.suit}`).sort().join(",");
}

function boardTextureSignature(scenario: RatedTrainingScenario): string {
  const suits = scenario.board.reduce<Record<string, number>>((counts, card) => {
    counts[card.suit] = (counts[card.suit] ?? 0) + 1;
    return counts;
  }, {});
  const ranks = scenario.board.reduce<Record<string, number>>((counts, card) => {
    counts[card.rank] = (counts[card.rank] ?? 0) + 1;
    return counts;
  }, {});
  return [
    scenario.street,
    Object.values(suits).sort((left, right) => right - left).join("-"),
    Object.values(ranks).sort((left, right) => right - left).join("-"),
  ].join(":");
}

function stackStructureSignature(scenario: RatedTrainingScenario): string {
  const hero = scenario.players.find((player) => player.id === "hero");
  const effectiveBigBlinds = hero ? hero.stack / scenario.blinds[1] : 0;
  const band =
    effectiveBigBlinds <= 12 ? "short" : effectiveBigBlinds <= 30 ? "medium" : "deep";
  const livePlayers = scenario.players.filter((player) => player.status !== "folded").length;
  return `${band}:${livePlayers}`;
}

function potOddsSignature(scenario: RatedTrainingScenario): string {
  if (scenario.amountToCall === 0) return "free";
  const requiredEquity = scenario.amountToCall / (scenario.pot + scenario.amountToCall);
  return `${Math.round(requiredEquity * 10) * 10}%`;
}

function wordingSimilarity(first: string, second: string): number {
  const words = (value: string) => new Set(value.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const firstWords = words(first);
  const secondWords = words(second);
  if (firstWords.size === 0 || secondWords.size === 0) return 0;
  let shared = 0;
  for (const word of firstWords) if (secondWords.has(word)) shared += 1;
  return shared / Math.min(firstWords.size, secondWords.size);
}

/** Reports the poker features selection treats as near-duplicates. */
export function trainingScenarioHistorySimilarity(
  candidate: RatedTrainingScenario,
  recent: RatedTrainingScenario,
): {
  sameHeroCards: boolean;
  sameBoardTexture: boolean;
  sameStackStructure: boolean;
  samePotOddsThreshold: boolean;
  sameAction: boolean;
  sameLesson: boolean;
  wordingOverlap: number;
} {
  return {
    sameHeroCards: cardSignature(candidate.heroCards) === cardSignature(recent.heroCards),
    sameBoardTexture: boardTextureSignature(candidate) === boardTextureSignature(recent),
    sameStackStructure: stackStructureSignature(candidate) === stackStructureSignature(recent),
    samePotOddsThreshold: potOddsSignature(candidate) === potOddsSignature(recent),
    sameAction: candidate.recommendedAction === recent.recommendedAction,
    sameLesson: candidate.mathQuestion.topic === recent.mathQuestion.topic,
    wordingOverlap: wordingSimilarity(candidate.prompt, recent.prompt),
  };
}

function recentHistoryPenalty(
  candidate: RatedTrainingScenario,
  recentScenarios: readonly RatedTrainingScenario[],
): number {
  return recentScenarios.reduce((penalty, recent) => {
    const similarity = trainingScenarioHistorySimilarity(candidate, recent);
    return penalty +
      (similarity.sameHeroCards ? 500 : 0) +
      (similarity.sameBoardTexture ? 28 : 0) +
      (similarity.sameStackStructure ? 12 : 0) +
      (similarity.samePotOddsThreshold ? 14 : 0) +
      (similarity.sameAction ? 32 : 0) +
      (similarity.sameLesson ? 28 : 0) +
      (similarity.wordingOverlap >= 0.45 ? 20 : 0);
  }, 0);
}

const BEGINNER_ELO_CEILING = 1_100;
const ADVANCED_ELO_FLOOR = 1_500;

function assertOptionalRating(rating: number | undefined, label: string): void {
  if (rating !== undefined) assertFinite(rating, label);
}

/**
 * Returns a separate selection adjustment for decision and maths skill.
 *
 * The guardrails keep an early player away from the extreme end of the bank
 * and keep an established player out of its introductory material. Within
 * those bounds, distance from each authored Elo calibrates the ranking. The
 * values are intentionally modest enough that the recent-history and
 * near-transfer rules still prevent a mechanical loop.
 */
function adaptiveDifficultyAdjustment(
  scenario: RatedTrainingScenario,
  decisionElo: number | undefined,
  mathElo: number | undefined,
): number {
  assertOptionalRating(decisionElo, "decisionElo");
  assertOptionalRating(mathElo, "mathElo");

  let score = 0;
  if (decisionElo !== undefined) {
    if (
      (decisionElo <= BEGINNER_ELO_CEILING &&
        scenario.training.decisionDifficulty > 1_340) ||
      (decisionElo >= ADVANCED_ELO_FLOOR &&
        scenario.training.decisionDifficulty < 1_210)
    ) {
      return -10_000;
    }
    score -= Math.abs(scenario.training.decisionDifficulty - decisionElo) / 16;
  }
  if (mathElo !== undefined) {
    if (
      (mathElo <= BEGINNER_ELO_CEILING && scenario.training.mathDifficulty > 1_230) ||
      (mathElo >= ADVANCED_ELO_FLOOR && scenario.training.mathDifficulty < 1_160)
    ) {
      return -10_000;
    }
    score -= Math.abs(scenario.training.mathDifficulty - mathElo) / 16;
  }
  return score;
}

/**
 * Chooses a deterministic but deliberately diverse next problem. Near-transfer
 * is a small tie-breaker, never a dominant score: a training session must not
 * collapse into a two-card cycle merely because two prompts share a topic.
 */
export function selectNearTransferScenario(
  currentScenario: RatedTrainingScenario | string,
  options: NearTransferOptions = {},
  pool: RatedTrainingScenario[] = trainingScenarios,
): RatedTrainingScenario | undefined {
  const current =
    typeof currentScenario === "string"
      ? pool.find((scenario) => scenario.id === currentScenario) ??
        trainingScenarioById.get(currentScenario)
      : currentScenario;
  if (!current) return undefined;

  const completed = new Set(options.completedScenarioIds ?? []);
  const recent = [...(options.recentScenarioIds ?? [])].slice(-6);
  const recentSet = new Set([...recent, current.id]);
  const recentScenarios = recent
    .map((id) => pool.find((scenario) => scenario.id === id))
    .filter((scenario): scenario is RatedTrainingScenario => scenario !== undefined);
  const preferDifferentStreet = options.preferDifferentStreet ?? true;
  const candidates = pool
    .filter((scenario) => scenario.id !== current.id)
    .map((scenario) => {
      let score = 0;
      // A fresh scenario always wins over a superficially similar repeat. This
      // makes one complete bank pass the first priority; history similarity
      // then determines the order within that pass.
      if (!completed.has(scenario.id)) score += 1_000;
      if (recentSet.has(scenario.id)) score -= 10_000;
      if (scenario.mathQuestion.topic !== current.mathQuestion.topic) score += 28;
      if (scenario.training.transferGroup !== current.training.transferGroup) score += 16;
      if (scenario.recommendedAction !== current.recommendedAction) score += 24;
      if (
        options.focusTopic &&
        scenario.mathQuestion.topic === options.focusTopic
      ) {
        score += 120;
      }
      score += sharedTagCount(current, scenario) * 2;
      score -= Math.abs(current.difficulty - scenario.difficulty) * 8;
      if (preferDifferentStreet && scenario.street !== current.street) score += 12;
      score += adaptiveDifficultyAdjustment(
        scenario,
        options.decisionElo,
        options.mathElo,
      );
      score -= recentHistoryPenalty(scenario, recentScenarios);
      return { scenario, score };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.scenario.id.localeCompare(right.scenario.id);
    });

  return candidates[0]?.scenario;
}

/** A reproducible initial prompt that cannot always be the first bank entry. */
export function selectTrainingSessionStartScenario(
  playerName: string,
  completedScenarioIds: Iterable<string> = [],
  pool: RatedTrainingScenario[] = trainingScenarios,
  options: TrainingStartOptions = {},
): RatedTrainingScenario | undefined {
  if (pool.length === 0) return undefined;
  const completed = new Set(completedScenarioIds);
  const candidates = pool.filter((scenario) => !completed.has(scenario.id));
  const source = candidates.length ? candidates : pool;
  let hash = 2166136261;
  for (const character of `${playerName}:${completed.size}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  assertOptionalRating(options.decisionElo, "decisionElo");
  assertOptionalRating(options.mathElo, "mathElo");
  const adaptiveSource = source
    .map((scenario) => ({
      scenario,
      score: adaptiveDifficultyAdjustment(
        scenario,
        options.decisionElo,
        options.mathElo,
      ),
    }))
    .filter(({ score }) => score > -10_000);
  const ranked = adaptiveSource.length ? adaptiveSource : source.map((scenario) => ({ scenario, score: 0 }));
  const highestScore = Math.max(...ranked.map(({ score }) => score));
  const suitable = ranked
    .filter(({ score }) => score >= highestScore - 10)
    .map(({ scenario }) => scenario);
  return suitable[(hash >>> 0) % suitable.length];
}

/**
 * Estimated hero equity for a Training scenario.
 *
 * Training scenarios author hero cards and a board but **no villain range**, so
 * there is no stated range to run against. Rather than invent one, this
 * measures equity against a uniformly random opponent hand from the remaining
 * deck and the caller labels it as exactly that. It is the honest baseline a
 * learner needs to compare against the required equity: "you needed 28% and
 * you had roughly 61% against a random hand" is a true and useful statement,
 * whereas a fabricated range would be neither.
 *
 * Deterministic: seeded from the scenario id, so the same scenario always
 * reports the same figure and the feedback panel never flickers.
 */
export function estimateTrainingEquity(
  scenario: RatedTrainingScenario,
  simulations = 400,
): { equity: number; simulations: number; assumption: "random-hand" } {
  const known = new Set(
    [...scenario.heroCards, ...scenario.board].map(
      (card) => `${card.rank}${card.suit}`,
    ),
  );
  const deck = createDeck().filter(
    (card) => !known.has(`${card.rank}${card.suit}`),
  );
  const runout = 5 - scenario.board.length;
  // Two villain cards plus the remaining board must fit in the stub.
  if (runout < 0 || deck.length < runout + 2 || scenario.heroCards.length !== 2) {
    return { equity: 0, simulations: 0, assumption: "random-hand" };
  }

  const random = createSeededRandom(`training-equity:${scenario.id}`);
  let score = 0;
  for (let trial = 0; trial < simulations; trial += 1) {
    const stub = deck.map((card) => ({ ...card }));
    const drawn = runout + 2;
    for (let index = 0; index < drawn; index += 1) {
      const target = index + Math.floor(random() * (stub.length - index));
      [stub[index], stub[target]] = [stub[target], stub[index]];
    }
    const board = [...scenario.board, ...stub.slice(0, runout)];
    const villain = stub.slice(runout, runout + 2);
    const heroValue = evaluateBestHand([...scenario.heroCards, ...board]);
    const villainValue = evaluateBestHand([...villain, ...board]);
    const comparison = compareHandValues(heroValue, villainValue);
    if (comparison > 0) score += 1;
    else if (comparison === 0) score += 0.5;
  }

  return {
    equity: score / simulations,
    simulations,
    assumption: "random-hand",
  };
}

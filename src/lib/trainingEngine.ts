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
  const preferDifferentStreet = options.preferDifferentStreet ?? true;
  const candidates = pool
    .filter((scenario) => scenario.id !== current.id)
    .map((scenario) => {
      let score = 0;
      if (!completed.has(scenario.id)) score += 42;
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
  return source[(hash >>> 0) % source.length];
}

import {
  TRAINING_SCENARIO_CONTENT_VERSION,
  TRAINING_SCENARIO_SCHEMA_VERSION,
  type RatedTrainingScenario,
} from "../data/trainingScenarioSchema";
import { trainingScenarios } from "../data/trainingScenarios";
import type { MathTopic, PokerAction, Street, TrainingResult } from "../types/poker";
import {
  gradeTrainingAttempt,
  selectNearTransferScenario,
} from "./trainingEngine";

// 1.1.1 adds the newly modeled call branch to the shove scenario; the baseline
// is intentionally re-reviewed below.
export const TRAINING_CALIBRATION_VERSION = "training-calibration-1.1.1";

export type CalibrationDifficultyBand =
  | "foundation"
  | "intermediate"
  | "advanced"
  | "expert";

export type CalibrationArchetypeId =
  | "reference"
  | "developing"
  | "nonresponse";

export interface CalibrationArchetype {
  id: CalibrationArchetypeId;
  assumption: string;
  initialDecisionElo: number;
  initialMathElo: number;
}

export const CALIBRATION_ARCHETYPES: readonly CalibrationArchetype[] =
  Object.freeze([
    {
      id: "reference",
      assumption:
        "Synthetic ceiling trace: chooses the highest modeled action EV and supplies the authored exact math answer.",
      initialDecisionElo: 1200,
      initialMathElo: 1200,
    },
    {
      id: "developing",
      assumption:
        "Synthetic mixed trace: alternates best and second-best modeled actions, and alternates exact and deterministic near-miss math answers.",
      initialDecisionElo: 1200,
      initialMathElo: 1200,
    },
    {
      id: "nonresponse",
      assumption:
        "Synthetic floor trace: folds when that action is modeled (otherwise chooses the alphabetically first modeled action) and omits every math answer.",
      initialDecisionElo: 1200,
      initialMathElo: 1200,
    },
  ]);

interface CalibrationResponse {
  action: PokerAction;
  mathAnswer?: number;
  actionElapsedMs: number;
  mathElapsedMs: number;
}

export interface CalibrationAttempt {
  scenarioId: string;
  street: Street;
  authoredDifficulty: number;
  decisionBand: CalibrationDifficultyBand;
  mathBand: CalibrationDifficultyBand;
  action: PokerAction;
  mathAnswer: number | null;
  actionScore: number;
  mathScore: number;
  decisionEloDelta: number;
  mathEloDelta: number;
  legacyResult: TrainingResult;
}

export interface CalibrationDimensionSummary {
  score: number;
  possible: number;
  rate: number;
}

export interface CalibrationArchetypeRun {
  id: CalibrationArchetypeId;
  assumption: string;
  initialDecisionElo: number;
  initialMathElo: number;
  finalDecisionElo: number;
  finalMathElo: number;
  action: CalibrationDimensionSummary;
  math: CalibrationDimensionSummary;
  attempts: CalibrationAttempt[];
}

export interface CalibrationScenarioContract {
  id: string;
  contentVersion: string;
  evaluatorVersion: string;
  authoredDifficulty: number;
  street: Street;
  tags: string[];
  transferGroup: string;
  decisionDifficulty: number;
  decisionBand: CalibrationDifficultyBand;
  mathDifficulty: number;
  mathBand: CalibrationDifficultyBand;
  actionEvs: Array<[PokerAction, number]>;
  actionEpsilon: number;
  partialCreditRegret: number;
  mathTopic: MathTopic;
  mathUnit: string;
  mathCorrectValue: number;
  mathTolerance: number;
}

export interface TrainingCalibrationBaseline {
  calibrationVersion: string;
  scenarioSchemaVersion: string;
  scenarioContentVersion: string;
  evidenceKind: "synthetic-regression-only";
  reviewStatus: "pending-human-review";
  scenarioContracts: CalibrationScenarioContract[];
  coverage: {
    streets: Array<{ value: Street; count: number }>;
    authoredDifficulties: Array<{ value: number; count: number }>;
    decisionBands: Array<{ value: CalibrationDifficultyBand; count: number }>;
    mathBands: Array<{ value: CalibrationDifficultyBand; count: number }>;
    tags: Array<{ value: string; count: number }>;
  };
  nearTransferPairs: Array<{ from: string; to: string | null }>;
  archetypes: CalibrationArchetypeRun[];
}

export interface CalibrationAudit {
  ok: boolean;
  code:
    | "pass"
    | "silent-drift"
    | "baseline-refresh-required";
  message: string;
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function difficultyBand(value: number): CalibrationDifficultyBand {
  if (value < 1100) return "foundation";
  if (value < 1300) return "intermediate";
  if (value < 1500) return "advanced";
  return "expert";
}

function sortedActions(
  scenario: RatedTrainingScenario,
): Array<[PokerAction, number]> {
  return Object.entries(scenario.training.actionEvs)
    .filter((entry): entry is [PokerAction, number] =>
      Number.isFinite(entry[1]),
    )
    .sort(([actionA, evA], [actionB, evB]) => {
      if (evA !== evB) return evB - evA;
      return actionA.localeCompare(actionB);
    });
}

function nearMissAnswer(scenario: RatedTrainingScenario): number {
  const { correctValue, tolerance, unit } = scenario.mathQuestion;
  if (tolerance > 0) return correctValue + tolerance * 1.5;
  return unit === "outs" ? correctValue + 1 : correctValue;
}

function responseFor(
  archetype: CalibrationArchetypeId,
  scenario: RatedTrainingScenario,
  scenarioIndex: number,
): CalibrationResponse {
  const rankedActions = sortedActions(scenario);
  if (rankedActions.length === 0) {
    throw new Error(`Calibration scenario ${scenario.id} has no rated action.`);
  }
  const bestAction = rankedActions[0][0];
  const secondAction = rankedActions[1]?.[0] ?? bestAction;

  if (archetype === "reference") {
    return {
      action: bestAction,
      mathAnswer: scenario.mathQuestion.correctValue,
      actionElapsedMs: Math.round(scenario.training.targetDecisionMs * 0.8),
      mathElapsedMs: Math.round(scenario.training.targetMathMs * 0.8),
    };
  }
  if (archetype === "developing") {
    const exact = scenarioIndex % 2 === 0;
    return {
      action: exact ? bestAction : secondAction,
      mathAnswer: exact
        ? scenario.mathQuestion.correctValue
        : nearMissAnswer(scenario),
      actionElapsedMs: scenario.training.targetDecisionMs,
      mathElapsedMs: scenario.training.targetMathMs,
    };
  }

  const alphabeticActions = rankedActions
    .map(([action]) => action)
    .sort((left, right) => left.localeCompare(right));
  return {
    action: alphabeticActions.includes("fold")
      ? "fold"
      : alphabeticActions[0],
    actionElapsedMs: Math.round(scenario.training.targetDecisionMs * 1.8),
    mathElapsedMs: Math.round(scenario.training.targetMathMs * 1.8),
  };
}

function summarize(scores: readonly number[]): CalibrationDimensionSummary {
  const score = round(scores.reduce((total, value) => total + value, 0));
  return {
    score,
    possible: scores.length,
    rate: scores.length === 0 ? 0 : round(score / scores.length),
  };
}

function runArchetype(
  archetype: CalibrationArchetype,
  scenarios: readonly RatedTrainingScenario[],
): CalibrationArchetypeRun {
  let decisionElo = archetype.initialDecisionElo;
  let mathElo = archetype.initialMathElo;
  const attempts = scenarios.map((scenario, index): CalibrationAttempt => {
    const response = responseFor(archetype.id, scenario, index);
    const graded = gradeTrainingAttempt({
      scenario,
      action: response.action,
      mathAnswer: response.mathAnswer,
      decisionElo,
      mathElo,
      actionElapsedMs: response.actionElapsedMs,
      mathElapsedMs: response.mathElapsedMs,
      completedAt: `2000-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      // Frozen at the established-player K factor so adding scenarios does not
      // silently toggle a provisional-rating boundary.
      decisionAttempts: 30 + index,
      mathAttempts: 30 + index,
    });
    decisionElo = graded.decisionEloAfter;
    mathElo = graded.mathEloAfter;

    return {
      scenarioId: scenario.id,
      street: scenario.street,
      authoredDifficulty: scenario.difficulty,
      decisionBand: difficultyBand(scenario.training.decisionDifficulty),
      mathBand: difficultyBand(scenario.training.mathDifficulty),
      action: response.action,
      mathAnswer: response.mathAnswer ?? null,
      actionScore: graded.action.score,
      mathScore: graded.math.score,
      decisionEloDelta: graded.decisionEloDelta,
      mathEloDelta: graded.mathEloDelta,
      legacyResult: graded.result,
    };
  });

  return {
    id: archetype.id,
    assumption: archetype.assumption,
    initialDecisionElo: archetype.initialDecisionElo,
    initialMathElo: archetype.initialMathElo,
    finalDecisionElo: decisionElo,
    finalMathElo: mathElo,
    action: summarize(attempts.map((attempt) => attempt.actionScore)),
    math: summarize(attempts.map((attempt) => attempt.mathScore)),
    attempts,
  };
}

function countValues<T extends string | number>(
  values: readonly T[],
): Array<{ value: T; count: number }> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([value, count]) => ({ value, count }));
}

export function buildTrainingCalibration(
  scenarios: readonly RatedTrainingScenario[] = trainingScenarios,
): TrainingCalibrationBaseline {
  const sortedScenarios = [...scenarios].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const scenarioContracts = sortedScenarios.map(
    (scenario): CalibrationScenarioContract => ({
      id: scenario.id,
      contentVersion: scenario.contentVersion,
      evaluatorVersion: scenario.training.evaluatorVersion,
      authoredDifficulty: scenario.difficulty,
      street: scenario.street,
      tags: [...scenario.tags].sort(),
      transferGroup: scenario.training.transferGroup,
      decisionDifficulty: scenario.training.decisionDifficulty,
      decisionBand: difficultyBand(scenario.training.decisionDifficulty),
      mathDifficulty: scenario.training.mathDifficulty,
      mathBand: difficultyBand(scenario.training.mathDifficulty),
      actionEvs: sortedActions(scenario)
        .map(([action, ev]) => [action, ev] as [PokerAction, number])
        .sort(([left], [right]) => left.localeCompare(right)),
      actionEpsilon: scenario.training.actionEpsilon,
      partialCreditRegret: scenario.training.partialCreditRegret,
      mathTopic: scenario.mathQuestion.topic,
      mathUnit: scenario.mathQuestion.unit,
      mathCorrectValue: scenario.mathQuestion.correctValue,
      mathTolerance: scenario.mathQuestion.tolerance,
    }),
  );

  return {
    calibrationVersion: TRAINING_CALIBRATION_VERSION,
    scenarioSchemaVersion: TRAINING_SCENARIO_SCHEMA_VERSION,
    scenarioContentVersion: TRAINING_SCENARIO_CONTENT_VERSION,
    evidenceKind: "synthetic-regression-only",
    reviewStatus: "pending-human-review",
    scenarioContracts,
    coverage: {
      streets: countValues(sortedScenarios.map((scenario) => scenario.street)),
      authoredDifficulties: countValues(
        sortedScenarios.map((scenario) => scenario.difficulty),
      ),
      decisionBands: countValues(
        scenarioContracts.map((contract) => contract.decisionBand),
      ),
      mathBands: countValues(
        scenarioContracts.map((contract) => contract.mathBand),
      ),
      tags: countValues(sortedScenarios.flatMap((scenario) => scenario.tags)),
    },
    nearTransferPairs: sortedScenarios.map((scenario) => ({
      from: scenario.id,
      to: selectNearTransferScenario(scenario, {}, [...sortedScenarios])?.id ?? null,
    })),
    archetypes: CALIBRATION_ARCHETYPES.map((archetype) =>
      runArchetype(archetype, sortedScenarios),
    ),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => canonical(item === undefined ? null : item))
      .join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function auditTrainingCalibration(
  baseline: TrainingCalibrationBaseline,
  current: TrainingCalibrationBaseline = buildTrainingCalibration(),
): CalibrationAudit {
  if (baseline.calibrationVersion !== current.calibrationVersion) {
    return {
      ok: false,
      code: "baseline-refresh-required",
      message:
        `Calibration version changed from ${baseline.calibrationVersion} to ` +
        `${current.calibrationVersion}; regenerate and review the frozen baseline.`,
    };
  }
  if (canonical(baseline) !== canonical(current)) {
    return {
      ok: false,
      code: "silent-drift",
      message:
        `Training calibration output changed without changing ` +
        `${current.calibrationVersion}. Bump the calibration version, regenerate, and review.`,
    };
  }
  return {
    ok: true,
    code: "pass",
    message: `Synthetic Training calibration ${current.calibrationVersion} matches its frozen baseline.`,
  };
}

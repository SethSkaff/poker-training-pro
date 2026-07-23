import {
  TRAINING_SCENARIO_CONTENT_VERSION,
  TRAINING_SCENARIO_SCHEMA_VERSION,
  type RatedTrainingScenario,
  validateTrainingScenario,
} from "../../src/data/trainingScenarioSchema";
import { trainingScenarios } from "../../src/data/trainingScenarios";
import type { PokerAction, Street } from "../../src/types/poker";
import {
  TRAINING_CALIBRATION_VERSION,
  buildTrainingCalibration,
} from "../../src/lib/trainingCalibration";
import { gradeTrainingAttempt } from "../../src/lib/trainingEngine";

export const TRAINING_TOOL_VERSION = "training-tool-1.0.0";
export const DEVELOPER_ANSWER_KEY_MARKER = "PTP_DEV_TRAINING_ANSWER_KEY_V1";

export interface TrainingDraftDocument {
  toolVersion: typeof TRAINING_TOOL_VERSION;
  seed: string;
  sourceScenarioId: string;
  canonicalReplacementAllowed: false;
  scenario: RatedTrainingScenario;
}

export interface TrainingDraftValidation {
  valid: boolean;
  errors: string[];
}

export interface BulkSimulationAttempt {
  index: number;
  scenarioId: string;
  street: Street;
  action: PokerAction;
  actionScore: number;
  mathAnswer: number | null;
  mathScore: number;
  decisionEloDelta: number;
  mathEloDelta: number;
}

export interface BulkSimulationReport {
  toolVersion: typeof TRAINING_TOOL_VERSION;
  calibrationVersion: string;
  schemaVersion: string;
  contentVersion: string;
  evidenceKind: "synthetic-developer-simulation";
  seed: string;
  trials: number;
  initialDecisionElo: number;
  initialMathElo: number;
  finalDecisionElo: number;
  finalMathElo: number;
  actionScoreRate: number;
  mathScoreRate: number;
  scenarioCounts: Array<{ scenarioId: string; count: number }>;
  attempts: BulkSimulationAttempt[];
}

function assertSeed(seed: string): void {
  if (!seed.trim()) throw new Error("A non-empty deterministic seed is required.");
}

function seedToUint32(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = seedToUint32(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneScenario(scenario: RatedTrainingScenario): RatedTrainingScenario {
  return structuredClone(scenario);
}

export function createTrainingDraft(
  seed: string,
  scenarioId?: string,
  scenarios: readonly RatedTrainingScenario[] = trainingScenarios,
): TrainingDraftDocument {
  assertSeed(seed);
  if (scenarios.length === 0) throw new Error("No canonical scenarios are available.");
  const sorted = [...scenarios].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const source = scenarioId
    ? sorted.find((scenario) => scenario.id === scenarioId)
    : sorted[Math.floor(seededRandom(seed)() * sorted.length)];
  if (!source) throw new Error(`Unknown canonical scenario: ${scenarioId}`);

  return {
    toolVersion: TRAINING_TOOL_VERSION,
    seed,
    sourceScenarioId: source.id,
    canonicalReplacementAllowed: false,
    scenario: cloneScenario(source),
  };
}

export function validateTrainingDraft(
  input: unknown,
): TrainingDraftValidation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Draft must be an object."] };
  }
  const draft = input as Partial<TrainingDraftDocument>;
  const envelopeErrors: string[] = [];
  if (draft.toolVersion !== TRAINING_TOOL_VERSION) {
    envelopeErrors.push(`toolVersion: expected ${TRAINING_TOOL_VERSION}.`);
  }
  if (typeof draft.seed !== "string" || !draft.seed.trim()) {
    envelopeErrors.push("seed: a non-empty deterministic seed is required.");
  }
  if (
    typeof draft.sourceScenarioId !== "string" ||
    !draft.sourceScenarioId.trim()
  ) {
    envelopeErrors.push("sourceScenarioId: a source scenario id is required.");
  }
  if (draft.canonicalReplacementAllowed !== false) {
    envelopeErrors.push(
      "canonicalReplacementAllowed: developer drafts must remain false.",
    );
  }
  const scenarioErrors = validateTrainingScenario(draft.scenario);
  const errors = [...envelopeErrors, ...scenarioErrors].sort();
  return { valid: errors.length === 0, errors };
}

function cardText(card: { rank: string; suit: string }): string {
  return `${card.rank}-${card.suit}`;
}

export function renderTrainingScenarioPreview(
  scenario: RatedTrainingScenario,
): string {
  const validation = validateTrainingScenario(scenario);
  if (validation.length > 0) {
    throw new Error(
      `Cannot preview invalid scenario ${scenario.id}: ${validation.join(" | ")}`,
    );
  }
  const players = [...scenario.players]
    .sort((left, right) => left.seat - right.seat)
    .map(
      (player) =>
        `  Seat ${player.seat}: ${player.name} | ${player.stack} behind | ` +
        `${player.bet} bet | ${player.status}`,
    );
  const actionEvs = Object.entries(scenario.training.actionEvs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([action, ev]) => `${action}=${ev}bb`)
    .join(", ");

  return [
    `TRAINING SCENARIO PREVIEW — ${scenario.id}`,
    `${scenario.title} | difficulty ${scenario.difficulty}/5 | ${scenario.street}`,
    `Blinds ${scenario.blinds[0]}/${scenario.blinds[1]} | pot ${scenario.pot} | call ${scenario.amountToCall}`,
    `Hero: ${scenario.heroCards.map(cardText).join(" ")} | Board: ${
      scenario.board.length ? scenario.board.map(cardText).join(" ") : "(none)"
    }`,
    "Players:",
    ...players,
    "",
    `Decision: ${scenario.prompt}`,
    `Math (${scenario.mathQuestion.topic}): ${scenario.mathQuestion.prompt}`,
    "",
    `--- ${DEVELOPER_ANSWER_KEY_MARKER} ---`,
    `Recommended action: ${scenario.recommendedAction}`,
    `Modeled action EVs: ${actionEvs}`,
    `Decision explanation: ${scenario.actionReason}`,
    `Math answer: ${scenario.mathQuestion.correctValue} ${scenario.mathQuestion.unit} ± ${scenario.mathQuestion.tolerance}`,
    `Math explanation: ${scenario.mathQuestion.explanation}`,
    `Versions: ${scenario.schemaVersion} / ${scenario.contentVersion} / ${scenario.training.evaluatorVersion}`,
  ].join("\n");
}

function rankedActions(
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

function nearMissMath(scenario: RatedTrainingScenario): number {
  const { correctValue, tolerance, unit } = scenario.mathQuestion;
  if (tolerance > 0) return correctValue + tolerance * 1.5;
  return unit === "outs" ? correctValue + 1 : correctValue;
}

export function runTrainingBulkSimulation(options: {
  seed: string;
  trials: number;
  initialDecisionElo?: number;
  initialMathElo?: number;
  scenarios?: readonly RatedTrainingScenario[];
}): BulkSimulationReport {
  assertSeed(options.seed);
  if (
    !Number.isSafeInteger(options.trials) ||
    options.trials < 1 ||
    options.trials > 100_000
  ) {
    throw new Error("trials must be a whole number from 1 through 100000.");
  }
  const scenarios = [...(options.scenarios ?? trainingScenarios)].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  if (scenarios.length === 0) throw new Error("No scenarios are available.");
  const validationErrors = scenarios.flatMap((scenario) =>
    validateTrainingScenario(scenario).map(
      (error) => `${scenario.id}: ${error}`,
    ),
  );
  if (validationErrors.length > 0) {
    throw new Error(`Bulk simulation rejected invalid bank: ${validationErrors[0]}`);
  }

  // Building the calibration contract makes simulation fail alongside any
  // unsupported scenario/calibration input instead of silently drifting.
  const calibration = buildTrainingCalibration(scenarios);
  const random = seededRandom(options.seed);
  let decisionElo = options.initialDecisionElo ?? 1200;
  let mathElo = options.initialMathElo ?? 1200;
  if (!Number.isFinite(decisionElo) || !Number.isFinite(mathElo)) {
    throw new Error("Initial Elo values must be finite.");
  }
  const counts = new Map(scenarios.map((scenario) => [scenario.id, 0]));
  const attempts: BulkSimulationAttempt[] = [];

  for (let index = 0; index < options.trials; index += 1) {
    const scenario = scenarios[Math.floor(random() * scenarios.length)];
    const actions = rankedActions(scenario);
    const actionRoll = random();
    const action =
      actionRoll < 0.65
        ? actions[0][0]
        : actionRoll < 0.85
          ? (actions[1]?.[0] ?? actions[0][0])
          : actions[actions.length - 1][0];
    const mathRoll = random();
    const mathAnswer =
      mathRoll < 0.65
        ? scenario.mathQuestion.correctValue
        : mathRoll < 0.85
          ? nearMissMath(scenario)
          : undefined;
    const graded = gradeTrainingAttempt({
      scenario,
      action,
      mathAnswer,
      decisionElo,
      mathElo,
      actionElapsedMs: scenario.training.targetDecisionMs,
      mathElapsedMs: scenario.training.targetMathMs,
      completedAt: `2001-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
      decisionAttempts: 30 + index,
      mathAttempts: 30 + index,
    });
    decisionElo = graded.decisionEloAfter;
    mathElo = graded.mathEloAfter;
    counts.set(scenario.id, (counts.get(scenario.id) ?? 0) + 1);
    attempts.push({
      index,
      scenarioId: scenario.id,
      street: scenario.street,
      action,
      actionScore: graded.action.score,
      mathAnswer: mathAnswer ?? null,
      mathScore: graded.math.score,
      decisionEloDelta: graded.decisionEloDelta,
      mathEloDelta: graded.mathEloDelta,
    });
  }

  const actionScore = attempts.reduce(
    (total, attempt) => total + attempt.actionScore,
    0,
  );
  const mathScore = attempts.reduce(
    (total, attempt) => total + attempt.mathScore,
    0,
  );
  return {
    toolVersion: TRAINING_TOOL_VERSION,
    calibrationVersion: calibration.calibrationVersion,
    schemaVersion: TRAINING_SCENARIO_SCHEMA_VERSION,
    contentVersion: TRAINING_SCENARIO_CONTENT_VERSION,
    evidenceKind: "synthetic-developer-simulation",
    seed: options.seed,
    trials: options.trials,
    initialDecisionElo: options.initialDecisionElo ?? 1200,
    initialMathElo: options.initialMathElo ?? 1200,
    finalDecisionElo: decisionElo,
    finalMathElo: mathElo,
    actionScoreRate: Number((actionScore / options.trials).toFixed(6)),
    mathScoreRate: Number((mathScore / options.trials).toFixed(6)),
    scenarioCounts: [...counts]
      .map(([scenarioId, count]) => ({ scenarioId, count }))
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
    attempts,
  };
}


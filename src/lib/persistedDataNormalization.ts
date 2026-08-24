import type {
  CareerEventResult,
  CareerTrack,
  GameSettings,
  PlayerProgress,
  PokerAction,
  TrainingResult,
} from "../types/poker";

/**
 * The one authoritative contract for settings and progress persisted by the
 * renderer. This module deliberately has no runtime imports, DOM access, or
 * locale dependencies. That makes it safe to transpile byte-for-byte into the
 * dependency-free CommonJS validator used by Electron's isolated main process.
 *
 * After changing this file, run `npm run generate:persistence-contract`.
 */

export const ACTION_MAP_VERSION = 1;

export const PERSISTED_ACTION_IDS = [
  "menu.up",
  "menu.down",
  "menu.left",
  "menu.right",
  "menu.activate",
  "menu.back",
  "game.fold",
  "game.checkCall",
  "game.raiseCustom",
  "game.raiseDouble",
  "game.raiseTwoFive",
  "game.raiseTriple",
  "game.pot",
  "game.allIn",
  "game.peek",
  "game.history",
  "game.pause",
  "camera.left",
  "camera.right",
  "camera.center",
  "speed.down",
  "speed.up",
] as const;

type PersistedActionId = (typeof PERSISTED_ACTION_IDS)[number];

export interface PersistedControlBindingOverrides {
  version: number;
  keyboard: Partial<Record<PersistedActionId, string[]>>;
  gamepad: Partial<Record<PersistedActionId, string[]>>;
}

export const defaultSettings: GameSettings = {
  masterVolume: 100,
  muted: false,
  musicVolume: 35,
  effectsVolume: 70,
  // Mode selection is a user gesture, so fullscreen can be requested there.
  // Browsers may still reject it; the app continues in a normal window.
  fullscreen: true,
  reducedMotion: false,
  reducedMotionExplicit: false,
  dealSpeed: "standard",
  colorAssist: false,
  cameraSensitivity: "standard",
  cameraView: "standard",
  autoCameraMovement: true,
  menuMotion: "full",
  roomMotion: "full",
  cameraMotion: "full",
  tableMotion: "full",
  transitionMotion: "full",
  interfaceScale: "standard",
  spatialScene: false,
};

export const defaultProgress: PlayerProgress = {
  onboardingCompleted: false,
  playChipsAcknowledged: false,
  playerName: "Player",
  decisionElo: 1000,
  mathElo: 1000,
  tournamentElo: 1000,
  trainingCompleted: 0,
  currentStreak: 0,
  bestStreak: 0,
  totalDecisionMs: 0,
  results: [],
  unlockedCircuit: 1,
  career: { normal: { results: [] }, rational: { results: [] } },
  reviewTotals: {
    roundsReviewed: 0,
    decisions: 0,
    bestDecisions: 0,
    totalRegretBigBlinds: 0,
  },
};

const actions = new Set<PokerAction>([
  "fold",
  "check",
  "call",
  "raise",
  "all-in",
]);
const dealSpeeds = new Set(["cinematic", "standard", "quick"]);
const cameraSensitivities = new Set(["low", "standard", "high"]);
const cameraViews = new Set(["close", "standard", "wide"]);
const motionIntensities = new Set(["full", "reduced", "off"]);
const interfaceScales = new Set([
  "compact",
  "standard",
  "large",
  "extra-large",
]);
const MAX_BINDING_TOKENS_PER_ACTION = 8;
const MAX_BINDING_TOKEN_LENGTH = 64;

export type PersistedValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/**
 * Validate untrusted persisted control overrides. Unknown action ids are
 * intentionally discarded for forward/backward compatibility. Known entries
 * are bounded so a hostile localStorage value cannot become an unbounded input
 * routing or display structure.
 */
export function normalizeControlBindingOverrides(
  value: unknown,
): PersistedControlBindingOverrides | undefined {
  if (!isRecord(value)) return undefined;
  const keyboard = normalizeDeviceOverrides(value.keyboard);
  const gamepad = normalizeDeviceOverrides(value.gamepad);
  if (
    Object.keys(keyboard).length === 0 &&
    Object.keys(gamepad).length === 0
  ) {
    return undefined;
  }
  return { version: ACTION_MAP_VERSION, keyboard, gamepad };
}

export function normalizePersistedSettings(value: unknown): GameSettings {
  const source = isRecord(value) ? value : {};
  const controlBindings = normalizeControlBindingOverrides(
    source.controlBindings,
  );
  return {
    masterVolume: boundedNumber(
      source.masterVolume,
      0,
      100,
      defaultSettings.masterVolume,
    ),
    muted: booleanOr(source.muted, defaultSettings.muted),
    musicVolume: boundedNumber(
      source.musicVolume,
      0,
      100,
      defaultSettings.musicVolume,
    ),
    effectsVolume: boundedNumber(
      source.effectsVolume,
      0,
      100,
      defaultSettings.effectsVolume,
    ),
    fullscreen: booleanOr(source.fullscreen, defaultSettings.fullscreen),
    reducedMotion: booleanOr(
      source.reducedMotion,
      defaultSettings.reducedMotion,
    ),
    reducedMotionExplicit: booleanOr(
      source.reducedMotionExplicit,
      defaultSettings.reducedMotionExplicit,
    ),
    dealSpeed: dealSpeeds.has(source.dealSpeed as string)
      ? (source.dealSpeed as GameSettings["dealSpeed"])
      : defaultSettings.dealSpeed,
    colorAssist: booleanOr(source.colorAssist, defaultSettings.colorAssist),
    cameraSensitivity: cameraSensitivities.has(
      source.cameraSensitivity as string,
    )
      ? (source.cameraSensitivity as GameSettings["cameraSensitivity"])
      : defaultSettings.cameraSensitivity,
    cameraView: cameraViews.has(source.cameraView as string)
      ? (source.cameraView as GameSettings["cameraView"])
      : defaultSettings.cameraView,
    autoCameraMovement: booleanOr(
      source.autoCameraMovement,
      defaultSettings.autoCameraMovement,
    ),
    menuMotion: motionIntensityOr(
      source.menuMotion,
      defaultSettings.menuMotion,
    ),
    roomMotion: motionIntensityOr(
      source.roomMotion,
      defaultSettings.roomMotion,
    ),
    cameraMotion: motionIntensityOr(
      source.cameraMotion,
      defaultSettings.cameraMotion,
    ),
    tableMotion: motionIntensityOr(
      source.tableMotion,
      defaultSettings.tableMotion,
    ),
    transitionMotion: motionIntensityOr(
      source.transitionMotion,
      defaultSettings.transitionMotion,
    ),
    interfaceScale: interfaceScales.has(source.interfaceScale as string)
      ? (source.interfaceScale as GameSettings["interfaceScale"])
      : defaultSettings.interfaceScale,
    spatialScene: booleanOr(
      source.spatialScene,
      defaultSettings.spatialScene ?? false,
    ),
    ...(controlBindings ? { controlBindings } : {}),
  };
}

export function normalizePersistedProgress(value: unknown): PlayerProgress {
  const source = isRecord(value) ? value : {};
  const results: TrainingResult[] = [];
  if (Array.isArray(source.results)) {
    // Iterate from newest to oldest so corrupt or hostile histories never make
    // us retain fewer than the latest 250 valid records.
    for (let index = source.results.length - 1; index >= 0; index -= 1) {
      const result = normalizeTrainingResult(source.results[index]);
      if (result) results.unshift(result);
      if (results.length === 250) break;
    }
  }

  const currentStreak = nonNegativeInteger(
    source.currentStreak,
    defaultProgress.currentStreak,
  );
  const bestStreak = Math.max(
    currentStreak,
    nonNegativeInteger(source.bestStreak, defaultProgress.bestStreak),
  );

  return {
    onboardingCompleted: booleanOr(
      source.onboardingCompleted,
      defaultProgress.onboardingCompleted,
    ),
    playChipsAcknowledged: booleanOr(
      source.playChipsAcknowledged,
      defaultProgress.playChipsAcknowledged,
    ),
    playerName:
      typeof source.playerName === "string" &&
      source.playerName.trim().length > 0
        ? source.playerName.slice(0, 48)
        : defaultProgress.playerName,
    decisionElo: finiteNumber(
      source.decisionElo,
      defaultProgress.decisionElo,
    ),
    mathElo: finiteNumber(source.mathElo, defaultProgress.mathElo),
    tournamentElo: finiteNumber(
      source.tournamentElo,
      defaultProgress.tournamentElo,
    ),
    trainingCompleted: nonNegativeInteger(
      source.trainingCompleted,
      defaultProgress.trainingCompleted,
    ),
    currentStreak,
    bestStreak,
    totalDecisionMs: Math.max(
      0,
      finiteNumber(source.totalDecisionMs, defaultProgress.totalDecisionMs),
    ),
    results,
    unlockedCircuit: Math.max(
      1,
      nonNegativeInteger(
        source.unlockedCircuit,
        defaultProgress.unlockedCircuit,
      ),
    ),
    career: normalizeCareer(source.career),
    reviewTotals: normalizeReviewTotals(source.reviewTotals),
  };
}

/**
 * Electron accepts older v1 saves with newly-added optional fields missing,
 * but rejects explicitly corrupt current-version leaves. The successful value
 * still comes from the canonical normalizer above.
 */
export function validateCurrentPersistedSettings(
  value: unknown,
): PersistedValidationResult<GameSettings> {
  if (!isRecord(value)) return invalid("The settings value is invalid.");
  for (const key of [
    "masterVolume",
    "musicVolume",
    "effectsVolume",
  ] as const) {
    if (!finiteBetween(value[key], 0, 100)) {
      return invalid(`The ${key} setting is invalid.`);
    }
  }
  for (const key of [
    "muted",
    "fullscreen",
    "reducedMotion",
    "colorAssist",
  ] as const) {
    if (typeof value[key] !== "boolean") {
      return invalid(`The ${key} setting is invalid.`);
    }
  }
  if (!dealSpeeds.has(value.dealSpeed as string)) {
    return invalid("The dealSpeed setting is invalid.");
  }
  if (
    !optionalMember(value.cameraSensitivity, cameraSensitivities) ||
    !optionalMember(value.cameraView, cameraViews) ||
    !optionalBoolean(value.autoCameraMovement) ||
    !optionalBoolean(value.reducedMotionExplicit) ||
    !optionalMember(value.menuMotion, motionIntensities) ||
    !optionalMember(value.roomMotion, motionIntensities) ||
    !optionalMember(value.cameraMotion, motionIntensities) ||
    !optionalMember(value.tableMotion, motionIntensities) ||
    !optionalMember(value.transitionMotion, motionIntensities) ||
    !optionalMember(value.interfaceScale, interfaceScales) ||
    !optionalBoolean(value.spatialScene) ||
    !validateControlBindingOverrides(value.controlBindings)
  ) {
    return invalid("An optional settings value is invalid.");
  }
  return { ok: true, value: normalizePersistedSettings(value) };
}

export function validateCurrentPersistedProgress(
  value: unknown,
): PersistedValidationResult<PlayerProgress> {
  if (!isRecord(value)) return invalid("The progress value is invalid.");
  if (
    typeof value.onboardingCompleted !== "boolean" ||
    typeof value.playChipsAcknowledged !== "boolean" ||
    typeof value.playerName !== "string" ||
    value.playerName.trim().length === 0 ||
    value.playerName.length > 48
  ) {
    return invalid("The player profile is invalid.");
  }
  for (const key of ["decisionElo", "mathElo", "tournamentElo"] as const) {
    if (!Number.isFinite(value[key])) {
      return invalid(`The ${key} value is invalid.`);
    }
  }
  for (const key of [
    "trainingCompleted",
    "currentStreak",
    "bestStreak",
    "unlockedCircuit",
  ] as const) {
    if (!Number.isInteger(value[key]) || (value[key] as number) < 0) {
      return invalid(`The ${key} value is invalid.`);
    }
  }
  if (
    !Number.isFinite(value.totalDecisionMs) ||
    (value.totalDecisionMs as number) < 0 ||
    !Array.isArray(value.results) ||
    value.results.length > 250 ||
    value.results.some((result) => !isValidTrainingResult(result)) ||
    !isValidCurrentCareer(value.career)
  ) {
    return invalid("The progress history is invalid.");
  }
  return { ok: true, value: normalizePersistedProgress(value) };
}

function normalizeDeviceOverrides(
  value: unknown,
): Partial<Record<PersistedActionId, string[]>> {
  const result: Partial<Record<PersistedActionId, string[]>> = {};
  if (!isRecord(value)) return result;
  for (const id of PERSISTED_ACTION_IDS) {
    const tokens = value[id];
    if (!Array.isArray(tokens)) continue;
    const cleaned = tokens
      .filter(isValidBindingToken)
      .slice(0, MAX_BINDING_TOKENS_PER_ACTION)
      .map((token) => token.toLowerCase())
      .filter((token, index, array) => array.indexOf(token) === index);
    if (cleaned.length > 0) result[id] = cleaned;
  }
  return result;
}

function validateControlBindingOverrides(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value.version !== undefined && value.version !== ACTION_MAP_VERSION) {
    return false;
  }
  for (const device of ["keyboard", "gamepad"] as const) {
    const overrides = value[device];
    if (overrides === undefined) continue;
    if (!isRecord(overrides)) return false;
    for (const id of PERSISTED_ACTION_IDS) {
      if (!Object.prototype.hasOwnProperty.call(overrides, id)) continue;
      const tokens = overrides[id];
      if (
        !Array.isArray(tokens) ||
        tokens.length > MAX_BINDING_TOKENS_PER_ACTION ||
        !tokens.every(isValidBindingToken)
      ) {
        return false;
      }
    }
  }
  return true;
}

function isValidBindingToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_BINDING_TOKEN_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function normalizeReviewTotals(
  value: unknown,
): NonNullable<PlayerProgress["reviewTotals"]> {
  const source = isRecord(value) ? value : {};
  const decisions = nonNegativeInteger(source.decisions, 0);
  return {
    roundsReviewed: nonNegativeInteger(source.roundsReviewed, 0),
    decisions,
    bestDecisions: Math.min(
      decisions,
      nonNegativeInteger(source.bestDecisions, 0),
    ),
    totalRegretBigBlinds: Math.max(
      0,
      finiteNumber(source.totalRegretBigBlinds, 0),
    ),
  };
}

function normalizeCareerResult(value: unknown): CareerEventResult | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.eventId !== "string" || value.eventId.length === 0) {
    return undefined;
  }
  return {
    eventId: value.eventId.slice(0, 64),
    finishPlace: Math.max(1, nonNegativeInteger(value.finishPlace, 1)),
    fieldSize: Math.max(1, nonNegativeInteger(value.fieldSize, 6)),
    sourceFieldSize: Math.max(
      1,
      nonNegativeInteger(value.sourceFieldSize, 6),
    ),
    qualifyingPlaces: Math.max(
      0,
      nonNegativeInteger(value.qualifyingPlaces, 0),
    ),
    qualified: booleanOr(value.qualified, false),
    tournamentEloDelta: finiteNumber(value.tournamentEloDelta, 0),
  };
}

function normalizeCareerTrack(value: unknown): CareerTrack {
  const source = isRecord(value) ? value : {};
  const results: CareerEventResult[] = [];
  if (Array.isArray(source.results)) {
    for (const entry of source.results) {
      const result = normalizeCareerResult(entry);
      if (!result) continue;
      const existing = results.findIndex(
        (candidate) => candidate.eventId === result.eventId,
      );
      if (existing >= 0) results[existing] = result;
      else results.push(result);
    }
  }
  const boundedResults = results.slice(-64);
  const activeEventId =
    typeof source.activeEventId === "string" && source.activeEventId.length > 0
      ? source.activeEventId.slice(0, 64)
      : undefined;
  return activeEventId
    ? { results: boundedResults, activeEventId }
    : { results: boundedResults };
}

function normalizeCareer(
  value: unknown,
): NonNullable<PlayerProgress["career"]> {
  const source = isRecord(value) ? value : {};
  return {
    normal: normalizeCareerTrack(source.normal),
    rational: normalizeCareerTrack(source.rational),
  };
}

function normalizeTrainingResult(value: unknown): TrainingResult | undefined {
  if (!isValidTrainingResult(value)) return undefined;
  return {
    scenarioId: value.scenarioId.slice(0, 256),
    completedAt: value.completedAt.slice(0, 128),
    action: value.action as PokerAction,
    actionCorrect: value.actionCorrect,
    ...(value.mathAnswer === undefined
      ? {}
      : { mathAnswer: value.mathAnswer as number }),
    mathCorrect: value.mathCorrect,
    elapsedMs: value.elapsedMs,
    eloDelta: value.eloDelta,
  };
}

function isValidTrainingResult(
  value: unknown,
): value is Record<string, unknown> & {
  scenarioId: string;
  completedAt: string;
  action: PokerAction;
  actionCorrect: boolean;
  mathCorrect: boolean;
  elapsedMs: number;
  eloDelta: number;
} {
  return (
    isRecord(value) &&
    typeof value.scenarioId === "string" &&
    value.scenarioId.length > 0 &&
    value.scenarioId.length <= 256 &&
    typeof value.completedAt === "string" &&
    value.completedAt.length > 0 &&
    value.completedAt.length <= 128 &&
    actions.has(value.action as PokerAction) &&
    typeof value.actionCorrect === "boolean" &&
    typeof value.mathCorrect === "boolean" &&
    typeof value.elapsedMs === "number" &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0 &&
    typeof value.eloDelta === "number" &&
    Number.isFinite(value.eloDelta) &&
    (value.mathAnswer === undefined ||
      (typeof value.mathAnswer === "number" &&
        Number.isFinite(value.mathAnswer)))
  );
}

function isValidCurrentCareer(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return ["normal", "rational"].every((track) => {
    const candidate = value[track];
    if (candidate === undefined) return true;
    if (!isRecord(candidate)) return false;
    if (
      candidate.activeEventId !== undefined &&
      (typeof candidate.activeEventId !== "string" ||
        candidate.activeEventId.length === 0 ||
        candidate.activeEventId.length > 64)
    ) {
      return false;
    }
    if (candidate.results === undefined) return true;
    if (!Array.isArray(candidate.results) || candidate.results.length > 64) {
      return false;
    }
    return candidate.results.every(isValidCurrentCareerResult);
  });
}

function isValidCurrentCareerResult(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.eventId !== "string" ||
    value.eventId.length === 0 ||
    value.eventId.length > 64 ||
    typeof value.qualified !== "boolean" ||
    !Number.isFinite(value.tournamentEloDelta)
  ) {
    return false;
  }
  return [
    "finishPlace",
    "fieldSize",
    "sourceFieldSize",
    "qualifyingPlaces",
  ].every(
    (key) => Number.isInteger(value[key]) && (value[key] as number) >= 0,
  );
}

function motionIntensityOr(
  value: unknown,
  fallback: GameSettings["menuMotion"],
): GameSettings["menuMotion"] {
  return motionIntensities.has(value as string)
    ? (value as GameSettings["menuMotion"])
    : fallback;
}

function optionalMember(value: unknown, allowed: Set<string>): boolean {
  return value === undefined || allowed.has(value as string);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Math.max(0, Math.trunc(finiteNumber(value, fallback)));
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
}

function finiteBetween(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function invalid<T>(reason: string): PersistedValidationResult<T> {
  return { ok: false, reason };
}

import type {
  CareerEventResult,
  CareerTrack,
  GameSettings,
  PlayerProgress,
  PokerAction,
  TrainingResult,
} from "../types/poker";
import { defaultProgress, defaultSettings } from "./storage";
import { normalizeControlBindingOverrides } from "./actionMap";
import { formatMessage } from "./localeMessages";

export const SAVE_FORMAT = "poker-training-pro-save";
export const CURRENT_SAVE_VERSION = 1;
export const LAST_KNOWN_GOOD_KEY =
  "poker-training-pro:last-known-good-save";

export interface SaveDataV1 {
  settings: GameSettings;
  progress: PlayerProgress;
}

export interface SaveEnvelopeV1 {
  format: typeof SAVE_FORMAT;
  version: 1;
  data: SaveDataV1;
}

export type SaveRestoreErrorCode =
  | "invalid-json"
  | "invalid-payload"
  | "unknown-format"
  | "unsupported-version"
  | "storage-unavailable";

export type SaveRestoreResult =
  | {
      ok: true;
      save: SaveEnvelopeV1;
      migratedFromVersion: 0 | 1;
    }
  | {
      ok: false;
      error: {
        code: SaveRestoreErrorCode;
        message: string;
      };
    };

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const actions = new Set<PokerAction>([
  "fold",
  "check",
  "call",
  "raise",
  "all-in",
]);

/**
 * Builds a validated current-version save without mutating either source object.
 * Invalid leaf values are replaced with safe defaults so one damaged preference
 * cannot make otherwise recoverable progress unusable.
 */
export function createSaveEnvelope(
  settings: unknown,
  progress: unknown,
): SaveEnvelopeV1 {
  return {
    format: SAVE_FORMAT,
    version: CURRENT_SAVE_VERSION,
    data: {
      settings: normalizeSettings(settings),
      progress: normalizeProgress(progress),
    },
  };
}

/**
 * Canonical JSON makes equal saves byte-for-byte equal regardless of object key
 * insertion order. This is useful for comparing and de-duplicating backups.
 */
export function serializeSaveBackup(
  settingsOrEnvelope: unknown,
  progress?: unknown,
): string {
  const envelope =
    isCurrentEnvelope(settingsOrEnvelope) && progress === undefined
      ? createSaveEnvelope(
          settingsOrEnvelope.data.settings,
          settingsOrEnvelope.data.progress,
        )
      : createSaveEnvelope(settingsOrEnvelope, progress);
  return stableStringify(envelope);
}

/**
 * Restores a current save or migrates the original unversioned
 * `{ settings, progress }` shape. Unsupported future versions are rejected
 * rather than being rewritten and potentially losing fields.
 */
export function restoreSaveBackup(serialized: string): SaveRestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return failure("invalid-json", formatMessage("saveData.error.invalidJson"));
  }
  return migrateSavePayload(parsed);
}

export function migrateSavePayload(payload: unknown): SaveRestoreResult {
  if (!isRecord(payload)) {
    return failure(
      "invalid-payload",
      formatMessage("saveData.error.invalidPayload"),
    );
  }

  if ("format" in payload && payload.format !== SAVE_FORMAT) {
    return failure(
      "unknown-format",
      formatMessage("saveData.error.unknownFormat"),
    );
  }

  if ("version" in payload && payload.version !== 0 && payload.version !== 1) {
    return failure(
      "unsupported-version",
      formatMessage("saveData.error.unsupportedVersion"),
    );
  }

  if (payload.version === 1 || payload.format === SAVE_FORMAT) {
    if (
      payload.version !== 1 ||
      !isRecord(payload.data) ||
      !isRecord(payload.data.settings) ||
      !isRecord(payload.data.progress)
    ) {
      return failure(
        "invalid-payload",
        formatMessage("saveData.error.versionedIncomplete"),
      );
    }
    return {
      ok: true,
      save: createSaveEnvelope(
        payload.data.settings,
        payload.data.progress,
      ),
      migratedFromVersion: 1,
    };
  }

  const legacyData =
    payload.version === 0 && isRecord(payload.data) ? payload.data : payload;
  if (!("settings" in legacyData) && !("progress" in legacyData)) {
    return failure(
      "invalid-payload",
      formatMessage("saveData.error.legacyIncomplete"),
    );
  }

  return {
    ok: true,
    save: createSaveEnvelope(legacyData.settings, legacyData.progress),
    migratedFromVersion: 0,
  };
}

export function writeLastKnownGoodBackup(
  storage: KeyValueStorage,
  settings: unknown,
  progress: unknown,
): SaveRestoreResult {
  const serialized = serializeSaveBackup(settings, progress);
  try {
    storage.setItem(LAST_KNOWN_GOOD_KEY, serialized);
  } catch {
    return failure(
      "storage-unavailable",
      formatMessage("saveData.error.lastKnownGoodWriteFailed"),
    );
  }
  return restoreSaveBackup(serialized);
}

export function readLastKnownGoodBackup(
  storage: KeyValueStorage,
): SaveRestoreResult {
  let serialized: string | null;
  try {
    serialized = storage.getItem(LAST_KNOWN_GOOD_KEY);
  } catch {
    return failure(
      "storage-unavailable",
      formatMessage("saveData.error.lastKnownGoodReadFailed"),
    );
  }
  if (serialized === null) {
    return failure(
      "invalid-payload",
      formatMessage("saveData.error.lastKnownGoodUnavailable"),
    );
  }
  return restoreSaveBackup(serialized);
}

function normalizeSettings(value: unknown): GameSettings {
  const source = isRecord(value) ? value : {};
  return {
    masterVolume: boundedNumber(
      source.masterVolume,
      0,
      100,
      defaultSettings.masterVolume,
    ),
    muted: booleanOr(
      source.muted,
      defaultSettings.muted,
    ),
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
    dealSpeed:
      source.dealSpeed === "cinematic" ||
      source.dealSpeed === "standard" ||
      source.dealSpeed === "quick"
        ? source.dealSpeed
        : defaultSettings.dealSpeed,
    colorAssist: booleanOr(source.colorAssist, defaultSettings.colorAssist),
    cameraSensitivity:
      source.cameraSensitivity === "low" ||
      source.cameraSensitivity === "standard" ||
      source.cameraSensitivity === "high"
        ? source.cameraSensitivity
        : defaultSettings.cameraSensitivity,
    cameraView:
      source.cameraView === "close" ||
      source.cameraView === "standard" ||
      source.cameraView === "wide"
        ? source.cameraView
        : defaultSettings.cameraView,
    autoCameraMovement: booleanOr(
      source.autoCameraMovement,
      defaultSettings.autoCameraMovement,
    ),
    menuMotion: motionIntensityOr(source.menuMotion, defaultSettings.menuMotion),
    roomMotion: motionIntensityOr(source.roomMotion, defaultSettings.roomMotion),
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
    interfaceScale:
      source.interfaceScale === "compact" ||
      source.interfaceScale === "standard" ||
      source.interfaceScale === "large" ||
      source.interfaceScale === "extra-large"
        ? source.interfaceScale
        : defaultSettings.interfaceScale,
    // Preserve remapped controls through the durable save path, validating the
    // untrusted persisted shape and dropping unknown ids/tokens.
    ...(normalizeControlBindingOverrides(source.controlBindings)
      ? {
          controlBindings: normalizeControlBindingOverrides(
            source.controlBindings,
          ),
        }
      : {}),
  };
}

function motionIntensityOr(
  value: unknown,
  fallback: GameSettings["menuMotion"],
): GameSettings["menuMotion"] {
  return value === "full" || value === "reduced" || value === "off"
    ? value
    : fallback;
}

function normalizeProgress(value: unknown): PlayerProgress {
  const source = isRecord(value) ? value : {};
  const results = Array.isArray(source.results)
    ? source.results
        .map(normalizeTrainingResult)
        .filter((result): result is TrainingResult => result !== undefined)
        .slice(-250)
    : [];

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
 * Rolling review aggregates. Optional in the schema, so a save written before
 * reviews existed migrates to zeroes rather than being rejected.
 */
function normalizeReviewTotals(
  value: unknown,
): PlayerProgress["reviewTotals"] {
  const source = isRecord(value) ? value : {};
  const decisions = nonNegativeInteger(source.decisions, 0);
  return {
    roundsReviewed: nonNegativeInteger(source.roundsReviewed, 0),
    decisions,
    // Cannot exceed the decisions it is counted from.
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
    sourceFieldSize: Math.max(1, nonNegativeInteger(value.sourceFieldSize, 6)),
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
  const results = Array.isArray(source.results)
    ? source.results
        .map(normalizeCareerResult)
        .filter((result): result is CareerEventResult => result !== undefined)
        // One entry per event: a replayed event supersedes its earlier result.
        .reduce<CareerEventResult[]>((unique, result) => {
          const existing = unique.findIndex(
            (entry) => entry.eventId === result.eventId,
          );
          if (existing >= 0) unique[existing] = result;
          else unique.push(result);
          return unique;
        }, [])
        .slice(-64)
    : [];
  const activeEventId =
    typeof source.activeEventId === "string" && source.activeEventId.length > 0
      ? source.activeEventId.slice(0, 64)
      : undefined;
  return activeEventId ? { results, activeEventId } : { results };
}

/**
 * Career state is optional in the schema, so a save written before it existed
 * migrates to empty tracks rather than being rejected.
 */
function normalizeCareer(value: unknown): PlayerProgress["career"] {
  const source = isRecord(value) ? value : {};
  return {
    normal: normalizeCareerTrack(source.normal),
    rational: normalizeCareerTrack(source.rational),
  };
}

function normalizeTrainingResult(value: unknown): TrainingResult | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.scenarioId !== "string" ||
    value.scenarioId.length === 0 ||
    typeof value.completedAt !== "string" ||
    !actions.has(value.action as PokerAction) ||
    typeof value.actionCorrect !== "boolean" ||
    typeof value.mathCorrect !== "boolean"
  ) {
    return undefined;
  }

  const elapsedMs = finiteNumber(value.elapsedMs, Number.NaN);
  const eloDelta = finiteNumber(value.eloDelta, Number.NaN);
  if (elapsedMs < 0 || !Number.isFinite(elapsedMs) || !Number.isFinite(eloDelta)) {
    return undefined;
  }
  if (
    value.mathAnswer !== undefined &&
    !Number.isFinite(value.mathAnswer)
  ) {
    return undefined;
  }

  return {
    scenarioId: value.scenarioId,
    completedAt: value.completedAt,
    action: value.action as PokerAction,
    actionCorrect: value.actionCorrect,
    ...(value.mathAnswer === undefined
      ? {}
      : { mathAnswer: value.mathAnswer as number }),
    mathCorrect: value.mathCorrect,
    elapsedMs,
    eloDelta,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function isCurrentEnvelope(value: unknown): value is SaveEnvelopeV1 {
  return (
    isRecord(value) &&
    value.format === SAVE_FORMAT &&
    value.version === CURRENT_SAVE_VERSION &&
    isRecord(value.data)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function failure(
  code: SaveRestoreErrorCode,
  message: string,
): SaveRestoreResult {
  return { ok: false, error: { code, message } };
}

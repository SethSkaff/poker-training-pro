/**
 * The deliberately small resume payload for a Training hand. It contains only
 * the scenario identifier, never an answer key, hidden holdings, or a graded
 * result. The small presentation payload is deliberately limited to the
 * player's own camera and frozen decision clock; it contains no answers,
 * score, opponent holdings, or future deal information.
 */
export interface TrainingCheckpoint extends Record<string, unknown> {
  format: "poker-training-pro-training-checkpoint";
  version: 2;
  scenarioId: string;
  presentation: TrainingPresentationCheckpoint;
}

export interface TrainingPresentationCheckpoint {
  /** Integer seat offsets, with zero facing the dealer. */
  cameraPan: number;
  /** Frozen elapsed decision time; unsubmitted answers stay out of the save. */
  elapsedMs: number;
  /** Reopen the explicit pause menu instead of silently resuming a hand. */
  paused: boolean;
}

const defaultPresentation: TrainingPresentationCheckpoint = {
  cameraPan: 0,
  elapsedMs: 0,
  paused: false,
};

export function createTrainingCheckpoint(
  scenarioId: string,
  presentation: Partial<TrainingPresentationCheckpoint> = defaultPresentation,
): TrainingCheckpoint {
  return {
    format: "poker-training-pro-training-checkpoint",
    version: 2,
    scenarioId,
    presentation: normalizePresentation(presentation),
  };
}

export function restoreTrainingCheckpoint(
  value: unknown,
  availableScenarioIds: ReadonlySet<string>,
): TrainingCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.format !== "poker-training-pro-training-checkpoint" ||
    (value.version !== 1 && value.version !== 2) ||
    typeof value.scenarioId !== "string" ||
    value.scenarioId.length === 0 ||
    value.scenarioId.length > 256 ||
    !availableScenarioIds.has(value.scenarioId)
  ) {
    return undefined;
  }
  return createTrainingCheckpoint(
    value.scenarioId,
    value.version === 2 ? presentationFromUnknown(value.presentation) : undefined,
  );
}

function presentationFromUnknown(value: unknown): Partial<TrainingPresentationCheckpoint> {
  if (!isRecord(value)) return defaultPresentation;
  return {
    cameraPan: typeof value.cameraPan === "number" ? value.cameraPan : 0,
    elapsedMs: typeof value.elapsedMs === "number" ? value.elapsedMs : 0,
    paused: value.paused === true,
  };
}

function normalizePresentation(
  value: Partial<TrainingPresentationCheckpoint> | undefined,
): TrainingPresentationCheckpoint {
  const cameraPan = Number.isFinite(value?.cameraPan)
    ? Math.round(Math.max(-2, Math.min(2, value?.cameraPan ?? 0)))
    : 0;
  const elapsedMs = Number.isFinite(value?.elapsedMs)
    ? Math.round(Math.max(0, Math.min(12 * 60 * 60 * 1000, value?.elapsedMs ?? 0)))
    : 0;
  return { cameraPan, elapsedMs, paused: value?.paused === true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

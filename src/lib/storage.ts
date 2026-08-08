import type { GameSettings, PlayerProgress } from "../types/poker";

const SETTINGS_KEY = "poker-training-pro:settings";
const PROGRESS_KEY = "poker-training-pro:progress";
const LEGACY_SETTINGS_KEY = "poker-math-academy:settings";
const LEGACY_PROGRESS_KEY = "poker-math-academy:progress";

export const defaultSettings: GameSettings = {
  masterVolume: 100,
  muted: false,
  musicVolume: 35,
  effectsVolume: 70,
  fullscreen: false,
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
  // The 3D room is off until the vertical slice is complete (E09-001 M1). It is
  // presentation only, so this default changes what is drawn and never what the
  // game does.
  spatialScene: false,
  // No control remaps by default; the action map supplies built-in bindings.
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

function readValue<T>(key: string, fallback: T, legacyKey?: string): T {
  try {
    const value =
      localStorage.getItem(key) ??
      (legacyKey ? localStorage.getItem(legacyKey) : null);
    return value ? ({ ...fallback, ...JSON.parse(value) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSettings(): GameSettings {
  return readValue(SETTINGS_KEY, defaultSettings, LEGACY_SETTINGS_KEY);
}

export function saveSettings(settings: GameSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadProgress(): PlayerProgress {
  const stored = readValue(
    PROGRESS_KEY,
    defaultProgress,
    LEGACY_PROGRESS_KEY,
  );
  return {
    ...defaultProgress,
    ...stored,
    decisionElo: finiteOr(stored.decisionElo, defaultProgress.decisionElo),
    mathElo: finiteOr(stored.mathElo, defaultProgress.mathElo),
    tournamentElo: finiteOr(
      stored.tournamentElo,
      defaultProgress.tournamentElo,
    ),
    trainingCompleted: Math.max(
      0,
      Math.trunc(
        finiteOr(stored.trainingCompleted, defaultProgress.trainingCompleted),
      ),
    ),
    currentStreak: Math.max(
      0,
      Math.trunc(finiteOr(stored.currentStreak, defaultProgress.currentStreak)),
    ),
    bestStreak: Math.max(
      0,
      Math.trunc(finiteOr(stored.bestStreak, defaultProgress.bestStreak)),
    ),
    totalDecisionMs: Math.max(
      0,
      finiteOr(stored.totalDecisionMs, defaultProgress.totalDecisionMs),
    ),
    results: Array.isArray(stored.results) ? stored.results.slice(-250) : [],
  };
}

export function saveProgress(progress: PlayerProgress) {
  const boundedResults = progress.results.slice(-250);
  try {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ ...progress, results: boundedResults }),
    );
  } catch {
    // The in-memory session remains playable when storage is unavailable.
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

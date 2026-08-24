import type { GameSettings, PlayerProgress } from "../types/poker";
import {
  defaultProgress,
  defaultSettings,
  normalizePersistedProgress,
  normalizePersistedSettings,
} from "./persistedDataNormalization";

const SETTINGS_KEY = "poker-training-pro:settings";
const PROGRESS_KEY = "poker-training-pro:progress";
const LEGACY_SETTINGS_KEY = "poker-math-academy:settings";
const LEGACY_PROGRESS_KEY = "poker-math-academy:progress";

export { defaultProgress, defaultSettings } from "./persistedDataNormalization";

function readValue<T>(
  key: string,
  legacyKey: string,
  fallback: T,
  normalize: (value: unknown) => T,
): T {
  try {
    const serialized =
      localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (serialized === null) return fallback;
    return normalize(JSON.parse(serialized) as unknown);
  } catch {
    return fallback;
  }
}

export function loadSettings(): GameSettings {
  return readValue(
    SETTINGS_KEY,
    LEGACY_SETTINGS_KEY,
    defaultSettings,
    normalizePersistedSettings,
  );
}

export function saveSettings(settings: GameSettings) {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify(normalizePersistedSettings(settings)),
    );
  } catch {
    // The in-memory session remains playable when storage is unavailable.
  }
}

export function loadProgress(): PlayerProgress {
  return readValue(
    PROGRESS_KEY,
    LEGACY_PROGRESS_KEY,
    defaultProgress,
    normalizePersistedProgress,
  );
}

export function saveProgress(progress: PlayerProgress) {
  try {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify(normalizePersistedProgress(progress)),
    );
  } catch {
    // The in-memory session remains playable when storage is unavailable.
  }
}

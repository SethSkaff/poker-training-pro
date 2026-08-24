import type { GameSettings, PlayerProgress } from "../types/poker";
import {
  normalizePersistedProgress,
  normalizePersistedSettings,
} from "./persistedDataNormalization";
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

/**
 * Builds a validated current-version save without mutating either source
 * object. Browser startup, browser writes, backup migration, and durable-save
 * snapshots all use the same leaf-by-leaf normalization contract.
 */
export function createSaveEnvelope(
  settings: unknown,
  progress: unknown,
): SaveEnvelopeV1 {
  return {
    format: SAVE_FORMAT,
    version: CURRENT_SAVE_VERSION,
    data: {
      settings: normalizePersistedSettings(settings),
      progress: normalizePersistedProgress(progress),
    },
  };
}

/** Canonical JSON keeps equal backups byte-for-byte equal. */
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function failure(
  code: SaveRestoreErrorCode,
  message: string,
): SaveRestoreResult {
  return { ok: false, error: { code, message } };
}

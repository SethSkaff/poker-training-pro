import type { GameSettings, PlayerProgress } from "../types/poker";
import {
  createSaveEnvelope,
  migrateSavePayload,
  restoreSaveBackup,
  serializeSaveBackup,
  type SaveEnvelopeV1,
} from "./saveMigration";

export type DurableBoundary =
  | "settings"
  | "action"
  | "hand"
  | "result"
  | "lifecycle";

export type DurableSaveSource =
  | "current"
  | "previous"
  | "last-known-good"
  | "browser-import";

export type DurableFailureCode =
  | "no-save"
  | "invalid-json"
  | "invalid-record"
  | "checksum-mismatch"
  | "invalid-payload"
  | "unknown-format"
  | "unsupported-save-version"
  | "read-failed"
  | "disk-full"
  | "quota-exceeded"
  | "permission-denied"
  | "write-failed"
  | "storage-unavailable"
  | "no-valid-generation"
  | "foreign-save"
  | "future-save"
  | "cyclic-save"
  | "import-too-large"
  | "import-changed"
  | "save-changed"
  | "invalid-confirmation"
  | "invalid-current-save"
  | "invalid-replay"
  | "replay-too-large"
  | "developer-export-disabled"
  | "picker-failed"
  | "cancelled";

export interface DurableFailure {
  code: DurableFailureCode;
  operation:
    | "probe"
    | "read"
    | "migrate"
    | "write"
    | "archive"
    | "export"
    | "replay-export"
    | "import"
    | "reset";
  message: string;
  retryable: boolean;
  source?: DurableSaveSource;
  systemCode?: string;
}

export type DurableResult<T> =
  | { ok: true; value: T; warnings?: DurableFailure[] }
  | { ok: false; error: DurableFailure; attempts?: DurableFailure[] };

export interface DurableSaveReceipt {
  boundary: DurableBoundary;
  savedAt: string;
  rotatedPrevious: boolean;
  ignoredCorruptCurrent: boolean;
}

export interface RecoveryCandidate {
  source: Exclude<DurableSaveSource, "browser-import">;
  save: SaveEnvelopeV1;
  savedAt?: string;
  boundary?: DurableBoundary;
}

export interface BrowserImportCandidate {
  source: "browser-import";
  save: SaveEnvelopeV1;
  serializedSave: string;
  sourceKeys: string[];
  preview: {
    playerName: string;
    trainingCompleted: number;
    resultCount: number;
  };
}

export interface SaveImportPreview {
  confirmationToken: string;
  expiresAt: string;
  migratedFromVersion: 0 | 1;
  trainingCompleted: number;
  resultCount: number;
  decisionElo: number;
  mathElo: number;
  tournamentElo: number;
  settingsWillBeReplaced: true;
  progressWillBeReplaced: true;
}

export interface ProgressResetPreview {
  confirmationToken: string;
  expiresAt: string;
  trainingCompleted: number;
  resultCount: number;
  settingsWillBePreserved: true;
  progressWillBeReset: true;
}

type RawTransferResult<T> =
  | { ok: true; preview: T }
  | {
      ok: false;
      error: {
        code: string;
        message?: string;
        systemCode?: string;
        retryable?: boolean;
      };
    };

type RawTransferCommitResult =
  | { ok: true; receipt: DurableSaveReceipt }
  | {
      ok: false;
      error: {
        code: string;
        message?: string;
        systemCode?: string;
        retryable?: boolean;
      };
    };

type RawReplayExportResult =
  | {
      ok: true;
      fileName: string;
      kind: "public" | "developer";
    }
  | {
      ok: false;
      error: {
        code: string;
        message?: string;
        systemCode?: string;
        retryable?: boolean;
      };
    };

export type StartupLoadResult =
  | {
      kind: "ready";
      save: SaveEnvelopeV1;
      source: "current" | "browser-import";
      receipt?: DurableSaveReceipt;
      warnings: DurableFailure[];
      replay?: Record<string, unknown>;
    }
  | { kind: "first-run" }
  | { kind: "import-ready"; candidate: BrowserImportCandidate }
  | {
      kind: "recovery";
      failure: DurableFailure;
      attempts: DurableFailure[];
      recommended?: RecoveryCandidate;
    };

export interface RawGeneration {
  source: "current" | "previous" | "last-known-good";
  exists: boolean;
  record?: {
    boundary: DurableBoundary;
    savedAt: string;
    payload: string;
    replay?: Record<string, unknown>;
  };
  error?: {
    code: string;
    message?: string;
    systemCode?: string;
  };
}

export interface DesktopPersistenceBridge {
  loadAutosave(): Promise<
    | {
        ok: true;
        source: "current" | "previous";
        record: {
          boundary: DurableBoundary;
          savedAt: string;
          payload: string;
          replay?: Record<string, unknown>;
        };
        errors?: Array<{
          source: "current" | "previous";
          code: string;
          message?: string;
          systemCode?: string;
        }>;
      }
    | {
        ok: false;
        error: {
          code: string;
          message?: string;
          generations?: Array<{
            source: "current" | "previous";
            code: string;
            message?: string;
            systemCode?: string;
          }>;
        };
      }
  >;
  probeAutosaves?(): Promise<{
    generations: RawGeneration[];
    hasAuthoritativeEvidence?: boolean;
  }>;
  commitAutosave(
    serializedSave: string,
    boundary: DurableBoundary,
    replay?: Record<string, unknown>,
  ): Promise<
    | {
        ok: true;
        receipt: DurableSaveReceipt;
      }
    | {
        ok: false;
        error: {
          code: string;
          message?: string;
          systemCode?: string;
          retryable?: boolean;
        };
      }
    | DurableSaveReceipt
  >;
  restoreAutosave?(
    source: "previous" | "last-known-good",
  ): Promise<
    | { ok: true; receipt: DurableSaveReceipt }
    | { ok: false; error: { code: string; message?: string; systemCode?: string } }
  >;
  startFreshAutosave?(
    serializedSave: string,
  ): Promise<
    | { ok: true; receipt: DurableSaveReceipt }
    | { ok: false; error: { code: string; message?: string; systemCode?: string } }
  >;
  exportSave?(
    source?: "current" | "previous" | "last-known-good",
  ): Promise<
    | { ok: true; fileName?: string }
    | { ok: false; error: { code: string; message?: string; systemCode?: string } }
  >;
  exportSaveDiagnostics?(): Promise<
    | { ok: true; fileName?: string }
    | { ok: false; error: { code: string; message?: string; systemCode?: string } }
  >;
  prepareSaveImport?(): Promise<RawTransferResult<SaveImportPreview>>;
  confirmSaveImport?(
    confirmationToken: string,
  ): Promise<RawTransferCommitResult>;
  prepareProgressReset?(): Promise<
    RawTransferResult<ProgressResetPreview>
  >;
  confirmProgressReset?(
    confirmationToken: string,
  ): Promise<RawTransferCommitResult>;
  exportPublicReplay?(
    replay: Record<string, unknown>,
  ): Promise<RawReplayExportResult>;
  exportDeveloperReplay?(
    replay: Record<string, unknown>,
  ): Promise<RawReplayExportResult>;
}

export interface PendingCommit {
  serializedSave: string;
  boundary: DurableBoundary;
  replay?: Record<string, unknown>;
}

const CURRENT_SETTINGS_KEY = "poker-training-pro:settings";
const CURRENT_PROGRESS_KEY = "poker-training-pro:progress";
const LEGACY_SETTINGS_KEY = "poker-math-academy:settings";
const LEGACY_PROGRESS_KEY = "poker-math-academy:progress";

/**
 * Renderer-side coordinator for the authoritative Electron journal.
 *
 * Browser storage is read only as a first-run import source. Every successful
 * write is acknowledged by Electron before this class returns a receipt, and a
 * failed action/hand commit remains available through `retryPendingCommit`.
 */
export class DurablePersistence {
  private pendingCommit?: PendingCommit;

  constructor(
    private readonly desktop: DesktopPersistenceBridge,
    private readonly browserStorage?: Pick<Storage, "getItem">,
  ) {}

  async loadStartup(): Promise<StartupLoadResult> {
    if (this.desktop.probeAutosaves) {
      return this.loadFromGenerationProbe();
    }
    return this.loadFromLegacyProbe();
  }

  commitAction(
    settings: GameSettings,
    progress: PlayerProgress,
    replay?: Record<string, unknown>,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    return this.commitBoundary("action", settings, progress, replay);
  }

  commitHand(
    settings: GameSettings,
    progress: PlayerProgress,
    replay?: Record<string, unknown>,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    return this.commitBoundary("hand", settings, progress, replay);
  }

  commitSettings(
    settings: GameSettings,
    progress: PlayerProgress,
    replay?: Record<string, unknown>,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    return this.commitBoundary("settings", settings, progress, replay);
  }

  commitResult(
    settings: GameSettings,
    progress: PlayerProgress,
    replay?: Record<string, unknown>,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    return this.commitBoundary("result", settings, progress, replay);
  }

  commitLifecycle(
    settings: GameSettings,
    progress: PlayerProgress,
    replay?: Record<string, unknown>,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    return this.commitBoundary("lifecycle", settings, progress, replay);
  }

  async retryPendingCommit(): Promise<DurableResult<DurableSaveReceipt>> {
    if (!this.pendingCommit) {
      return {
        ok: false,
        error: {
          code: "write-failed",
          operation: "write",
          message: "There is no pending save to retry.",
          retryable: false,
        },
      };
    }
    return this.writePending(this.pendingCommit);
  }

  hasPendingCommit(): boolean {
    return this.pendingCommit !== undefined;
  }

  async confirmBrowserImport(
    candidate: BrowserImportCandidate,
  ): Promise<DurableResult<StartupLoadResult>> {
    const migrated = restoreSaveBackup(candidate.serializedSave);
    if (!migrated.ok) {
      return {
        ok: false,
        error: migrationFailure(migrated.error.code, "browser-import"),
      };
    }
    const written = await this.commitSerialized(
      candidate.serializedSave,
      "lifecycle",
    );
    if (!written.ok) return written;
    return {
      ok: true,
      value: {
        kind: "ready",
        save: migrated.save,
        source: "browser-import",
        receipt: written.value,
        warnings: [],
      },
    };
  }

  async restore(
    source: "previous" | "last-known-good",
  ): Promise<DurableResult<DurableSaveReceipt>> {
    if (!this.desktop.restoreAutosave) {
      return unavailable("Restore is not available in this desktop build.");
    }
    try {
      const result = await this.desktop.restoreAutosave(source);
      if (result.ok) return { ok: true, value: result.receipt };
      return { ok: false, error: ipcFailure(result.error, "archive", source) };
    } catch (error) {
      return { ok: false, error: thrownFailure(error, "archive", source) };
    }
  }

  async startFresh(
    settings: GameSettings,
    progress: PlayerProgress,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    if (!this.desktop.startFreshAutosave) {
      return unavailable("Start Fresh is not available in this desktop build.");
    }
    const serializedSave = serializeSaveBackup(settings, progress);
    try {
      const result = await this.desktop.startFreshAutosave(serializedSave);
      if (result.ok) return { ok: true, value: result.receipt };
      return { ok: false, error: ipcFailure(result.error, "archive") };
    } catch (error) {
      return { ok: false, error: thrownFailure(error, "archive") };
    }
  }

  exportSave(
    source?: "current" | "previous" | "last-known-good",
  ): Promise<DurableResult<{ fileName?: string }>> {
    return this.runExport(
      this.desktop.exportSave?.bind(this.desktop),
      source,
      "Save export is not available in this desktop build.",
    );
  }

  exportDiagnostics(): Promise<DurableResult<{ fileName?: string }>> {
    return this.runExport(
      this.desktop.exportSaveDiagnostics?.bind(this.desktop),
      undefined,
      "Diagnostic export is not available in this desktop build.",
    );
  }

  exportPublicReplay(
    replay: Record<string, unknown>,
  ): Promise<DurableResult<{ fileName: string; kind: "public" }>> {
    return this.runReplayExport(
      this.desktop.exportPublicReplay?.bind(this.desktop),
      replay,
      "public",
    );
  }

  exportDeveloperReplay(
    replay: Record<string, unknown>,
  ): Promise<DurableResult<{ fileName: string; kind: "developer" }>> {
    return this.runReplayExport(
      this.desktop.exportDeveloperReplay?.bind(this.desktop),
      replay,
      "developer",
    );
  }

  async prepareSaveImport(): Promise<DurableResult<SaveImportPreview>> {
    if (!this.desktop.prepareSaveImport) {
      return unavailableFor(
        "import",
        "Save import is not available in this desktop build.",
      );
    }
    try {
      const result = await this.desktop.prepareSaveImport();
      return result.ok
        ? { ok: true, value: result.preview }
        : { ok: false, error: ipcFailure(result.error, "import") };
    } catch (error) {
      return { ok: false, error: thrownFailure(error, "import") };
    }
  }

  async confirmSaveImport(
    confirmationToken: string,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    if (!this.desktop.confirmSaveImport) {
      return unavailableFor(
        "import",
        "Save import is not available in this desktop build.",
      );
    }
    try {
      const result =
        await this.desktop.confirmSaveImport(confirmationToken);
      return result.ok
        ? { ok: true, value: result.receipt }
        : { ok: false, error: ipcFailure(result.error, "import") };
    } catch (error) {
      return { ok: false, error: thrownFailure(error, "import") };
    }
  }

  async prepareProgressReset(): Promise<
    DurableResult<ProgressResetPreview>
  > {
    if (!this.desktop.prepareProgressReset) {
      return unavailableFor(
        "reset",
        "Progress reset is not available in this desktop build.",
      );
    }
    try {
      const result = await this.desktop.prepareProgressReset();
      return result.ok
        ? { ok: true, value: result.preview }
        : { ok: false, error: ipcFailure(result.error, "reset") };
    } catch (error) {
      return { ok: false, error: thrownFailure(error, "reset") };
    }
  }

  async confirmProgressReset(
    confirmationToken: string,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    if (!this.desktop.confirmProgressReset) {
      return unavailableFor(
        "reset",
        "Progress reset is not available in this desktop build.",
      );
    }
    try {
      const result =
        await this.desktop.confirmProgressReset(confirmationToken);
      return result.ok
        ? { ok: true, value: result.receipt }
        : { ok: false, error: ipcFailure(result.error, "reset") };
    } catch (error) {
      return { ok: false, error: thrownFailure(error, "reset") };
    }
  }

  private async commitBoundary(
    boundary: DurableBoundary,
    settings: GameSettings,
    progress: PlayerProgress,
    replay?: Record<string, unknown>,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    const pending: PendingCommit = {
      serializedSave: serializeSaveBackup(settings, progress),
      boundary,
      ...(replay === undefined ? {} : { replay }),
    };
    this.pendingCommit = pending;
    return this.writePending(pending);
  }

  private async runReplayExport<K extends "public" | "developer">(
    operation:
      | ((
          replay: Record<string, unknown>,
        ) => Promise<RawReplayExportResult>)
      | undefined,
    replay: Record<string, unknown>,
    kind: K,
  ): Promise<DurableResult<{ fileName: string; kind: K }>> {
    if (!operation) {
      return unavailableFor(
        "replay-export",
        "Replay export is not available in this desktop build.",
      );
    }
    try {
      const result = await operation(replay);
      return result.ok
        ? {
            ok: true,
            value: { fileName: result.fileName, kind },
          }
        : {
            ok: false,
            error: ipcFailure(result.error, "replay-export"),
          };
    } catch (error) {
      return {
        ok: false,
        error: thrownFailure(error, "replay-export"),
      };
    }
  }

  private async writePending(
    pending: PendingCommit,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    const result = await this.commitSerialized(
      pending.serializedSave,
      pending.boundary,
      pending.replay,
    );
    if (result.ok && this.pendingCommit === pending) {
      this.pendingCommit = undefined;
    }
    return result;
  }

  private async commitSerialized(
    serializedSave: string,
    boundary: DurableBoundary,
    replay?: Record<string, unknown>,
  ): Promise<DurableResult<DurableSaveReceipt>> {
    const validation = restoreSaveBackup(serializedSave);
    if (!validation.ok) {
      return {
        ok: false,
        error: migrationFailure(validation.error.code),
      };
    }
    try {
      const response = await this.desktop.commitAutosave(
        serializedSave,
        boundary,
        replay,
      );
      if ("ok" in response) {
        return response.ok
          ? { ok: true, value: response.receipt }
          : { ok: false, error: ipcFailure(response.error, "write") };
      }
      return { ok: true, value: response };
    } catch (error) {
      return { ok: false, error: thrownFailure(error, "write") };
    }
  }

  private async loadFromGenerationProbe(): Promise<StartupLoadResult> {
    let probe: {
      generations: RawGeneration[];
      hasAuthoritativeEvidence?: boolean;
    };
    try {
      probe = await this.desktop.probeAutosaves!();
    } catch (error) {
      const failure = thrownFailure(error, "probe");
      return { kind: "recovery", failure, attempts: [failure] };
    }

    const attempts: DurableFailure[] = [];
    let previousCandidate: RecoveryCandidate | undefined;
    let hasFileEvidence = probe.hasAuthoritativeEvidence ?? false;

    for (const source of ["current", "previous", "last-known-good"] as const) {
      const generation = probe.generations.find(
        (candidate) => candidate.source === source,
      );
      if (!generation || !generation.exists) continue;
      hasFileEvidence = true;
      if (generation.error || !generation.record) {
        attempts.push(
          ipcFailure(
            generation.error ?? { code: "invalid-record" },
            "read",
            source,
          ),
        );
        continue;
      }

      const restored = restoreSaveBackup(generation.record.payload);
      if (!restored.ok) {
        attempts.push(
          migrationFailure(restored.error.code, source),
        );
        continue;
      }

      const candidate: RecoveryCandidate = {
        source,
        save: restored.save,
        savedAt: generation.record.savedAt,
        boundary: generation.record.boundary,
      };
      if (source === "current") {
        return {
          kind: "ready",
          save: restored.save,
          source: "current",
          warnings: attempts,
          replay: generation.record.replay,
        };
      }
      previousCandidate ??= candidate;
    }

    if (hasFileEvidence) {
      const failure: DurableFailure = {
        code: previousCandidate ? "no-valid-generation" : "no-valid-generation",
        operation: "read",
        message: previousCandidate
          ? "The latest save could not be used. A recovery copy is available."
          : "No valid save generation could be loaded.",
        retryable: attempts.some((attempt) => attempt.retryable),
      };
      return {
        kind: "recovery",
        failure,
        attempts,
        recommended: previousCandidate,
      };
    }

    return this.readBrowserImport();
  }

  private async loadFromLegacyProbe(): Promise<StartupLoadResult> {
    try {
      const loaded = await this.desktop.loadAutosave();
      if (loaded.ok) {
        const restored = restoreSaveBackup(loaded.record.payload);
        if (!restored.ok) {
          const failure = migrationFailure(
            restored.error.code,
            loaded.source,
          );
          return { kind: "recovery", failure, attempts: [failure] };
        }
        if (loaded.source === "previous") {
          const attempts = (loaded.errors ?? []).map((error) =>
            ipcFailure(error, "read", error.source),
          );
          return {
            kind: "recovery",
            failure: {
              code: "no-valid-generation",
              operation: "read",
              message:
                "The latest save could not be used. The previous save can be restored.",
              retryable: attempts.some((attempt) => attempt.retryable),
            },
            attempts,
            recommended: {
              source: "previous",
              save: restored.save,
              savedAt: loaded.record.savedAt,
              boundary: loaded.record.boundary,
            },
          };
        }
        return {
          kind: "ready",
          save: restored.save,
          source: "current",
          warnings: [],
          replay: loaded.record.replay,
        };
      }

      const generations = loaded.error.generations ?? [];
      if (
        generations.length > 0 &&
        generations.every((generation) => generation.code === "missing")
      ) {
        return this.readBrowserImport();
      }
      const attempts = generations.map((error) =>
        ipcFailure(error, "read", error.source),
      );
      const failure = ipcFailure(loaded.error, "read");
      return { kind: "recovery", failure, attempts };
    } catch (error) {
      const failure = thrownFailure(error, "probe");
      return { kind: "recovery", failure, attempts: [failure] };
    }
  }

  private readBrowserImport(): StartupLoadResult {
    if (!this.browserStorage) return { kind: "first-run" };

    let currentSettings: string | null;
    let currentProgress: string | null;
    let legacySettings: string | null;
    let legacyProgress: string | null;
    try {
      currentSettings = this.browserStorage.getItem(CURRENT_SETTINGS_KEY);
      currentProgress = this.browserStorage.getItem(CURRENT_PROGRESS_KEY);
      legacySettings =
        currentSettings === null
          ? this.browserStorage.getItem(LEGACY_SETTINGS_KEY)
          : null;
      legacyProgress =
        currentProgress === null
          ? this.browserStorage.getItem(LEGACY_PROGRESS_KEY)
          : null;
    } catch (error) {
      const failure = browserStorageFailure(error);
      return { kind: "recovery", failure, attempts: [failure] };
    }

    const settingsValue = currentSettings ?? legacySettings;
    const progressValue = currentProgress ?? legacyProgress;
    if (settingsValue === null && progressValue === null) {
      return { kind: "first-run" };
    }

    const parsedSettings = parseBrowserValue(settingsValue);
    const parsedProgress = parseBrowserValue(progressValue);
    if (!parsedSettings.ok || !parsedProgress.ok) {
      const failure: DurableFailure = {
        code: "invalid-json",
        operation: "migrate",
        message:
          "Existing browser progress is damaged and was not imported or replaced.",
        retryable: false,
        source: "browser-import",
      };
      return { kind: "recovery", failure, attempts: [failure] };
    }

    const migrated = migrateSavePayload({
      settings: parsedSettings.value,
      progress: parsedProgress.value,
    });
    if (!migrated.ok) {
      const failure = migrationFailure(
        migrated.error.code,
        "browser-import",
      );
      return { kind: "recovery", failure, attempts: [failure] };
    }

    const sourceKeys = [
      ...(currentSettings !== null
        ? [CURRENT_SETTINGS_KEY]
        : legacySettings !== null
          ? [LEGACY_SETTINGS_KEY]
          : []),
      ...(currentProgress !== null
        ? [CURRENT_PROGRESS_KEY]
        : legacyProgress !== null
          ? [LEGACY_PROGRESS_KEY]
          : []),
    ];
    return {
      kind: "import-ready",
      candidate: {
        source: "browser-import",
        save: migrated.save,
        serializedSave: serializeSaveBackup(migrated.save),
        sourceKeys,
        preview: {
          playerName: migrated.save.data.progress.playerName,
          trainingCompleted:
            migrated.save.data.progress.trainingCompleted,
          resultCount: migrated.save.data.progress.results.length,
        },
      },
    };
  }

  private async runExport(
    operation:
      | ((source?: "current" | "previous" | "last-known-good") => Promise<
          | { ok: true; fileName?: string }
          | {
              ok: false;
              error: { code: string; message?: string; systemCode?: string };
            }
        >)
      | undefined,
    source: "current" | "previous" | "last-known-good" | undefined,
    unavailableMessage: string,
  ): Promise<DurableResult<{ fileName?: string }>> {
    if (!operation) return unavailable(unavailableMessage);
    try {
      const result = await operation(source);
      return result.ok
        ? { ok: true, value: { fileName: result.fileName } }
        : { ok: false, error: ipcFailure(result.error, "export", source) };
    } catch (error) {
      return { ok: false, error: thrownFailure(error, "export", source) };
    }
  }
}

export function createDesktopPersistence(
  browserWindow: Window = window,
): DurablePersistence | undefined {
  if (!browserWindow.desktop) return undefined;
  return new DurablePersistence(
    browserWindow.desktop,
    safeBrowserStorage(browserWindow),
  );
}

function safeBrowserStorage(
  browserWindow: Window,
): Pick<Storage, "getItem"> | undefined {
  try {
    return browserWindow.localStorage;
  } catch (error) {
    return {
      getItem() {
        throw error;
      },
    };
  }
}

function parseBrowserValue(
  serialized: string | null,
): { ok: true; value: unknown } | { ok: false } {
  if (serialized === null) return { ok: true, value: undefined };
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)) return { ok: false };
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function migrationFailure(
  code: string,
  source?: DurableSaveSource,
): DurableFailure {
  const mappedCode: DurableFailureCode =
    code === "unsupported-version"
      ? "unsupported-save-version"
      : code === "unknown-format"
        ? "unknown-format"
        : code === "invalid-json"
          ? "invalid-json"
          : code === "storage-unavailable"
            ? "storage-unavailable"
            : "invalid-payload";
  return {
    code: mappedCode,
    operation: "migrate",
    message:
      mappedCode === "unsupported-save-version"
        ? "This save was created by a newer version of the app."
        : mappedCode === "unknown-format"
          ? "This save belongs to an unknown application or format."
          : "The saved progress could not be validated.",
    retryable: mappedCode === "storage-unavailable",
    source,
  };
}

function browserStorageFailure(error: unknown): DurableFailure {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError") {
    return {
      code: "quota-exceeded",
      operation: "read",
      message: "Browser storage quota prevented the legacy import.",
      retryable: true,
      source: "browser-import",
    };
  }
  if (name === "SecurityError") {
    return {
      code: "permission-denied",
      operation: "read",
      message: "Browser storage access is unavailable.",
      retryable: true,
      source: "browser-import",
    };
  }
  return {
    code: "storage-unavailable",
    operation: "read",
    message: "Browser storage could not be read.",
    retryable: true,
    source: "browser-import",
  };
}

function thrownFailure(
  error: unknown,
  operation: DurableFailure["operation"],
  source?: DurableSaveSource,
): DurableFailure {
  const systemCode =
    isRecord(error) && typeof error.code === "string"
      ? allowSystemCode(error.code)
      : error instanceof Error
        ? allowSystemCodeFromText(error.message)
        : undefined;
  return failureForCode(systemCode ?? "write-failed", operation, source);
}

function ipcFailure(
  error: {
    code: string;
    message?: string;
    systemCode?: string;
    retryable?: boolean;
  },
  operation: DurableFailure["operation"],
  source?: DurableSaveSource,
): DurableFailure {
  const systemCode = allowSystemCode(error.systemCode ?? error.code);
  const stableCode = mapFailureCode(error.code, systemCode, operation);
  const failure = failureForCode(stableCode, operation, source);
  return {
    ...failure,
    retryable: error.retryable ?? failure.retryable,
    ...(systemCode ? { systemCode } : {}),
  };
}

function failureForCode(
  code: string,
  operation: DurableFailure["operation"],
  source?: DurableSaveSource,
): DurableFailure {
  const stableCode = mapFailureCode(code, allowSystemCode(code), operation);
  const messages: Partial<Record<DurableFailureCode, string>> = {
    "disk-full": "The save could not be written because the device is full.",
    "quota-exceeded": "The storage quota was exceeded.",
    "permission-denied":
      "The save location is unavailable or read-only.",
    "read-failed": "The saved progress could not be read.",
    "invalid-json": "A save generation contains incomplete or invalid data.",
    "invalid-record": "A save generation has an invalid format.",
    "checksum-mismatch": "A save generation failed its integrity check.",
    "unsupported-save-version":
      "This save was created by a newer version of the app.",
    "no-valid-generation": "No valid save generation could be loaded.",
    "foreign-save": "The selected file belongs to another application.",
    "future-save":
      "This save was created by a newer version of the app.",
    "cyclic-save": "The selected save contains cyclic data.",
    "import-too-large": "The selected save is too large to import.",
    "import-changed":
      "The selected save changed after preview. Choose it again.",
    "save-changed":
      "Progress changed after preview. Review the reset again.",
    "invalid-confirmation":
      "The confirmation expired or was already used.",
    "invalid-current-save":
      "Current settings could not be validated safely.",
    "invalid-replay": "The replay could not be validated.",
    "replay-too-large": "The replay is too large to export.",
    "developer-export-disabled":
      "Developer replay export is unavailable in this build.",
    "picker-failed": "The replay destination could not be selected.",
    cancelled: "The operation was cancelled.",
  };
  return {
    code: stableCode,
    operation,
    message:
      messages[stableCode] ??
      (operation === "write"
        ? "Progress could not be saved. It remains ready to retry."
        : "The save operation could not be completed."),
    retryable: new Set<DurableFailureCode>([
      "disk-full",
      "quota-exceeded",
      "permission-denied",
      "read-failed",
      "write-failed",
      "storage-unavailable",
    ]).has(stableCode),
    source,
    ...(allowSystemCode(code) ? { systemCode: allowSystemCode(code) } : {}),
  };
}

function mapFailureCode(
  code: string,
  systemCode: string | undefined,
  operation: DurableFailure["operation"],
): DurableFailureCode {
  if (systemCode === "ENOSPC") return "disk-full";
  if (systemCode === "EDQUOT") return "quota-exceeded";
  if (
    systemCode === "EACCES" ||
    systemCode === "EPERM" ||
    systemCode === "EROFS"
  ) {
    return "permission-denied";
  }
  const supported = new Set<DurableFailureCode>([
    "no-save",
    "invalid-json",
    "invalid-record",
    "checksum-mismatch",
    "invalid-payload",
    "unknown-format",
    "unsupported-save-version",
    "read-failed",
    "disk-full",
    "quota-exceeded",
    "permission-denied",
    "write-failed",
    "storage-unavailable",
    "no-valid-generation",
    "foreign-save",
    "future-save",
    "cyclic-save",
    "import-too-large",
    "import-changed",
    "save-changed",
    "invalid-confirmation",
    "invalid-current-save",
    "invalid-replay",
    "replay-too-large",
    "developer-export-disabled",
    "picker-failed",
    "cancelled",
  ]);
  if (supported.has(code as DurableFailureCode)) {
    return code as DurableFailureCode;
  }
  return operation === "read" || operation === "probe"
    ? "read-failed"
    : "write-failed";
}

function allowSystemCode(value: string | undefined): string | undefined {
  return value &&
    new Set([
      "ENOSPC",
      "EDQUOT",
      "EACCES",
      "EPERM",
      "EROFS",
      "EIO",
      "EBUSY",
    ]).has(value)
    ? value
    : undefined;
}

function allowSystemCodeFromText(value: string): string | undefined {
  return ["ENOSPC", "EDQUOT", "EACCES", "EPERM", "EROFS", "EIO", "EBUSY"].find(
    (code) => value.includes(code),
  );
}

function unavailable<T>(message: string): DurableResult<T> {
  return {
    ok: false,
    error: {
      code: "write-failed",
      operation: "write",
      message,
      retryable: false,
    },
  };
}

function unavailableFor<T>(
  operation: DurableFailure["operation"],
  message: string,
): DurableResult<T> {
  return {
    ok: false,
    error: {
      code: "write-failed",
      operation,
      message,
      retryable: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createFreshSave(
  settings: GameSettings,
  progress: PlayerProgress,
): SaveEnvelopeV1 {
  return createSaveEnvelope(settings, progress);
}

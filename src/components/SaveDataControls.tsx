import { useState } from "react";
import { formatMessage } from "../lib/localeMessages";
import type {
  DurablePersistence,
  ProgressResetPreview,
  SaveImportPreview,
} from "../lib/durablePersistence";

type PendingConfirmation =
  | { kind: "import"; preview: SaveImportPreview }
  | { kind: "reset"; preview: ProgressResetPreview };

interface SaveDataControlsProps {
  persistence: DurablePersistence;
  replay?: Record<string, unknown>;
  onAuthoritativeDataChanged: () => Promise<void> | void;
}

export function SaveDataControls({
  persistence,
  replay,
  onAuthoritativeDataChanged,
}: SaveDataControlsProps) {
  const [busy, setBusy] = useState<string>();
  const [pending, setPending] = useState<PendingConfirmation>();
  const [message, setMessage] = useState(() =>
    formatMessage("saveData.status.default"),
  );
  const [error, setError] = useState<string>();

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await operation();
    } catch {
      setError(formatMessage("saveData.error.generic"));
    } finally {
      setBusy(undefined);
    }
  };

  const exportSave = () =>
    run("export-save", async () => {
      const result = await persistence.exportSave();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(
        result.value.fileName
          ? formatMessage("saveData.export.successNamed", {
              fileName: result.value.fileName,
            })
          : formatMessage("saveData.export.success"),
      );
    });

  const prepareImport = () =>
    run("prepare-import", async () => {
      const result = await persistence.prepareSaveImport();
      if (!result.ok) {
        if (result.error.code !== "cancelled") setError(result.error.message);
        return;
      }
      setPending({ kind: "import", preview: result.value });
    });

  const prepareReset = () =>
    run("prepare-reset", async () => {
      const result = await persistence.prepareProgressReset();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setPending({ kind: "reset", preview: result.value });
    });

  const confirmPending = () => {
    if (!pending) return;
    void run(`confirm-${pending.kind}`, async () => {
      const result =
        pending.kind === "import"
          ? await persistence.confirmSaveImport(
              pending.preview.confirmationToken,
            )
          : await persistence.confirmProgressReset(
              pending.preview.confirmationToken,
            );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const completedKind = pending.kind;
      setPending(undefined);
      await onAuthoritativeDataChanged();
      setMessage(
        formatMessage(
          completedKind === "import" ? "saveData.import.success" : "saveData.reset.success",
        ),
      );
    });
  };

  const exportDiagnostics = () =>
    run("diagnostics", async () => {
      const result = await persistence.exportDiagnostics();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(
        result.value.fileName
          ? formatMessage("saveData.diagnostics.successNamed", {
              fileName: result.value.fileName,
            })
          : formatMessage("saveData.diagnostics.success"),
      );
    });

  const exportReplay = () => {
    if (!replay) return;
    void run("replay", async () => {
      const result = await persistence.exportPublicReplay(replay);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(
        formatMessage("saveData.replay.success", {
          fileName: result.value.fileName,
        }),
      );
    });
  };

  return (
    <div className="night-settings__group save-data-controls">
      <h2>{formatMessage("saveData.heading")}</h2>
      <p>{formatMessage("saveData.intro")}</p>
      <div className="save-data-controls__buttons">
        <button
          type="button"
          disabled={busy !== undefined}
          onClick={() => void exportSave()}
        >
          {formatMessage("shell.action.exportSave")}
        </button>
        <button
          type="button"
          disabled={busy !== undefined}
          onClick={() => void prepareImport()}
        >
          {formatMessage("saveData.button.importSave")}
        </button>
        <button
          type="button"
          disabled={busy !== undefined}
          onClick={() => void exportDiagnostics()}
        >
          {formatMessage("shell.action.exportDiagnostics")}
        </button>
        <button
          type="button"
          disabled={busy !== undefined || !replay}
          title={replay ? undefined : formatMessage("saveData.replay.unavailableTitle")}
          onClick={exportReplay}
        >
          {formatMessage("saveData.button.exportReplay")}
        </button>
        <button
          className="save-data-controls__danger"
          type="button"
          disabled={busy !== undefined}
          onClick={() => void prepareReset()}
        >
          {formatMessage("saveData.button.resetProgress")}
        </button>
      </div>

      {pending ? (
        <section
          className="save-data-controls__confirm"
          aria-labelledby="save-confirm-title"
        >
          <h3 id="save-confirm-title">
            {formatMessage(
              pending.kind === "import"
                ? "saveData.confirm.importTitle"
                : "saveData.confirm.resetTitle",
            )}
          </h3>
          {pending.kind === "import" ? (
            <p>
              {formatMessage("saveData.confirm.importPreview", {
                resultCount: pending.preview.resultCount,
                trainingCompleted: pending.preview.trainingCompleted,
                decisionElo: pending.preview.decisionElo,
                mathElo: pending.preview.mathElo,
                tournamentElo: pending.preview.tournamentElo,
              })}
            </p>
          ) : (
            <p>
              {formatMessage("saveData.confirm.resetPreview", {
                resultCount: pending.preview.resultCount,
                trainingCompleted: pending.preview.trainingCompleted,
              })}
            </p>
          )}
          <div className="save-data-controls__buttons">
            <button
              type="button"
              autoFocus
              disabled={busy !== undefined}
              onClick={confirmPending}
            >
              {formatMessage(
                pending.kind === "import"
                  ? "saveData.confirm.importAction"
                  : "saveData.confirm.resetAction",
              )}
            </button>
            <button
              type="button"
              disabled={busy !== undefined}
              onClick={() => setPending(undefined)}
            >
              {formatMessage("common.cancel")}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="save-data-controls__error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="night-audio-preview-status" role="status" aria-live="polite">
        {busy ? formatMessage("saveData.status.working") : message}
      </p>
    </div>
  );
}

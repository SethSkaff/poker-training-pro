import { useState } from "react";
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
  const [message, setMessage] = useState(
    "Exports are local files. Import and reset always require a preview and confirmation.",
  );
  const [error, setError] = useState<string>();

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await operation();
    } catch {
      setError("The data operation could not be completed.");
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
          ? `Save exported as ${result.value.fileName}.`
          : "Save exported.",
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
        completedKind === "import"
          ? "Imported save validated and loaded."
          : "Player progress reset. Audio and display settings were preserved.",
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
          ? `Redacted diagnostics exported as ${result.value.fileName}.`
          : "Redacted diagnostics exported.",
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
      setMessage(`Public replay exported as ${result.value.fileName}.`);
    });
  };

  return (
    <div className="night-settings__group save-data-controls">
      <h2>Save data & diagnostics</h2>
      <p>
        Desktop progress is stored in a protected local journal. Browser storage
        is never used as the authoritative desktop save.
      </p>
      <div className="save-data-controls__buttons">
        <button
          type="button"
          disabled={busy !== undefined}
          onClick={() => void exportSave()}
        >
          Export save
        </button>
        <button
          type="button"
          disabled={busy !== undefined}
          onClick={() => void prepareImport()}
        >
          Import save…
        </button>
        <button
          type="button"
          disabled={busy !== undefined}
          onClick={() => void exportDiagnostics()}
        >
          Export diagnostics
        </button>
        <button
          type="button"
          disabled={busy !== undefined || !replay}
          title={replay ? undefined : "Complete or start a tournament first."}
          onClick={exportReplay}
        >
          Export public replay
        </button>
        <button
          className="save-data-controls__danger"
          type="button"
          disabled={busy !== undefined}
          onClick={() => void prepareReset()}
        >
          Reset player progress…
        </button>
      </div>

      {pending ? (
        <section
          className="save-data-controls__confirm"
          aria-labelledby="save-confirm-title"
        >
          <h3 id="save-confirm-title">
            {pending.kind === "import"
              ? "Confirm imported save"
              : "Confirm progress reset"}
          </h3>
          {pending.kind === "import" ? (
            <p>
              This valid save contains {pending.preview.resultCount} recorded
              results and {pending.preview.trainingCompleted} completed training
              hands. Ratings: decision {pending.preview.decisionElo}, math{" "}
              {pending.preview.mathElo}, tournament{" "}
              {pending.preview.tournamentElo}. It will replace both settings and
              progress.
            </p>
          ) : (
            <p>
              This will archive the current save, clear{" "}
              {pending.preview.resultCount} recorded results and{" "}
              {pending.preview.trainingCompleted} completed training hands, and
              preserve audio and display settings.
            </p>
          )}
          <div className="save-data-controls__buttons">
            <button
              type="button"
              autoFocus
              disabled={busy !== undefined}
              onClick={confirmPending}
            >
              {pending.kind === "import"
                ? "Import this save"
                : "Archive and reset progress"}
            </button>
            <button
              type="button"
              disabled={busy !== undefined}
              onClick={() => setPending(undefined)}
            >
              Cancel
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
        {busy ? "Working…" : message}
      </p>
    </div>
  );
}

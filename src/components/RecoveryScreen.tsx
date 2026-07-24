import { useState } from "react";
import { formatDateTime } from "../lib/format";
import type {
  DurableResult,
  DurableSaveReceipt,
  RecoveryCandidate,
} from "../lib/durablePersistence";
import styles from "./RecoveryScreen.module.css";

export interface RecoveryScreenActions {
  restore(
    source: "previous" | "last-known-good",
  ): Promise<DurableResult<DurableSaveReceipt>>;
  exportSave(
    source?: "current" | "previous" | "last-known-good",
  ): Promise<DurableResult<{ fileName?: string }>>;
  exportDiagnostics(): Promise<DurableResult<{ fileName?: string }>>;
  startFresh(): Promise<DurableResult<DurableSaveReceipt>>;
  cancel(): void;
}

export interface RecoveryScreenProps {
  message: string;
  recommended?: RecoveryCandidate;
  actions: RecoveryScreenActions;
  onRecovered(receipt: DurableSaveReceipt): void;
}

type BusyAction =
  | "restore"
  | "export-save"
  | "export-diagnostics"
  | "start-fresh";

export function RecoveryScreen({
  message,
  recommended,
  actions,
  onRecovered,
}: RecoveryScreenProps) {
  const [busy, setBusy] = useState<BusyAction>();
  const [error, setError] = useState<string>();
  const [confirmFresh, setConfirmFresh] = useState(false);

  const run = async (
    action: BusyAction,
    operation: () => Promise<
      DurableResult<DurableSaveReceipt | { fileName?: string }>
    >,
  ) => {
    setBusy(action);
    setError(undefined);
    try {
      const result = await operation();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if ("boundary" in result.value) onRecovered(result.value);
    } catch {
      setError("The recovery action could not be completed.");
    } finally {
      setBusy(undefined);
    }
  };

  const recoverySource =
    recommended?.source === "previous" ||
    recommended?.source === "last-known-good"
      ? recommended.source
      : undefined;
  const busyMessage =
    busy === "restore"
      ? "Restoring your protected save…"
      : busy === "export-save"
        ? "Exporting your save…"
        : busy === "export-diagnostics"
          ? "Exporting recovery diagnostics…"
          : busy === "start-fresh"
            ? "Archiving the old save and starting fresh…"
            : "";

  return (
    <main className={styles.shell} aria-labelledby="recovery-title">
      <section className={styles.panel}>
        <p className={styles.eyebrow}>Save recovery</p>
        <h1 id="recovery-title">Your progress is still protected</h1>
        <p className={styles.summary}>{message}</p>

        {recommended ? (
          <dl className={styles.preview} aria-label="Recovery save preview">
            <div>
              <dt>Player</dt>
              <dd>{recommended.save.data.progress.playerName}</dd>
            </div>
            <div>
              <dt>Training complete</dt>
              <dd>{recommended.save.data.progress.trainingCompleted}</dd>
            </div>
            <div>
              <dt>Saved</dt>
              <dd>
                {recommended.savedAt
                  ? formatDateTime(recommended.savedAt)
                  : "Recovery copy"}
              </dd>
            </div>
          </dl>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions} aria-busy={busy !== undefined}>
          {recoverySource ? (
            <button
              className={styles.primary}
              type="button"
              disabled={busy !== undefined}
              onClick={() =>
                void run("restore", () => actions.restore(recoverySource))
              }
            >
              Restore{" "}
              {recoverySource === "previous"
                ? "previous save"
                : "last-known-good save"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy !== undefined}
            onClick={() =>
              void run("export-save", () =>
                actions.exportSave(recoverySource),
              )
            }
          >
            Export save
          </button>
          <button
            type="button"
            disabled={busy !== undefined}
            onClick={() =>
              void run("export-diagnostics", actions.exportDiagnostics)
            }
          >
            Export diagnostics
          </button>
          <button
            className={styles.danger}
            type="button"
            disabled={busy !== undefined}
            aria-expanded={confirmFresh}
            aria-controls="start-fresh-confirmation"
            onClick={() => setConfirmFresh(true)}
          >
            Start fresh
          </button>
          <div
            id="start-fresh-confirmation"
            className={styles.confirm}
            role="group"
            aria-labelledby="start-fresh-confirmation-label"
            hidden={!confirmFresh}
          >
            <p id="start-fresh-confirmation-label">
              Starting fresh archives existing save files before creating a new
              profile. Nothing is discarded silently. Continue?
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                disabled={busy !== undefined}
                onClick={() => {
                  setConfirmFresh(false);
                  void run("start-fresh", actions.startFresh);
                }}
              >
                Archive and start fresh
              </button>
              <button
                type="button"
                disabled={busy !== undefined}
                onClick={() => setConfirmFresh(false)}
              >
                Keep my progress
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={busy !== undefined}
            onClick={actions.cancel}
          >
            Cancel without changes
          </button>
        </div>

        <p
          className={styles.busyStatus}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {busyMessage}
        </p>
      </section>
    </main>
  );
}

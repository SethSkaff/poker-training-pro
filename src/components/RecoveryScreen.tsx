import { useState } from "react";
import { formatDateTime } from "../lib/format";
import { formatMessage } from "../lib/localeMessages";
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
      setError(formatMessage("recovery.error.generic"));
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
      ? formatMessage("recovery.busy.restore")
      : busy === "export-save"
        ? formatMessage("recovery.busy.exportSave")
        : busy === "export-diagnostics"
          ? formatMessage("recovery.busy.exportDiagnostics")
          : busy === "start-fresh"
            ? formatMessage("recovery.busy.startFresh")
            : "";

  return (
    <main className={styles.shell} aria-labelledby="recovery-title">
      <section className={styles.panel}>
        <p className={styles.eyebrow}>{formatMessage("recovery.eyebrow")}</p>
        <h1 id="recovery-title">{formatMessage("recovery.title")}</h1>
        <p className={styles.summary}>{message}</p>

        {recommended ? (
          <dl
            className={styles.preview}
            aria-label={formatMessage("recovery.preview.ariaLabel")}
          >
            <div>
              <dt>{formatMessage("recovery.preview.playerLabel")}</dt>
              <dd>{recommended.save.data.progress.playerName}</dd>
            </div>
            <div>
              <dt>{formatMessage("recovery.preview.trainingCompletedLabel")}</dt>
              <dd>{recommended.save.data.progress.trainingCompleted}</dd>
            </div>
            <div>
              <dt>{formatMessage("recovery.preview.savedLabel")}</dt>
              <dd>
                {recommended.savedAt
                  ? formatDateTime(recommended.savedAt)
                  : formatMessage("recovery.preview.savedFallback")}
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
              {formatMessage(
                recoverySource === "previous"
                  ? "recovery.action.restorePrevious"
                  : "recovery.action.restoreLastKnownGood",
              )}
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
            {formatMessage("shell.action.exportSave")}
          </button>
          <button
            type="button"
            disabled={busy !== undefined}
            onClick={() =>
              void run("export-diagnostics", actions.exportDiagnostics)
            }
          >
            {formatMessage("shell.action.exportDiagnostics")}
          </button>
          <button
            className={styles.danger}
            type="button"
            disabled={busy !== undefined}
            aria-expanded={confirmFresh}
            aria-controls="start-fresh-confirmation"
            onClick={() => setConfirmFresh(true)}
          >
            {formatMessage("recovery.action.startFresh")}
          </button>
          <div
            id="start-fresh-confirmation"
            className={styles.confirm}
            role="group"
            aria-labelledby="start-fresh-confirmation-label"
            hidden={!confirmFresh}
          >
            <p id="start-fresh-confirmation-label">
              {formatMessage("recovery.confirm.startFreshLabel")}
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
                {formatMessage("recovery.confirm.startFreshAction")}
              </button>
              <button
                type="button"
                disabled={busy !== undefined}
                onClick={() => setConfirmFresh(false)}
              >
                {formatMessage("recovery.confirm.keepProgress")}
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={busy !== undefined}
            onClick={actions.cancel}
          >
            {formatMessage("recovery.action.cancelWithoutChanges")}
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

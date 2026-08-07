/**
 * Read-only renderer diagnostics exposed for the isolated packaged audit.
 *
 * The bridge deliberately exposes a snapshot function only: CDP can observe
 * the scene's public performance/lifecycle state but cannot drive the table,
 * mutate renderer state, or read poker data.
 */
export interface SceneDiagnosticsBridge<TSnapshot extends object = object> {
  snapshot(): Readonly<TSnapshot>;
}

export interface SceneDiagnosticsHost {
  __ptpSceneDiagnostics?: SceneDiagnosticsBridge;
}

export interface SceneFrameTelemetrySnapshot {
  readonly frameCount: number;
  readonly firstFrameMs: number | null;
  readonly frameP50Ms: number | null;
  readonly frameP95Ms: number | null;
}

export interface SceneFrameTelemetry {
  record(timestamp: number, renderDurationMs: number): void;
  snapshot(): SceneFrameTelemetrySnapshot;
}

/** A bounded render-time sampler; it never schedules or controls frames. */
export function createSceneFrameTelemetry(
  startedAt: number,
  maxIntervals = 120,
): SceneFrameTelemetry {
  const renderDurations: number[] = [];
  let frames = 0;
  let firstFrameMs: number | null = null;
  const percentile = (fraction: number): number | null => {
    if (renderDurations.length === 0) return null;
    const ordered = [...renderDurations].sort((left, right) => left - right);
    return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? null;
  };
  return {
    record(timestamp, renderDurationMs): void {
      if (!Number.isFinite(timestamp) || !Number.isFinite(renderDurationMs) || renderDurationMs < 0) return;
      frames += 1;
      if (firstFrameMs === null) firstFrameMs = Math.max(0, timestamp - startedAt);
      // First-frame compilation is recorded separately above. Excluding that
      // single cold sample keeps the steady-state p50/p95 budget meaningful.
      if (frames === 1) return;
      renderDurations.push(renderDurationMs);
      if (renderDurations.length > maxIntervals) renderDurations.shift();
    },
    snapshot: () => ({
      frameCount: frames,
      firstFrameMs,
      frameP50Ms: percentile(0.5),
      frameP95Ms: percentile(0.95),
    }),
  };
}

export function installSceneDiagnosticsBridge<TSnapshot extends object>(
  host: SceneDiagnosticsHost,
  readSnapshot: () => TSnapshot,
): () => void {
  const bridge: SceneDiagnosticsBridge<TSnapshot> = Object.freeze({
    snapshot: () => Object.freeze({ ...readSnapshot() }),
  });
  host.__ptpSceneDiagnostics = bridge;
  return () => {
    // React effects can overlap during a replacement mount. An old host must
    // never erase a newer scene's diagnostics while the latter is auditable.
    if (host.__ptpSceneDiagnostics === bridge) {
      delete host.__ptpSceneDiagnostics;
    }
  };
}

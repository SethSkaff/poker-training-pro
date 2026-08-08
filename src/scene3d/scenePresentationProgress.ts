/** Minimal public shape of the existing presentation delay consumed by the scene. */
export interface ScenePresentationDelay {
  readonly remaining: number;
  readonly isPending: boolean;
  readonly isFrozen: boolean;
}

export interface SceneProgressFrameHost {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface SceneProgressCursor {
  eventId: string | null;
  progress: number;
}

/**
 * Keep one public presentation event moving forward even if React or the
 * renderer briefly exposes an older delay sample. A new event may begin at
 * zero; an existing event must never move its physical choreography backward.
 */
export function monotonicScenePresentationProgress(
  cursor: SceneProgressCursor,
  eventId: string,
  progress: number,
): number {
  const bounded = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 1;
  if (cursor.eventId !== eventId) {
    cursor.eventId = eventId;
    cursor.progress = bounded;
    return bounded;
  }
  cursor.progress = Math.max(cursor.progress, bounded);
  return cursor.progress;
}

/**
 * Samples, but never controls, the authoritative presentation delay. Keeping
 * this bridge independent from React makes pause/resume semantics testable
 * without giving the renderer any way to complete or advance the runner.
 */
export function scenePresentationProgress(
  delay: ScenePresentationDelay,
  durationMs: number,
): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - delay.remaining / durationMs));
}

/** Start rAF sampling until the delay completes or freezes; returns a teardown. */
export function sampleScenePresentationProgress(
  delay: ScenePresentationDelay,
  durationMs: number,
  onProgress: (progress: number) => void,
  frames: SceneProgressFrameHost,
): () => void {
  let frame = 0;
  let stopped = false;
  const sample = () => {
    if (stopped) return;
    onProgress(scenePresentationProgress(delay, durationMs));
    if (delay.isPending && !delay.isFrozen) frame = frames.request(sample);
  };
  frame = frames.request(sample);
  return () => {
    stopped = true;
    frames.cancel(frame);
  };
}

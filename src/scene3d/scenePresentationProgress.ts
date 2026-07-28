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

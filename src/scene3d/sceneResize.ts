export interface SceneResizeObserver<TTarget> {
  observe(target: TTarget): void;
  disconnect(): void;
}

/** Small injectable seam so resize ownership has deterministic tests. */
export function observeSceneResize<TTarget>(
  target: TTarget,
  resize: () => void,
  createObserver: (callback: () => void) => SceneResizeObserver<TTarget> | null,
): () => void {
  resize();
  const observer = createObserver(resize);
  observer?.observe(target);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
  };
}

/**
 * Visibility-aware scheduling helpers. These let expensive rendering and
 * simulation work stop while the document is hidden/minimized and resume
 * cleanly, without leaking timers, frame callbacks, or event listeners across a
 * long session.
 *
 * Everything is dependency-injected so the behavior is unit-testable without a
 * real DOM, and so it is safe to import in the desktop/Vitest bundles.
 */

export interface VisibilityDocumentLike {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

function resolveDocument(
  doc?: VisibilityDocumentLike,
): VisibilityDocumentLike | null {
  if (doc) return doc;
  if (typeof document !== "undefined") {
    return document as unknown as VisibilityDocumentLike;
  }
  return null;
}

export interface VisibilityGate {
  isHidden(): boolean;
  /**
   * Resolves immediately when the document is visible; otherwise resolves the
   * next time it becomes visible. Used to defer a simulation slice while hidden
   * without dropping or duplicating deterministic work.
   */
  whenVisible(): Promise<void>;
  dispose(): void;
}

export function createVisibilityGate(
  doc?: VisibilityDocumentLike,
): VisibilityGate {
  const target = resolveDocument(doc);
  const waiters = new Set<() => void>();
  let disposed = false;

  const onVisibilityChange = (): void => {
    if (target?.hidden) return;
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  };
  target?.addEventListener("visibilitychange", onVisibilityChange);

  return {
    isHidden(): boolean {
      return target?.hidden ?? false;
    },
    whenVisible(): Promise<void> {
      if (disposed || !target || !target.hidden) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.add(resolve));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      target?.removeEventListener("visibilitychange", onVisibilityChange);
      // Release any pending waiters so awaiting callers do not hang forever.
      for (const resolve of [...waiters]) resolve();
      waiters.clear();
    },
  };
}

export interface AnimationLoopHost {
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(handle: number): void;
  doc?: VisibilityDocumentLike;
}

export interface AnimationLoopHandle {
  stop(): void;
  /** True while a frame is currently scheduled. */
  isRunning(): boolean;
}

function resolveAnimationHost(host?: Partial<AnimationLoopHost>): AnimationLoopHost {
  return {
    requestFrame:
      host?.requestFrame ??
      ((callback) => window.requestAnimationFrame(callback)),
    cancelFrame:
      host?.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle)),
    ...(host?.doc ? { doc: host.doc } : {}),
  };
}

/**
 * Runs `step` on each animation frame, but only while the document is visible.
 * When the document becomes hidden the pending frame is cancelled so no
 * rendering/animation work is scheduled; it resumes on the next visible frame.
 * `stop()` fully tears down the frame callback and the visibility listener.
 */
export function createVisibilityAwareAnimationLoop(
  step: (timestamp: number) => void,
  host?: Partial<AnimationLoopHost>,
): AnimationLoopHandle {
  const resolved = resolveAnimationHost(host);
  const target = resolveDocument(resolved.doc);
  let frame: number | null = null;
  let stopped = false;

  const schedule = (): void => {
    if (stopped || frame !== null) return;
    if (target?.hidden) return;
    frame = resolved.requestFrame((timestamp) => {
      frame = null;
      if (stopped || target?.hidden) return;
      step(timestamp);
      schedule();
    });
  };

  const cancelPending = (): void => {
    if (frame !== null) {
      resolved.cancelFrame(frame);
      frame = null;
    }
  };

  const onVisibilityChange = (): void => {
    if (stopped) return;
    if (target?.hidden) cancelPending();
    else schedule();
  };
  target?.addEventListener("visibilitychange", onVisibilityChange);

  schedule();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      cancelPending();
      target?.removeEventListener("visibilitychange", onVisibilityChange);
    },
    isRunning(): boolean {
      return frame !== null;
    },
  };
}

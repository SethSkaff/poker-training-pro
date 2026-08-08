/**
 * Availability is separate from the setting that requests the scene. A
 * requested renderer is not usable until it has drawn the target canvas.
 */
export type SceneAvailabilityStatus =
  | "idle"
  | "probing"
  | "loading"
  | "ready"
  | "failed"
  | "lost"
  | "disposed";

export type SceneFailureReason =
  | "unsupported"
  | "blocked"
  | "constructor-failed"
  | "first-frame-failed";

export interface SceneAvailability {
  readonly status: SceneAvailabilityStatus;
  readonly reason?: SceneFailureReason;
}

export const initialSceneAvailability: SceneAvailability = { status: "idle" };

export type SceneAvailabilityEvent =
  | { readonly type: "begin" }
  | { readonly type: "probe-passed" }
  | { readonly type: "failed"; readonly reason: SceneFailureReason }
  | { readonly type: "first-frame" }
  | { readonly type: "context-lost" }
  | { readonly type: "dispose" };

/** A total transition function so stale callbacks cannot revive a scene. */
export function transitionSceneAvailability(
  current: SceneAvailability,
  event: SceneAvailabilityEvent,
): SceneAvailability {
  switch (event.type) {
    case "begin":
      return { status: "probing" };
    case "probe-passed":
      return current.status === "probing" ? { status: "loading" } : current;
    case "first-frame":
      return current.status === "loading" ? { status: "ready" } : current;
    case "failed":
      return current.status === "disposed"
        ? current
        : { status: "failed", reason: event.reason };
    case "context-lost":
      return current.status === "disposed" ? current : { status: "lost" };
    case "dispose":
      return { status: "disposed" };
  }
}

export type WebGlProbeResult = "available" | "unsupported" | "blocked";

export interface SceneFrameCallbacks {
  readonly onFirstFrame: () => void;
  readonly onFrameFailure: () => void;
  readonly onCameraFrame?: (pose: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly yaw: number;
    readonly fov: number;
  }) => void;
  /** Start without drawing or scheduling a frame while the table is paused. */
  readonly startSuspended?: boolean;
}

export interface DisposableScene {
  dispose(): void;
}

/**
 * Production ownership seam for one renderer attempt. It makes context loss
 * and first-frame errors terminal, and disposal is idempotent.
 */
export interface SceneAttemptOptions<TCanvas, TState, TScene extends DisposableScene> {
  readonly canvas: TCanvas;
  readonly state: TState;
  readonly probe: (canvas: TCanvas) => WebGlProbeResult;
  readonly create: (
    canvas: TCanvas,
    state: TState,
    callbacks: SceneFrameCallbacks,
  ) => TScene;
  readonly startSuspended?: boolean;
  readonly onAvailability: (availability: SceneAvailability) => void;
}

export interface SceneAttempt {
  dispose(): void;
  contextLost(): void;
}

export function startSceneAttempt<TCanvas, TState, TScene extends DisposableScene>(
  options: SceneAttemptOptions<TCanvas, TState, TScene>,
): SceneAttempt {
  let availability = initialSceneAvailability;
  let scene: TScene | null = null;
  let active = true;
  let disposed = false;

  const report = (event: SceneAvailabilityEvent) => {
    const next = transitionSceneAvailability(availability, event);
    if (next === availability) return;
    availability = next;
    options.onAvailability(next);
  };
  const disposeScene = () => {
    if (!scene || disposed) return;
    disposed = true;
    scene.dispose();
  };
  const fail = (reason: SceneFailureReason) => {
    if (!active) return;
    active = false;
    report({ type: "failed", reason });
    disposeScene();
  };

  report({ type: "begin" });
  let probeResult: WebGlProbeResult | null = null;
  try {
    probeResult = options.probe(options.canvas);
  } catch {
    fail("blocked");
  }
  if (active && probeResult !== "available") {
    fail(probeResult === "unsupported" ? "unsupported" : "blocked");
  }
  if (active) {
    report({ type: "probe-passed" });
    try {
      const created = options.create(options.canvas, options.state, {
        onFirstFrame: () => {
          if (active) report({ type: "first-frame" });
        },
        onFrameFailure: () => fail("first-frame-failed"),
        startSuspended: options.startSuspended,
      });
      scene = created;
      if (!active) disposeScene();
    } catch {
      fail("constructor-failed");
    }
  }

  return {
    contextLost() {
      if (!active) return;
      active = false;
      report({ type: "context-lost" });
      disposeScene();
    },
    dispose() {
      if (!active && disposed) return;
      active = false;
      disposeScene();
      report({ type: "dispose" });
    },
  };
}

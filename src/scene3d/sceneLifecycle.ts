import {
  createVisibilityAwareAnimationLoop,
  type AnimationLoopHost,
  type VisibilityDocumentLike,
} from "../lib/visibilityWorkGate";

export interface SceneLifecycleHost extends Partial<AnimationLoopHost> {
  readonly now?: () => number;
}

export interface SceneRenderLifecycleState {
  readonly suspended: boolean;
  readonly reducedMotion: boolean;
  readonly needsAnimation: boolean;
}

export interface SceneRenderLifecycle {
  update(state: SceneRenderLifecycleState): void;
  dispose(): void;
  readonly isRunning: () => boolean;
}

function defaultNow(): number {
  return typeof performance === "undefined" ? 0 : performance.now();
}

/**
 * Owns only render scheduling. It deliberately knows nothing about poker or
 * three.js so its zero-frame pause/visibility rules can be proved with a fake
 * scheduler. The caller requests continuous frames only while a public scene
 * transition is moving; all static and reduced-motion updates render once.
 */
export function createSceneRenderLifecycle(
  draw: (timestamp: number) => void,
  host: SceneLifecycleHost = {},
): SceneRenderLifecycle {
  const animationHost: Partial<AnimationLoopHost> = {
    ...(host.requestFrame ? { requestFrame: host.requestFrame } : {}),
    ...(host.cancelFrame ? { cancelFrame: host.cancelFrame } : {}),
    ...(host.doc ? { doc: host.doc as VisibilityDocumentLike } : {}),
  };
  const now = host.now ?? defaultNow;
  let latest: SceneRenderLifecycleState = {
    suspended: true,
    reducedMotion: true,
    needsAnimation: false,
  };
  let loop: ReturnType<typeof createVisibilityAwareAnimationLoop> | null = null;
  let disposed = false;

  const stop = () => {
    loop?.stop();
    loop = null;
  };
  const shouldAnimate = () => !latest.suspended && !latest.reducedMotion && latest.needsAnimation;
  const ensureLoop = () => {
    if (disposed || !shouldAnimate() || loop) return;
    loop = createVisibilityAwareAnimationLoop((timestamp) => {
      if (shouldAnimate()) draw(timestamp);
    }, animationHost);
  };

  return {
    update(next) {
      if (disposed) return;
      const wasAnimating = shouldAnimate();
      latest = next;
      if (wasAnimating && !shouldAnimate()) stop();
      if (shouldAnimate()) {
        ensureLoop();
        return;
      }
      if (!next.suspended) draw(now());
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
    },
    isRunning: () => loop?.isRunning() ?? false,
  };
}

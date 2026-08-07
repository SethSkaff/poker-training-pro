export interface RecoverableSceneAttempt {
  contextLost(): void;
  dispose(): void;
}

export interface SceneRecoverySessionOptions<TState, TAttempt extends RecoverableSceneAttempt> {
  readonly latestState: () => TState;
  readonly create: (state: TState) => TAttempt;
  /** False when the current attempt failed for a reason a restored context cannot repair. */
  readonly canRecover: () => boolean;
}

export interface SceneRecoverySession {
  contextLost(): boolean;
  contextRestored(): void;
  dispose(): void;
}

/**
 * Coordinates browser context events without retaining a scene snapshot. On a
 * restored WebGL context it constructs a fresh renderer from the caller's
 * latest immutable public state; if recovery is unavailable the DOM fallback
 * is already active and the browser receives its default context-loss path.
 */
export function createSceneRecoverySession<TState, TAttempt extends RecoverableSceneAttempt>(
  options: SceneRecoverySessionOptions<TState, TAttempt>,
): SceneRecoverySession {
  let attempt: TAttempt | null = options.create(options.latestState());
  let waitingForRestore = false;
  let disposed = false;

  return {
    contextLost(): boolean {
      if (disposed || waitingForRestore || !attempt || !options.canRecover()) return false;
      waitingForRestore = true;
      attempt.contextLost();
      return true;
    },
    contextRestored(): void {
      if (disposed || !waitingForRestore || !options.canRecover()) return;
      waitingForRestore = false;
      attempt = options.create(options.latestState());
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      attempt?.dispose();
      attempt = null;
    },
  };
}

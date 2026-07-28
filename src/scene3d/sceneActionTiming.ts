import type { SeatActionKind } from "./tableSceneModel";
import type { SceneTransition } from "./sceneTransition";

/** Public seat data needed to reconcile renderer-local action timestamps. */
export interface TimedSceneSeat {
  readonly id: string;
  readonly seat: number;
  readonly folded: boolean;
  readonly action?: SeatActionKind;
}

/**
 * Renderer-local bookkeeping only. The presentation queue remains the source
 * of truth for event identity and progress; these timestamps merely preserve
 * the legacy local fallback for states without a queue action.
 */
export interface SceneActionTimingState {
  readonly startedAt: Map<number, number>;
  readonly lastAction: Map<number, SeatActionKind | undefined>;
  lastTransitionId?: string;
}

export function createSceneActionTimingState(): SceneActionTimingState {
  return { startedAt: new Map(), lastAction: new Map() };
}

/**
 * Consume each public queue id once. A repeated action kind is still a new
 * action when its event id changes. Conversely, committing a skipped fold
 * stamps its terminal state so a renderer-local fallback cannot replay it.
 */
export function reconcileSceneActionTiming(
  timing: SceneActionTimingState,
  previousSeats: readonly TimedSceneSeat[],
  nextSeats: readonly TimedSceneSeat[],
  transition: SceneTransition | undefined,
  nowMs: number,
  actionDurationMs: number,
): void {
  if (transition?.id !== timing.lastTransitionId) {
    timing.lastTransitionId = transition?.id;
    if (transition?.action) {
      for (const seat of nextSeats) {
        if (transition.playerIds.includes(seat.id)) timing.startedAt.set(seat.seat, nowMs);
      }
    }
  }

  const previousById = new Map(previousSeats.map((seat) => [seat.id, seat]));
  for (const seat of nextSeats) {
    const previous = previousById.get(seat.id);
    const committedFold = seat.folded && !seat.action && previous?.action === "fold";
    if (committedFold) {
      timing.lastAction.set(seat.seat, undefined);
      timing.startedAt.set(seat.seat, nowMs - actionDurationMs);
      continue;
    }
    if (timing.lastAction.get(seat.seat) !== seat.action) {
      timing.lastAction.set(seat.seat, seat.action);
      timing.startedAt.set(seat.seat, nowMs);
    }
  }
}

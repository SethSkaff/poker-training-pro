/**
 * The rules governing how the hero's own cards present a fold (E27-001).
 *
 * These were three inline expressions in `PokerTable`, entangled with each
 * other through a single `foldProgress` number that meant two different things
 * depending on which code path wrote it. The drag gesture wrote it as "how far
 * the player has pulled", and the fold *button* wrote 100 to it as "play the
 * slide-away animation". Because the release banner keyed off that number, a
 * button fold raised a drag affordance the moment the engine cleared the
 * submitted action -- and kept it up through the showdown and into the next
 * hand.
 *
 * Extracted so the invariants are assertable without a compositor: the bug was
 * a state-machine bug, and a state machine can be tested directly.
 */

/** A submitted hero action awaiting engine acknowledgement, if any. */
export type SubmittedAction = string | null | undefined;

/** Seat status as the engine reports it for the hero's seat. */
export type HeroSeatStatus =
  | "active"
  | "folded"
  | "all-in"
  | "out"
  | undefined;

export interface HeroFoldState {
  /** True only while a pointer gesture is actually in progress. */
  readonly dragging: boolean;
  /** How far the current gesture has pulled, 0-100. Meaningless when idle. */
  readonly foldProgress: number;
  /** The action the hero has submitted but the engine has not yet reflected. */
  readonly action: SubmittedAction;
  /** Authoritative seat status from the engine. */
  readonly seatStatus: HeroSeatStatus;
}

/** The pull-to-fold threshold, shared by the affordance and the commit. */
export const FOLD_COMMIT_THRESHOLD = 82;
const FOLD_AFFORDANCE_THRESHOLD = 10;

/**
 * Whether to show the "keep dragging / release to fold" affordance.
 *
 * Requires an active drag. A fold arriving by button, keyboard, or controller
 * is not a gesture and must never raise gesture UI, however far any leftover
 * progress value happens to sit.
 */
export function shouldShowFoldRelease(state: HeroFoldState): boolean {
  if (!state.dragging) return false;
  if (state.action) return false;
  return state.foldProgress > FOLD_AFFORDANCE_THRESHOLD;
}

/** Whether the affordance has passed the point where releasing commits. */
export function isFoldReleaseArmed(state: HeroFoldState): boolean {
  return (
    shouldShowFoldRelease(state) && state.foldProgress >= FOLD_COMMIT_THRESHOLD
  );
}

/**
 * Whether the hero's cards are mucked.
 *
 * Reads the engine's seat status, which lives exactly as long as the hand, and
 * ORs in the just-submitted action so the muck starts on the submitting frame
 * instead of waiting a round trip. Deriving this from the submitted action
 * *alone* was the second half of the regression: that value is cleared by the
 * next engine update, so folded cards returned face-up and interactive.
 */
export function areHeroCardsMucked(state: HeroFoldState): boolean {
  return state.seatStatus === "folded" || state.action === "fold";
}

/** Whether a new pointer gesture may begin on the hero's cards. */
export function canStartHeroGesture(state: HeroFoldState): boolean {
  return !state.action && !areHeroCardsMucked(state);
}

/**
 * How far the cards sit from their resting position, in progress units (0-100).
 *
 * Once folded the cards rest at the commit threshold no matter how the fold was
 * submitted, so a button fold and a dragged fold settle identically.
 */
export function foldOffsetProgress(state: HeroFoldState): number {
  if (areHeroCardsMucked(state)) return FOLD_COMMIT_THRESHOLD;
  if (!state.dragging) return 0;
  return Math.min(Math.max(state.foldProgress, 0), FOLD_COMMIT_THRESHOLD);
}

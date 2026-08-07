/**
 * Playback navigation for Game Review (E27-011).
 *
 * "Noteworthy" shipped as a **filter**: selecting it removed every ordinary
 * decision from the timeline, so a player could no longer see the shape of
 * their own round -- only the moments the system had judged interesting, with
 * the hands between them deleted. Chronology disappeared with them.
 *
 * It is navigation, not a dataset. The full timeline always stays; the mode
 * only changes what happens when playback runs. Play All walks every decision
 * in order. Play Noteworthy walks the same list but does not dwell on routine
 * decisions, stopping at each noteworthy one so the player can look at it and
 * then continue. Either way, every decision remains directly selectable.
 */

export type ReviewPlaybackMode = "all" | "noteworthy";

export interface PlaybackDecision {
  readonly index: number;
  readonly notable: boolean;
}

export interface PlaybackStep {
  /** The decision to show next, or null when the round is finished. */
  readonly index: number | null;
  /**
   * Whether playback should stop here and wait for the player.
   *
   * In noteworthy mode a notable decision is a stop: it is the reason the mode
   * exists. In all mode nothing stops until the end.
   */
  readonly pause: boolean;
  /** True when there is nothing further to play. */
  readonly finished: boolean;
}

/**
 * The next decision playback should move to.
 *
 * `current` is the index currently shown, or null before playback starts.
 * Decisions are expected in timeline order; the function does not sort them,
 * because a review whose order came from anywhere but the hand's own order
 * would be lying about chronology.
 */
export function nextPlaybackStep(
  decisions: readonly PlaybackDecision[],
  current: number | null,
  mode: ReviewPlaybackMode,
): PlaybackStep {
  if (decisions.length === 0) {
    return { index: null, pause: false, finished: true };
  }

  const position =
    current === null
      ? -1
      : decisions.findIndex((decision) => decision.index === current);
  const remaining = decisions.slice(position + 1);
  if (remaining.length === 0) {
    return { index: null, pause: false, finished: true };
  }

  if (mode === "all") {
    // Every decision in order; the round itself is the only stopping point.
    const next = remaining[0];
    return {
      index: next.index,
      pause: false,
      finished: remaining.length === 1,
    };
  }

  /*
    Noteworthy: move to the next notable decision. Routine decisions between
    here and there are skipped over rather than removed -- they are still in
    the timeline, still selectable, and still counted. If none remain, land on
    the last decision so playback ends where the round ended rather than
    stopping in the middle of it.
  */
  const nextNotable = remaining.find((decision) => decision.notable);
  if (!nextNotable) {
    const last = remaining[remaining.length - 1];
    return { index: last.index, pause: false, finished: true };
  }
  const isLastNotable = !remaining
    .slice(remaining.indexOf(nextNotable) + 1)
    .some((decision) => decision.notable);
  return { index: nextNotable.index, pause: true, finished: isLastNotable };
}

/**
 * How many decisions a noteworthy run will stop at.
 *
 * Shown next to the control so the player knows what they are starting: "3
 * noteworthy" is a different offer from "27 noteworthy", and the old filter
 * gave no such warning before rearranging the screen.
 */
export function countNotable(
  decisions: readonly PlaybackDecision[],
): number {
  return decisions.filter((decision) => decision.notable).length;
}

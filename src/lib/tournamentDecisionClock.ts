/**
 * The wall-clock feed for the tournament blind schedule (E27-004).
 *
 * The blind level advances by however many milliseconds the table reports when
 * the hero acts. The table used to report `elapsedMs` -- a timer that starts at
 * the beginning of a hand and is only reset when a new hand begins -- so every
 * hero action in a hand submitted the whole cumulative total again. Hero
 * decisions at 60s, 120s and 180s advanced the blind clock by 360s rather than
 * 180s, and at the local qualifier's four-minute levels that is enough to raise
 * the blinds inside the first hand.
 *
 * This counts each millisecond exactly once by draining: every read returns the
 * time since the previous read and re-anchors. Paused time is excluded, because
 * a player who opened the pause menu has not spent tournament time.
 *
 * The clock source is injected so the behaviour is testable without waiting.
 */
export interface TournamentDecisionClock {
  /** Stop accruing time. Idempotent. */
  pause(): void;
  /** Resume accruing. Time spent paused is discarded, not backfilled. */
  resume(): void;
  /**
   * Milliseconds since the previous drain, excluding paused time, then
   * re-anchor. Never negative, and never larger than `maximumAdvanceMs`.
   */
  drain(): number;
  /** Discard everything accrued so far without reporting it. */
  reset(): void;
}

export interface TournamentDecisionClockOptions {
  /** Monotonic time source, in milliseconds. */
  readonly now: () => number;
  /**
   * Ceiling on a single drain. A suspended or sleeping machine can return an
   * enormous delta on wake, and blinds must not jump several levels because a
   * laptop lid was shut. The lifecycle audit proves play freezes while the
   * window is hidden, so a gap this large is a machine state, not play.
   */
  readonly maximumAdvanceMs?: number;
}

const DEFAULT_MAXIMUM_ADVANCE_MS = 5 * 60_000;

export function createTournamentDecisionClock({
  now,
  maximumAdvanceMs = DEFAULT_MAXIMUM_ADVANCE_MS,
}: TournamentDecisionClockOptions): TournamentDecisionClock {
  let anchor = now();
  let pausedAt: number | null = null;

  const currentMark = () => (pausedAt === null ? now() : pausedAt);

  return {
    pause() {
      if (pausedAt === null) pausedAt = now();
    },
    resume() {
      if (pausedAt === null) return;
      // Move the anchor forward by the paused interval so it is never reported.
      anchor += now() - pausedAt;
      pausedAt = null;
    },
    drain() {
      const mark = currentMark();
      const elapsed = Math.max(0, mark - anchor);
      anchor = mark;
      return Math.min(Math.round(elapsed), maximumAdvanceMs);
    },
    reset() {
      anchor = currentMark();
    },
  };
}

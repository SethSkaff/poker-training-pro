/** Public presentation policy for an all-in runout.
 *
 * This deliberately accepts only public betting data.  In particular, it must
 * never be used as a reason to inspect a player's private cards.
 */
export interface AllInPresentationPlayer {
  readonly status: "active" | "folded" | "all-in" | "out";
  readonly totalCommitted: number;
}

/** A two-way-or-more, single-pot all-in is the only early-card reveal. */
export function isUncontestedAllInRunout(
  players: readonly AllInPresentationPlayer[],
): boolean {
  const activePlayersInHand = players.filter(
    (player) => player.status !== "folded" && player.status !== "out",
  );
  if (
    activePlayersInHand.length < 2 ||
    !activePlayersInHand.every((player) => player.status === "all-in")
  ) {
    return false;
  }

  // Different live all-in caps mean there is an unmatched layer (a side pot or
  // refund) and this focused heads-up presentation would be misleading.
  return new Set(activePlayersInHand.map((player) => player.totalCommitted)).size === 1;
}

export const ALL_IN_EQUITY_TRANSITION_MS = 250;

/** Samples the short, legible count-up used after each public board card. */
export function interpolateAllInEquities(
  start: ReadonlyMap<string, number>,
  target: readonly { readonly playerId: string; readonly equity: number }[],
  elapsedMs: number,
  durationMs = ALL_IN_EQUITY_TRANSITION_MS,
): ReadonlyMap<string, number> {
  const progress = Math.max(0, Math.min(1, elapsedMs / Math.max(1, durationMs)));
  // Ease out makes the first few values visibly tick while landing cleanly.
  const eased = 1 - (1 - progress) ** 2;
  return new Map(target.map(({ playerId, equity }) => [
    playerId,
    (start.get(playerId) ?? 0) + (equity - (start.get(playerId) ?? 0)) * eased,
  ]));
}

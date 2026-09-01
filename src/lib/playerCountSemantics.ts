/**
 * Counts used by poker evaluation and tournament presentation.
 *
 * These values intentionally have different owners. `tournamentPlayersRemaining`
 * comes from the tournament roster; every other count comes from the current
 * hand information set. A caller must provide the tournament count explicitly
 * rather than deriving it from the hand, because a table can be heads-up while
 * players on other tables are still alive.
 */
export interface PlayerCountSemantics {
  /** Players still alive in the tournament/game, across all tables. */
  tournamentPlayersRemaining: number;
  /** Players who were dealt into the current hand. */
  playersDealtIn: number;
  /** Players not folded at this decision point, including an active hero. */
  activePlayersInHand: number;
  /** Active current-hand players other than the viewer/hero. */
  activeOpponents: number;
}

export interface HandCountPlayer {
  id: string;
  status: string;
}

export interface RespondingOpponent extends HandCountPlayer {
  stack: number;
  streetCommitted: number;
}

const ACTIVE_HAND_STATUSES = new Set(["active", "all-in"]);

/** True for a player who has not folded or left the current hand. */
export function isActiveInHand(player: Pick<HandCountPlayer, "status">): boolean {
  return ACTIVE_HAND_STATUSES.has(player.status);
}

/**
 * Derives all hand-local counts in one place. The roster count is not derived
 * here by design; it is an independent tournament fact supplied by the
 * tournament/session owner.
 */
export function derivePlayerCountSemantics(
  players: readonly HandCountPlayer[],
  heroId: string,
  tournamentPlayersRemaining: number,
): PlayerCountSemantics {
  if (!Number.isSafeInteger(tournamentPlayersRemaining) || tournamentPlayersRemaining < 0) {
    throw new Error("Tournament player count must be a non-negative safe integer");
  }
  // A table snapshot may carry seats that are out/eliminated so the renderer
  // can keep a stable seat map. They are not current-hand participants and
  // must not inflate `playersDealtIn`.
  const dealtInPlayers = players.filter((player) => player.status !== "out");
  const activePlayersInHand = dealtInPlayers.filter(isActiveInHand).length;
  return {
    tournamentPlayersRemaining,
    playersDealtIn: dealtInPlayers.length,
    activePlayersInHand,
    activeOpponents: dealtInPlayers.filter(
      (player) => player.id !== heroId && isActiveInHand(player),
    ).length,
  };
}

/**
 * Returns the current-hand opponents who can still make a decision against a
 * candidate wager. Folded, out, and already all-in players cannot contribute
 * immediate fold equity. A target at or below a player's existing street
 * commitment also does not put that player under a new decision pressure.
 */
export function opponentsAbleToRespond<T extends RespondingOpponent>(
  players: readonly T[],
  heroId: string,
  candidateTarget: number,
): T[] {
  if (!Number.isFinite(candidateTarget) || candidateTarget < 0) {
    throw new Error("Candidate target must be a non-negative number");
  }
  return players.filter(
    (player) =>
      player.id !== heroId &&
      player.status === "active" &&
      player.stack > 0 &&
      candidateTarget > player.streetCommitted,
  );
}

/** Runtime invariant used at evaluator boundaries and in focused tests. */
export function assertPlayerCountSemantics(
  counts: PlayerCountSemantics,
): void {
  if (
    !Number.isSafeInteger(counts.tournamentPlayersRemaining) ||
    counts.tournamentPlayersRemaining < 0 ||
    !Number.isSafeInteger(counts.playersDealtIn) ||
    counts.playersDealtIn < 0 ||
    !Number.isSafeInteger(counts.activePlayersInHand) ||
    counts.activePlayersInHand < 0 ||
    !Number.isSafeInteger(counts.activeOpponents) ||
    counts.activeOpponents < 0 ||
    counts.activePlayersInHand > counts.playersDealtIn ||
    counts.activeOpponents > counts.activePlayersInHand
  ) {
    throw new Error("Invalid tournament/current-hand player count semantics");
  }
}

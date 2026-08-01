import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import type { SeatActionKind } from "./tableSceneModel";

/** A renderer-safe transition derived only from the public presentation queue. */
export interface SceneTransition {
  readonly id: string;
  readonly kind: TournamentPresentationEvent["kind"];
  /** Optional for legacy scene-test fixtures; production events always supply it. */
  readonly handId?: string;
  readonly cardIndex?: number;
  /** Public seats affected by this transition. */
  readonly playerIds: readonly string[];
  /** Public temporary piles kept while the next authoritative street has no bets. */
  readonly collectedBets?: readonly { playerId: string; amount: number }[];
  readonly action?: SeatActionKind;
  /** Normalized queue-clock progress; reduced/off motion is always terminal. */
  readonly progress: number;
  /** Public terminal state needed while the authoritative snapshot is queued. */
  readonly foldedPlayerIds: readonly string[];
}

/**
 * Projects the runner's public event identity into the scene without creating
 * a timer or exposing cards. Event id, rather than action kind, is the replay
 * identity: two calls by one seat must remain two distinct transitions.
 */
export function createSceneTransition(
  event: TournamentPresentationEvent,
  progress: number,
  reducedMotion: boolean,
): SceneTransition {
  return {
    id: event.id,
    kind: event.kind,
    handId: event.handId,
    cardIndex: event.kind === "board-card-dealt" ? event.cardIndex : undefined,
    playerIds: playerIdsForEvent(event),
    collectedBets: event.kind === "bets-collected" ? event.collections : undefined,
    foldedPlayerIds: event.kind === "action" && event.command.type === "fold"
      ? [event.playerId]
      : [],
    action: actionForEvent(event),
    progress: reducedMotion ? 1 : clampProgress(progress),
  };
}

/**
 * A Skip result beat can intentionally hold the pre-action DOM snapshot while
 * the authoritative runner is fast-forwarded. Retain only the already-public
 * fold terminal state so the decorative scene cannot restore those cards.
 */
export function retainSceneTerminalFoldedPlayers(
  transition: SceneTransition,
  playerIds: readonly string[] | undefined,
): SceneTransition {
  if (!playerIds || playerIds.length === 0) return transition;
  const foldedPlayerIds = [...new Set([...transition.foldedPlayerIds, ...playerIds])];
  return foldedPlayerIds.length === transition.foldedPlayerIds.length
    ? transition
    : { ...transition, foldedPlayerIds };
}

function playerIdsForEvent(event: TournamentPresentationEvent): readonly string[] {
  if (event.kind === "action") return [event.playerId];
  if (event.kind === "hole-cards-dealt") return event.playerIds;
  if (event.kind === "blinds-posted") return event.posts.map((post) => post.playerId);
  if (event.kind === "bets-collected") return event.collections.map((collection) => collection.playerId);
  return [];
}

function actionForEvent(event: TournamentPresentationEvent): SeatActionKind | undefined {
  if (event.kind === "hole-cards-dealt") return "deal";
  if (event.kind === "blinds-posted") return "bet";
  if (event.kind === "bets-collected") return "collect";
  if (event.kind !== "action") return undefined;
  switch (event.command.type) {
    case "fold": return "fold";
    case "all-in": return "all-in";
    case "check": return "check";
    case "call": return "call";
    case "bet": return "bet";
    case "raise": return "raise";
  }
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
}

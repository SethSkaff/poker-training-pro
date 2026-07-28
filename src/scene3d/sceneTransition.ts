import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import type { SeatActionKind } from "./tableSceneModel";

/** A renderer-safe transition derived only from the public presentation queue. */
export interface SceneTransition {
  readonly id: string;
  readonly kind: TournamentPresentationEvent["kind"];
  /** Public seats affected by this transition. */
  readonly playerIds: readonly string[];
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
    playerIds: playerIdsForEvent(event),
    foldedPlayerIds: event.kind === "action" && event.command.type === "fold"
      ? [event.playerId]
      : [],
    action: actionForEvent(event),
    progress: reducedMotion ? 1 : clampProgress(progress),
  };
}

function playerIdsForEvent(event: TournamentPresentationEvent): readonly string[] {
  if (event.kind === "action") return [event.playerId];
  if (event.kind === "hole-cards-dealt") return event.playerIds;
  if (event.kind === "blinds-posted") return event.posts.map((post) => post.playerId);
  return [];
}

function actionForEvent(event: TournamentPresentationEvent): SeatActionKind | undefined {
  if (event.kind === "hole-cards-dealt") return "deal";
  if (event.kind === "blinds-posted") return "bet";
  if (event.kind !== "action") return undefined;
  switch (event.command.type) {
    case "fold": return "fold";
    case "all-in": return "all-in";
    case "check": return "check";
    case "call":
    case "bet":
    case "raise": return "bet";
  }
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
}

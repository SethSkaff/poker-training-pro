import type { CareerTrack, PlayerProgress } from "../types/poker";
import { listTournamentSessionEvents } from "../modes/tournamentSession";

/** Existing career fields encode the run; no parallel progression store. */
export function resolveProgressionRun(track?: CareerTrack) {
  const events = listTournamentSessionEvents([]);
  const active = events.find((e) => e.id === track?.activeEventId);
  if (active)
    return { status: "active" as const, eventId: active.id, label: "RESUME" };
  const results = track?.results ?? [];
  const status = results.some((r) => !r.qualified)
    ? "lost"
    : events.every((e) =>
          results.some((r) => r.eventId === e.id && r.qualified),
        )
      ? "complete"
      : "none";
  return { status, eventId: events[0].id, label: "START" };
}
export function nextRunEvent(
  eventId: string,
  qualified: boolean,
): string | undefined {
  if (!qualified) return undefined;
  const events = listTournamentSessionEvents([]);
  const index = events.findIndex((e) => e.id === eventId);
  return index >= 0 ? events[index + 1]?.id : undefined;
}

export function progressAfterTournamentResult(
  progress: PlayerProgress,
  runner: import("../modes/tournamentRunner").TournamentRunner,
): PlayerProgress {
  const result = runner.session.result;
  if (!result) return progress;
  const mode = runner.session.mode;
  const career = progress.career ?? {
    normal: { results: [] },
    rational: { results: [] },
  };
  return {
    ...progress,
    tournamentElo: Math.max(
      100,
      progress.tournamentElo + result.tournamentEloDelta,
    ),
    career:
      runner.kind !== "career"
        ? progress.career
        : {
            ...career,
            [mode]: {
              results: [
                ...career[mode].results.filter(
                  (r) => r.eventId !== result.eventId,
                ),
                {
                  eventId: result.eventId,
                  finishPlace: result.finishPlace,
                  fieldSize: result.fieldSize,
                  sourceFieldSize: result.sourceFieldSize,
                  qualifyingPlaces: result.qualifyingPlaces,
                  qualified: result.qualified,
                  tournamentEloDelta: result.tournamentEloDelta,
                },
              ],
              ...(nextRunEvent(result.eventId, result.qualified)
                ? {
                    activeEventId: nextRunEvent(
                      result.eventId,
                      result.qualified,
                    ),
                  }
                : {}),
            },
          },
  };
}

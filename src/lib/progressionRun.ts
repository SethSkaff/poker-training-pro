import type { CareerTrack } from "../types/poker";
import { listTournamentSessionEvents } from "../modes/tournamentSession";

/** Existing career fields encode the run; no parallel progression store. */
export function resolveProgressionRun(track?: CareerTrack) {
  const events = listTournamentSessionEvents([]);
  const active = events.find(e => e.id === track?.activeEventId);
  if (active) return { status: "active" as const, eventId: active.id, label: "RESUME" };
  const results = track?.results ?? [];
  const status = results.some(r => !r.qualified) ? "lost" : events.every(e => results.some(r => r.eventId === e.id && r.qualified)) ? "complete" : "none";
  return { status, eventId: events[0].id, label: "START" };
}
export function nextRunEvent(eventId: string, qualified: boolean): string | undefined {
  if (!qualified) return undefined;
  const events = listTournamentSessionEvents([]);
  const index = events.findIndex(e => e.id === eventId);
  return index >= 0 ? events[index + 1]?.id : undefined;
}

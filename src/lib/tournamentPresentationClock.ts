import {
  FreezableDelay,
  type FreezableDelayHost,
} from "./freezableDelay";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";

export interface PresentationMotionSettings {
  reducedMotion: boolean;
  transitionMotion: "full" | "reduced" | "off";
}

/**
 * The deterministic visual duration for one public milestone. The engine does
 * not read this value, so speed/skip can never alter cards, policy, or results.
 */
export function presentationEventDelayMs(
  event: TournamentPresentationEvent,
  speed: number,
  settings: PresentationMotionSettings,
): number {
  const base =
    event.kind === "hole-cards-dealt"
      ? 720
      : event.kind === "board-card-dealt"
        ? 520
        : event.kind === "action"
          ? 980
          : event.kind === "pot-awarded" ||
              event.kind === "showdown" ||
              event.kind === "hand-result"
            ? 1_100
            : 620;
  const motionMultiplier =
    settings.reducedMotion || settings.transitionMotion === "off"
      ? 0.45
      : settings.transitionMotion === "reduced"
        ? 0.7
        : 1;
  return Math.max(120, Math.round((base * motionMultiplier) / Math.max(1, speed)));
}

/**
 * Creates the one-shot clock used by the table for the current queue item.
 * Callers register it with a DelayFreezeGroup, which freezes the exact
 * remaining time on pause and resumes it without re-emitting the event.
 */
export function createPresentationEventDelay(
  host: FreezableDelayHost,
  event: TournamentPresentationEvent,
  speed: number,
  settings: PresentationMotionSettings,
  onComplete: () => void,
): FreezableDelay {
  return new FreezableDelay(
    host,
    presentationEventDelayMs(event, speed, settings),
    onComplete,
  );
}

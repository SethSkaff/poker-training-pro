import {
  FreezableDelay,
  type FreezableDelayHost,
} from "./freezableDelay";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import { HOLE_CARD_DEAL_DURATION_MS } from "../scene3d/dealChoreography";
import { FOLD_CHOREOGRAPHY_TIMING } from "../scene3d/foldChoreography";

export interface PresentationMotionSettings {
  reducedMotion: boolean;
  transitionMotion: "full" | "reduced" | "off";
}

export interface PresentationPacingContext {
  /**
   * True once this hand's `all-in-reveal` has been presented and the board is
   * still running out. Betting is closed, so the remaining cards are pure
   * suspense rather than information the player must act on — they get a
   * slower, deliberate cadence (E06-001 step 7).
   */
  allInRunout?: boolean;
}

/**
 * The deterministic visual duration for one public milestone. The engine does
 * not read this value, so speed/skip can never alter cards, policy, or results.
 */
export function presentationEventDelayMs(
  event: TournamentPresentationEvent,
  speed: number,
  settings: PresentationMotionSettings,
  context: PresentationPacingContext = {},
): number {
  const base =
    event.kind === "all-in-reveal"
      ? // Long enough to read two-to-three freshly turned hands and the first
        // equity figures before any card lands on the board.
        1_500
      : event.kind === "hole-cards-dealt"
        ? HOLE_CARD_DEAL_DURATION_MS
        : event.kind === "board-card-dealt"
          ? context.allInRunout
            ? 1_500
            : 1_050
          : event.kind === "action"
            ? event.command.type === "check"
              ? 650
              : event.command.type === "fold"
                ? FOLD_CHOREOGRAPHY_TIMING.totalMs
                : 950
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
  const scaled = Math.round((base * motionMultiplier) / Math.max(1, speed));
  return Math.max(minimumReadableMs(event), scaled);
}

/**
 * The floor a milestone may not be compressed below (E27-003).
 *
 * Speed and reduced motion shorten *motion*. They must not shorten *reading*:
 * who won, with what hand, and for how much is the point of the hand, and at
 * 1,100 ms base a reduced-motion player at 2x was given 247 ms to read it --
 * the reported quarter-second flash. Reduced motion in particular should never
 * cost comprehension time; it exists for vestibular safety, not for haste.
 *
 * Everything else keeps the old 120 ms floor, so ordinary milestones stay as
 * responsive as they were.
 */
export function minimumReadableMs(
  event: TournamentPresentationEvent,
): number {
  return RESULT_EVENT_KINDS.has(event.kind) ? RESULT_MINIMUM_MS : 120;
}

/**
 * Milestones that state the outcome. These are the ones a player reads rather
 * than watches, and the ones that were unreadable.
 */
const RESULT_EVENT_KINDS: ReadonlySet<string> = new Set([
  "showdown",
  "hand-result",
  "pot-awarded",
]);

/** Roughly the low end of "one to two seconds" at standard speed. */
export const RESULT_MINIMUM_MS = 1_200;

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
  context: PresentationPacingContext = {},
): FreezableDelay {
  return new FreezableDelay(
    host,
    presentationEventDelayMs(event, speed, settings, context),
    onComplete,
  );
}

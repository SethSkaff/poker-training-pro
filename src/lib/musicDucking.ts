import type { SoundName } from "./audio";
import type { MusicPlaylistController } from "./musicPlaylist";

/** Feedback cues that duck the music bed while they sound. */
const DUCKING_SOUNDS: ReadonlySet<SoundName> = new Set<SoundName>([
  "success",
  "error",
  "chip",
  "fold",
  "deal",
]);

export interface FeedbackObservable {
  observeFeedback(listener: (sound: SoundName) => void): () => void;
}

export interface DuckingTimers {
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const defaultTimers: DuckingTimers = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Connect the game's feedback sounds to the music playlist's duck-under hook.
 * Each feedback cue ducks the bed and schedules a release; overlapping cues keep
 * the bed ducked until the last one releases. Returns an unsubscribe function.
 *
 * An empty-manifest controller remains inert (`setDucking` no-ops), so this is
 * safe to wire eagerly for both production and fallback configurations.
 */
export function connectFeedbackDucking(
  audio: FeedbackObservable,
  controller: Pick<MusicPlaylistController, "setDucking">,
  options: { releaseMs?: number; timers?: DuckingTimers } = {},
): () => void {
  const releaseMs = options.releaseMs ?? 650;
  const timers = options.timers ?? defaultTimers;
  let pending: unknown;

  const unsubscribe = audio.observeFeedback((sound) => {
    if (!DUCKING_SOUNDS.has(sound)) return;
    if (pending !== undefined) timers.clearTimer(pending);
    controller.setDucking(true);
    pending = timers.setTimer(() => {
      pending = undefined;
      controller.setDucking(false);
    }, releaseMs);
  });

  return () => {
    if (pending !== undefined) timers.clearTimer(pending);
    pending = undefined;
    unsubscribe();
    controller.setDucking(false);
  };
}

import type { SoundName } from "./audio";

/**
 * Select the ceremony cue from public tournament-result fields only. This
 * module intentionally has no access to cards, action history, or AI data.
 */
export function tournamentResultAudioCue({
  finishPlace,
  qualified,
}: {
  finishPlace: number;
  qualified: boolean;
}): SoundName {
  return qualified || finishPlace === 1 ? "win" : "eliminated";
}

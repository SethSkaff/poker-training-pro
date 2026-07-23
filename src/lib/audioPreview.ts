import {
  gameAudio,
  type AudioPreviewResult,
  type GameAudio,
  type SoundName,
} from "./audio";
import type { GameSettings } from "../types/poker";

export type SettingsPreviewChannel = "master" | "effects";

export interface SettingsPreviewFeedback {
  result: AudioPreviewResult;
  message: string;
}

/**
 * Synchronizes persisted values without creating a graph, then performs one
 * explicit effect preview. This function contains every failure so Settings
 * remains usable when audio is unavailable.
 */
export function previewSettingsEffect(
  settings: Pick<
    GameSettings,
    "muted" | "masterVolume" | "effectsVolume"
  >,
  channel: SettingsPreviewChannel,
  audio: Pick<
    GameAudio,
    | "setMasterVolume"
    | "setEffectsVolume"
    | "setMuted"
    | "previewEffect"
  > = gameAudio,
): SettingsPreviewFeedback {
  try {
    audio.setMasterVolume(settings.masterVolume);
    audio.setEffectsVolume(settings.effectsVolume);
    audio.setMuted(settings.muted);
    const sound: SoundName = channel === "master" ? "success" : "chip";
    const result = audio.previewEffect(sound);

    if (result === "played") {
      return {
        result,
        message:
          channel === "master"
            ? `Master preview played at ${settings.masterVolume} percent.`
            : `Table effects preview played at ${settings.effectsVolume} percent.`,
      };
    }
    if (result === "silenced") {
      const reason = settings.muted
        ? "Mute all audio is on."
        : settings.masterVolume <= 0
          ? "Master volume is zero."
          : settings.effectsVolume <= 0
            ? "Table effects volume is zero."
            : "Audio is temporarily paused.";
      return { result, message: `Preview is silent. ${reason}` };
    }
  } catch {
    // Supplementary audio must never make Settings or gameplay fail.
  }
  return {
    result: "unavailable",
    message: "Preview is unavailable on this device. Your settings were kept.",
  };
}


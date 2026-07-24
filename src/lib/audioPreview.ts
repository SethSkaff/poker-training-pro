import {
  gameAudio,
  type AudioPreviewResult,
  type GameAudio,
  type SoundName,
} from "./audio";
import type { GameSettings } from "../types/poker";
import { formatMessage } from "./localeMessages";

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
            ? formatMessage("audioPreview.masterPlayed", {
                percent: settings.masterVolume,
              })
            : formatMessage("audioPreview.effectsPlayed", {
                percent: settings.effectsVolume,
              }),
      };
    }
    if (result === "silenced") {
      const reason = settings.muted
        ? formatMessage("audioPreview.reason.mutedAll")
        : settings.masterVolume <= 0
          ? formatMessage("audioPreview.reason.masterZero")
          : settings.effectsVolume <= 0
            ? formatMessage("audioPreview.reason.effectsZero")
            : formatMessage("audioPreview.reason.temporarilyPaused");
      return {
        result,
        message: formatMessage("audioPreview.silent", { reason }),
      };
    }
  } catch {
    // Supplementary audio must never make Settings or gameplay fail.
  }
  return {
    result: "unavailable",
    message: formatMessage("audioPreview.unavailable"),
  };
}

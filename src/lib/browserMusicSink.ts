import type { PlaylistAudioSink, PlaylistSource, PlaylistVoice } from "./musicPlaylist";

/**
 * Browser/Electron adapter for approved, packaged soundtrack masters.
 *
 * It intentionally accepts only a relative `/audio/...` path. This keeps the
 * playlist offline-first and prevents an unreviewed remote music URL from
 * silently entering a released game.
 */
export function createBrowserMusicSink(): PlaylistAudioSink {
  return {
    createVoice(track: PlaylistSource): PlaylistVoice | null {
      const assetPath = track.assetPath;
      if (
        !assetPath ||
        !assetPath.startsWith("/audio/") ||
        typeof Audio === "undefined"
      ) {
        return null;
      }

      const audio = new Audio(assetPath);
      audio.preload = "auto";
      audio.loop = false;
      audio.volume = 0;
      // Browsers may refuse playback until the player's first gesture. The
      // playlist already waits for audio focus to unmute; this catch makes an
      // additional platform refusal harmless rather than an app error.
      void audio.play().catch(() => undefined);

      return {
        trackId: track.id,
        setGain(value: number): void {
          audio.volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
        },
        stop(): void {
          audio.pause();
          audio.currentTime = 0;
          audio.removeAttribute("src");
          audio.load();
        },
      };
    },
  };
}

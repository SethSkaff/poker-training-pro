import type { GameSettings } from "../types/poker";

/**
 * When Electron activates safe mode after repeated startup/renderer failures,
 * the renderer must ignore whatever (possibly imported or crash-inducing)
 * display/audio preferences are on disk and force a conservative, low-risk
 * presentation: no animated backgrounds, nonessential audio muted, and the
 * quickest dealing. Scored progress is never altered here — only presentation.
 */
export function deriveSafeModeSettings(
  settings: GameSettings,
  safeModeActive: boolean,
): GameSettings {
  if (!safeModeActive) return settings;
  return {
    ...settings,
    muted: true,
    reducedMotion: true,
    dealSpeed: "quick",
    // A safe launch never re-enters fullscreen, which can mask a wedged window.
    fullscreen: false,
  };
}

export function safeModeIgnoresImportedSettings(
  imported: GameSettings,
  safeModeActive: boolean,
): boolean {
  if (!safeModeActive) return false;
  const derived = deriveSafeModeSettings(imported, true);
  return (
    derived.muted &&
    derived.reducedMotion &&
    derived.dealSpeed === "quick" &&
    !derived.fullscreen
  );
}

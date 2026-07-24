import type { GameSettings } from "../types/poker";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function getReducedMotionMediaQueryList(): MediaQueryList | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY);
  } catch {
    // A platform that throws on matchMedia is treated the same as one
    // without support: the OS reports no preference.
    return undefined;
  }
}

/**
 * Reads the operating system's current `prefers-reduced-motion` preference.
 * Used both to seed the renderer's default when the player has not made an
 * explicit in-app choice, and to pre-select the first-run setup checkbox.
 * Returns `false` (full motion) when the platform cannot report a
 * preference, matching the OS's own "no preference" default.
 */
export function readOsReducedMotionPreference(): boolean {
  return getReducedMotionMediaQueryList()?.matches ?? false;
}

/**
 * Subscribes to live OS reduced-motion preference changes — for example, the
 * player toggles the Windows "Show animations" setting without restarting
 * the app. Returns an unsubscribe function; a no-op when the platform cannot
 * report changes at all.
 */
export function subscribeOsReducedMotionPreference(
  onChange: (matches: boolean) => void,
): () => void {
  const mediaQueryList = getReducedMotionMediaQueryList();
  if (!mediaQueryList) return () => {};

  const listener = (event: MediaQueryListEvent) => onChange(event.matches);

  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", listener);
    return () => mediaQueryList.removeEventListener("change", listener);
  }

  // Older WebKit/Chromium builds (and some embedded Electron versions) only
  // support the legacy MediaQueryList listener pair.
  const legacy = mediaQueryList as LegacyMediaQueryList;
  if (typeof legacy.addListener === "function") {
    legacy.addListener(listener);
    return () => legacy.removeListener?.(listener);
  }

  return () => {};
}

/**
 * Resolves the reduced-motion value the renderer should actually honor. An
 * explicit in-app choice (first-run setup's Save action, or the Settings
 * toggle) always wins and persists as-is. Otherwise `reducedMotion` is
 * treated as unset and the live OS preference is used instead, so the
 * player's system-wide accessibility setting is followed without requiring
 * them to duplicate it in-app.
 *
 * This never mutates `reducedMotionExplicit` — only a genuine user choice
 * (handled in App.tsx / SettingsPanel.tsx) sets that flag. Safe Mode is
 * applied separately, after this, and always wins over both.
 */
export function applyOsReducedMotionDefault(
  settings: GameSettings,
  osReducedMotion: boolean,
): GameSettings {
  if (settings.reducedMotionExplicit) return settings;
  if (settings.reducedMotion === osReducedMotion) return settings;
  return { ...settings, reducedMotion: osReducedMotion };
}
